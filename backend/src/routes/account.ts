import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AuthedRequest, requireAuth } from "../lib/requireAuth.js";
import { verifyPassword, verifyTotpCode } from "../services/auth.js";
// Both are Scheduler capabilities — imported through its public interface,
// not by reaching into scheduler/services directly.
import { isOutlookConnected, isStravaConnected } from "../scheduler/index.js";

export const accountRouter = Router();

// GET /account/export - every piece of data this account owns, as JSON.
// Deliberately excludes passwordHash, totpSecret and ingestTokenHash (security credentials,
// not something that should ever leave the server in an export) and the
// raw Outlook/Strava OAuth tokens (same reasoning — connection status is
// included, the tokens themselves aren't).
accountRouter.get("/export", requireAuth, async (req: AuthedRequest, res) => {
  const userId = req.userId!;

  const [user, sessions, recommendations, plannedSessions, nutritionLogs, trainingPlans, outlookConnected, stravaConnected, consents, bodyMeasurements, bodyGoals, stepDays, trainingBlocks, equipmentSettings] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          totpEnabled: true,
          createdAt: true,
          birthYear: true,
          sex: true,
          heightCm: true,
          trainingDaysPerWeek: true,
          dailyStepGoal: true,
          visibleSessionTypes: true,
        },
      }),
      prisma.workoutSession.findMany({
        where: { userId },
        include: { sets: { include: { exercise: true } }, feedback: true },
        orderBy: { date: "asc" },
      }),
      prisma.recommendation.findMany({
        where: { userId },
        include: { exercise: true },
        orderBy: { generatedAt: "asc" },
      }),
      prisma.plannedSession.findMany({ where: { userId }, orderBy: { date: "asc" } }),
      prisma.nutritionLog.findMany({ where: { userId }, orderBy: { date: "asc" } }),
      prisma.trainingPlan.findMany({
        where: { userId },
        include: { priorities: true, approaches: true, constraints: true, versions: { include: { slots: true } } },
        orderBy: { createdAt: "asc" },
      }),
      isOutlookConnected(userId),
      isStravaConnected(userId),
      prisma.consentRecord.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.bodyMeasurement.findMany({ where: { userId }, orderBy: { measuredAt: "asc" } }),
      prisma.bodyGoal.findMany({ where: { userId }, include: { targets: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "asc" } }),
      prisma.stepDay.findMany({ where: { userId }, orderBy: { date: "asc" } }),
      prisma.trainingBlock.findMany({ where: { userId }, orderBy: { startedAt: "asc" } }),
      prisma.userEquipment.findMany({ where: { userId }, orderBy: { equipment: "asc" } }),
    ]);

  res.json({
    exportedAt: new Date().toISOString(),
    account: user,
    workoutSessions: sessions,
    recommendations,
    plannedSessions,
    nutritionLogs,
    trainingPlans,
    equipmentSettings,
    consentHistory: consents,
    bodyMeasurements,
    bodyGoals,
    dailySteps: stepDays,
    trainingBlocks,
    integrations: {
      outlookConnected,
      stravaConnected,
      note: "OAuth tokens are excluded from this export for security. Calendar events already created in Outlook, and activities in Strava, are not included here or deleted on account closure — those live in those services, not this app's database.",
    },
  });
});

const sessionTypeSchema = z.enum([
  "STRENGTH",
  "SWIM",
  "GOLF_RANGE",
  "GOLF_ROUND",
  "GOLF_SHORT_GAME",
  "GOLF_PUTTING",
  "RUN_RECOVERY",
  "RUN_TEMPO",
  "RUN_FARTLEK",
  "RUN_INTERVALS",
  "RUN_LONG_RUN",
  "WALK_WALK",
  "WALK_HIKE",
  "CYCLING_EASY",
  "CYCLING_LONG",
  "CYCLING_HILLS",
  "CYCLING_TURBO_EASY",
  "CYCLING_TURBO_LONG",
  "CYCLING_TURBO_HILLS",
]);

// GET /account/preferences - which workout types show in the Calendar tab
// (its day view and "schedule a session" type picker). REST is exempt and
// always available, so it's not part of this list.
accountRouter.get("/preferences", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.userId },
    select: { visibleSessionTypes: true },
  });
  res.json({ visibleSessionTypes: user.visibleSessionTypes });
});

const updatePreferencesSchema = z.object({
  visibleSessionTypes: z.array(sessionTypeSchema),
});

// PATCH /account/preferences - update the checkbox tree's selection.
accountRouter.patch("/preferences", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = updatePreferencesSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const user = await prisma.user.update({
    where: { id: req.userId },
    data: { visibleSessionTypes: parsed.data.visibleSessionTypes },
    select: { visibleSessionTypes: true },
  });
  res.json({ visibleSessionTypes: user.visibleSessionTypes });
});

const deleteAccountSchema = z.object({
  password: z.string(),
  code: z.string().length(6).optional(),
});

// DELETE /account - permanently deletes this account and everything it
// owns (workout sessions, sets, recommendations, planned sessions,
// nutrition logs, Outlook connection — see the onDelete: Cascade relations
// in schema.prisma). Requires re-entering the password (and 2FA code, if
// enabled) as confirmation, since this is irreversible.
accountRouter.delete("/", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = deleteAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });

  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ error: "Incorrect password" });
  }
  if (user.totpEnabled) {
    if (!parsed.data.code) {
      return res.status(401).json({ error: "2FA code required", requires2fa: true });
    }
    if (!user.totpSecret || !verifyTotpCode(user.totpSecret, parsed.data.code)) {
      return res.status(401).json({ error: "Invalid 2FA code" });
    }
  }

  // Cascading deletes (configured in schema.prisma) handle every owned
  // table — sessions, sets, recommendations, planned sessions, nutrition
  // logs, the Outlook connection, the Strava connection. Nothing further
  // to clean up here.
  await prisma.user.delete({ where: { id: req.userId } });

  res.status(204).send();
});
