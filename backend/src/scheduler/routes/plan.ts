import { Router } from "express";
import { z } from "zod";
import { Prisma, type Sport, type TimeOfDay } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AuthedRequest } from "../../lib/requireAuth.js";
import {
  generateSportApproaches,
  parseScheduleConstraint,
  findConstraintConflicts,
  generatePlanAmendment,
  getCurrentVersion,
  type Milestone,
} from "../services/trainingPlanner.js";
import { buildDashboard } from "../services/dashboard.js";
import { suggestHorizon } from "../services/horizon.js";
import { dateToDayKey, dayKeyToDate } from "../../lib/dates.js";

export const planRouter = Router();

const sportSchema = z.enum(["STRENGTH", "GOLF", "RUN", "WALK", "CYCLING", "CYCLING_TURBO", "SWIM"]);
const priorityLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
const timeOfDaySchema = z.enum(["MORNING", "AFTERNOON", "EVENING"]);
const movementPatternSchema = z.enum(["PUSH", "PULL", "LEGS", "CORE"]);
const sessionTypeSchema = z.enum([
  "STRENGTH",
  "SWIM",
  "GOLF_RANGE",
  "GOLF_ROUND",
  "GOLF_SHORT_GAME",
  "GOLF_PUTTING",
  "GOLF_SIMULATOR",
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
const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Loads a plan with everything the frontend needs, shaped so `slots` is
// always the CURRENT framework version's slots (flattened, for backward
// compatibility with a single weekly-template view) and `versions` is a
// lightweight history list (no nested slots — the dashboard endpoint is
// where those get used, not the plan-shape response). Used after every
// mutation so the frontend can just replace its local plan state wholesale.
async function loadFullPlan(planId: string) {
  const plan = await prisma.trainingPlan.findUnique({
    where: { id: planId },
    include: {
      priorities: true,
      approaches: true,
      constraints: true,
      versions: {
        orderBy: { effectiveFrom: "asc" },
        include: { slots: { orderBy: [{ dayOfWeek: "asc" }, { timeOfDay: "asc" }] } },
      },
    },
  });
  if (!plan) return null;

  const currentVersion = plan.versions.find((v) => v.effectiveTo === null) ?? null;
  const { versions, ...rest } = plan;
  return {
    ...rest,
    slots: currentVersion?.slots ?? [],
    versions: versions.map((v) => ({
      id: v.id,
      effectiveFrom: v.effectiveFrom,
      effectiveTo: v.effectiveTo,
      amendmentSummary: v.amendmentSummary,
      amendmentRequest: v.amendmentRequest,
    })),
  };
}

// Sessions a week is one number the person can change in several places (the
// approach, the weekly pattern, Settings). When it changes here, the matching
// Settings value follows (where it has one and the number is in its range), so
// the strength, running and golf planners agree with the plan.
async function syncFrequencySetting(userId: string, sport: Sport, n: number) {
  if (sport === "STRENGTH" && n >= 2 && n <= 6) await prisma.user.update({ where: { id: userId }, data: { trainingDaysPerWeek: n } });
  else if (sport === "RUN" && n >= 2 && n <= 6) await prisma.user.update({ where: { id: userId }, data: { runDaysPerWeek: n } });
  else if (sport === "GOLF" && n >= 1 && n <= 5) {
    await prisma.golfProfile.upsert({ where: { userId }, update: { practiceSessionsPerWeek: n }, create: { userId, practiceSessionsPerWeek: n } });
  }
}

async function loadOwnedPlan(userId: string | undefined, planId: string) {
  return prisma.trainingPlan.findFirst({ where: { id: planId, userId } });
}

// POST /plan - start a new plan (to the end of a calendar quarter). Archives any existing non-archived
// plan for this user first, since only one plan is "current" at a time.
const priorityInputSchema = z.object({
  sport: sportSchema,
  priority: priorityLevelSchema,
  goalNote: z.string().optional(),
  // Minutes/week the person actually has for this sport — a hard ceiling
  // the AI-proposed approach (and later the schedule built from it) has to
  // fit inside, not just a priority weighting.
  weeklyMinutesAvailable: z.number().int().positive().optional(),
});

const createPlanSchema = z.object({
  overallGoal: z.string().optional(),
  priorities: z.array(priorityInputSchema).min(1),
});

planRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createPlanSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { overallGoal, priorities } = parsed.data;

  // Starts today and runs to the end of a calendar quarter (see
  // services/horizon.ts), the same rule the welcome journey suggests.
  const todayKey = dateToDayKey(new Date());
  const startDate = dayKeyToDate(todayKey);
  const endDate = dayKeyToDate(suggestHorizon(todayKey).endDate);

  const plan = await prisma.$transaction(async (tx) => {
    await tx.trainingPlan.updateMany({
      where: { userId: req.userId!, status: { not: "ARCHIVED" } },
      data: { status: "ARCHIVED" },
    });
    return tx.trainingPlan.create({
      data: {
        userId: req.userId!,
        startDate,
        endDate,
        overallGoal,
        priorities: {
          create: priorities.map((p) => ({
            sport: p.sport,
            priority: p.priority,
            goalNote: p.goalNote,
            weeklyMinutesAvailable: p.weeklyMinutesAvailable,
          })),
        },
      },
    });
  });

  res.status(201).json(await loadFullPlan(plan.id));
});

// GET /plan/current - the signed-in user's most recent non-archived plan,
// with priorities, approaches, the current framework version's slots, a
// lightweight version history, and constraints. 404 if none started yet.
planRouter.get("/current", async (req: AuthedRequest, res) => {
  const plan = await prisma.trainingPlan.findFirst({
    where: { userId: req.userId, status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" },
  });
  if (!plan) {
    return res.status(404).json({ error: "No current training plan" });
  }
  res.json(await loadFullPlan(plan.id));
});

// PATCH /plan/:id/priorities - replace the priority list before generating
// (or regenerating) approaches. Only sensible while the plan is still DRAFT.
const updatePrioritiesSchema = z.object({
  overallGoal: z.string().optional(),
  priorities: z.array(priorityInputSchema).min(1),
});

planRouter.patch("/:id/priorities", async (req: AuthedRequest, res) => {
  const plan = await loadOwnedPlan(req.userId, req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const parsed = updatePrioritiesSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  await prisma.$transaction([
    prisma.sportPriority.deleteMany({ where: { planId: plan.id } }),
    prisma.trainingPlan.update({
      where: { id: plan.id },
      data: {
        overallGoal: parsed.data.overallGoal,
        priorities: {
          create: parsed.data.priorities.map((p) => ({
            sport: p.sport,
            priority: p.priority,
            goalNote: p.goalNote,
            weeklyMinutesAvailable: p.weeklyMinutesAvailable,
          })),
        },
      },
    }),
  ]);

  res.json(await loadFullPlan(plan.id));
});

// POST /plan/:id/approaches/generate - AI-generate (or regenerate) a
// PROPOSED approach for each prioritized sport, replacing any prior ones.
planRouter.post("/:id/approaches/generate", async (req: AuthedRequest, res) => {
  const plan = await prisma.trainingPlan.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: { priorities: true },
  });
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  if (plan.priorities.length === 0) {
    return res.status(400).json({ error: "Set sport priorities before generating approaches" });
  }

  try {
    // Use the plan's real length, and the sessions a week already set in
    // Settings, so the approach agrees with what the planners will build.
    const weeks = Math.max(2, Math.round(((plan.endDate.getTime() - plan.startDate.getTime()) / 86400_000 + 1) / 7));
    const [user, golf] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { trainingDaysPerWeek: true, runDaysPerWeek: true } }),
      prisma.golfProfile.findUnique({ where: { userId: req.userId! }, select: { practiceSessionsPerWeek: true } }),
    ]);
    const chosen = new Set(plan.priorities.map((p) => p.sport));
    const fixedSessions: Partial<Record<"STRENGTH" | "RUN" | "GOLF", number>> = {};
    if (chosen.has("STRENGTH")) fixedSessions.STRENGTH = user.trainingDaysPerWeek;
    if (chosen.has("RUN")) fixedSessions.RUN = user.runDaysPerWeek;
    if (chosen.has("GOLF") && golf) fixedSessions.GOLF = golf.practiceSessionsPerWeek;
    const generated = await generateSportApproaches(plan.overallGoal, plan.priorities, {
      weeks,
      endDate: plan.endDate.toISOString().slice(0, 10),
      fixedSessions,
    });

    await prisma.$transaction([
      prisma.sportApproach.deleteMany({ where: { planId: plan.id } }),
      ...generated.map((a) =>
        prisma.sportApproach.create({
          data: {
            planId: plan.id,
            sport: a.sport,
            approachText: a.approachText,
            weeklySessionTarget: a.weeklySessionTarget,
            sessionMinutes: a.sessionMinutes,
            milestones: a.milestones as unknown as Prisma.InputJsonValue,
          },
        })
      ),
    ]);

    res.json(await loadFullPlan(plan.id));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to generate sport approaches" });
  }
});

// PATCH /plan/:id/approaches/:sport - approve an approach as-is, or edit its
// text/weekly target (an edit implicitly counts as approved, since the user
// has taken ownership of the wording/number at that point).
const milestoneSchema = z.object({ phase: z.string(), target: z.string() });

const updateApproachSchema = z.object({
  status: z.enum(["PROPOSED", "APPROVED"]).optional(),
  approachText: z.string().optional(),
  weeklySessionTarget: z.number().int().min(1).max(14).optional(),
  sessionMinutes: z.number().int().positive().optional(),
  milestones: z.array(milestoneSchema).optional(),
});

planRouter.patch("/:id/approaches/:sport", async (req: AuthedRequest, res) => {
  const plan = await loadOwnedPlan(req.userId, req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const sportParsed = sportSchema.safeParse(req.params.sport);
  if (!sportParsed.success) return res.status(400).json({ error: "Invalid sport" });

  const parsed = updateApproachSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.sportApproach.findFirst({ where: { planId: plan.id, sport: sportParsed.data } });
  if (!existing) return res.status(404).json({ error: "Approach not found for this sport" });

  const { status, approachText, weeklySessionTarget, sessionMinutes, milestones } = parsed.data;
  await prisma.sportApproach.update({
    where: { id: existing.id },
    data: {
      approachText,
      weeklySessionTarget,
      sessionMinutes,
      milestones: milestones as unknown as Prisma.InputJsonValue | undefined,
      status: status ?? (approachText || weeklySessionTarget || sessionMinutes || milestones ? "APPROVED" : undefined),
    },
  });
  if (weeklySessionTarget !== undefined) await syncFrequencySetting(req.userId!, sportParsed.data, weeklySessionTarget);

  res.json(await loadFullPlan(plan.id));
});

// GET /plan/:id/framework/slots-needed - how many slots of each sport the
// person needs to place, derived from the approved approaches' weekly
// session targets, and how many they've already placed in the current
// framework version (if any) — what the schedule-builder grid seeds itself
// from. Not itself a mutation; the frontend uses this to know how many
// session cards to show per sport before the person has placed anything.
planRouter.get("/:id/framework/slots-needed", async (req: AuthedRequest, res) => {
  const plan = await prisma.trainingPlan.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: { approaches: true },
  });
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const currentVersion = await getCurrentVersion(plan.id);
  const placedBySport = new Map<string, number>();
  for (const slot of currentVersion?.slots ?? []) {
    placedBySport.set(slot.sport, (placedBySport.get(slot.sport) ?? 0) + 1);
  }

  res.json(
    plan.approaches
      .filter((a) => a.status === "APPROVED")
      .map((a) => ({
        sport: a.sport,
        weeklySessionTarget: a.weeklySessionTarget,
        sessionMinutes: a.sessionMinutes,
        alreadyPlaced: placedBySport.get(a.sport) ?? 0,
      }))
  );
});

// PUT /plan/:id/framework - save the weekly schedule the person built
// themselves (day + time-of-day + sport, for every session they've placed)
// — this is a full replace of the current framework version's slots, not a
// generator. No AI is involved in choosing placement; see
// trainingPlanner.ts's comment on generateSportApproaches for why.
//
// While the plan is still DRAFT/FRAMEWORK (not yet activated), this
// replaces the one-and-only version's slots in place — there's no progress
// yet worth preserving as history. Once the plan is ACTIVE, saving here
// closes the current version and opens a new one, the same versioning an
// approach-content amendment (POST /:id/amend) uses, so the dashboard can
// still show progress against the schedule as it stood before this change.
// A slot is a sport, a day and the minutes available. The time of day is
// optional (it's worked out when left out), and the session type / movement
// pattern are optional too: "Plan my week" chooses the actual workouts from
// what has been done so far (see services/weekFromPlan.ts).
const saveFrameworkSlotSchema = z
  .object({
    sport: sportSchema,
    dayOfWeek: z.number().int().min(0).max(6),
    timeOfDay: timeOfDaySchema.optional(),
    sessionType: sessionTypeSchema.optional(),
    movementPattern: movementPatternSchema.optional(),
    estimatedMinutes: z.number().int().positive().optional(),
    label: z.string().optional(),
  })
  .refine((s) => s.sport === "STRENGTH" || !s.movementPattern, {
    message: "movementPattern only applies to STRENGTH sessions",
    path: ["movementPattern"],
  });

const saveFrameworkSchema = z.object({
  slots: z.array(saveFrameworkSlotSchema).min(1),
  // Optional free-text note on what changed and why — only used (and only
  // shown later) when this save is amending an ACTIVE plan's schedule.
  note: z.string().optional(),
});

planRouter.put("/:id/framework", async (req: AuthedRequest, res) => {
  const plan = await prisma.trainingPlan.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: { approaches: true, constraints: true },
  });
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  if (plan.approaches.length === 0 || plan.approaches.some((a) => a.status !== "APPROVED")) {
    return res.status(400).json({ error: "Approve every sport's approach before building the schedule" });
  }

  const parsed = saveFrameworkSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { note } = parsed.data;

  // Sessions placed without a time of day get the first one that is free that
  // day and not blocked by a constraint. Times that were given are kept.
  const takenTimes = new Set(parsed.data.slots.filter((s) => s.timeOfDay).map((s) => `${s.dayOfWeek}-${s.timeOfDay}`));
  const slots: (Omit<(typeof parsed.data.slots)[number], "timeOfDay"> & { timeOfDay: TimeOfDay })[] = [];
  for (const s of parsed.data.slots) {
    if (s.timeOfDay) {
      slots.push({ ...s, timeOfDay: s.timeOfDay });
      continue;
    }
    const time = (["MORNING", "AFTERNOON", "EVENING"] as TimeOfDay[]).find(
      (t) => !takenTimes.has(`${s.dayOfWeek}-${t}`) && !plan.constraints.some((c) => c.daysOfWeek.includes(s.dayOfWeek) && c.blockedTimeOfDay.includes(t)),
    );
    if (!time) {
      return res.status(400).json({
        error: `There's no room for another session on ${DAY_LABELS[s.dayOfWeek]}: up to three a day, and your constraints may block some times. Pick a different day for one of them.`,
      });
    }
    takenTimes.add(`${s.dayOfWeek}-${time}`);
    slots.push({ ...s, timeOfDay: time });
  }

  // No two sessions in the same day + time-of-day slot.
  const seen = new Set<string>();
  for (const s of slots) {
    const key = `${s.dayOfWeek}-${s.timeOfDay}`;
    if (seen.has(key)) {
      return res.status(400).json({
        error: `Two sessions are both scheduled for ${DAY_LABELS[s.dayOfWeek]} — each day can only have one session per time of day (morning/afternoon/evening).`,
      });
    }
    seen.add(key);
  }

  // Don't allow saving a session into a day/time a constraint has blocked.
  for (const s of slots) {
    const violated = plan.constraints.find((c) => c.daysOfWeek.includes(s.dayOfWeek) && c.blockedTimeOfDay.includes(s.timeOfDay));
    if (violated) {
      return res.status(400).json({
        error: `${DAY_LABELS[s.dayOfWeek]} ${s.timeOfDay.toLowerCase()} conflicts with your constraint "${violated.rawText}" — pick a different day or time for that session.`,
      });
    }
  }

  const currentVersion = await getCurrentVersion(plan.id);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    if (plan.status === "ACTIVE" && currentVersion) {
      // A schedule change to a live plan is versioned the same way a
      // content amendment is, so the dashboard can compare before/after.
      await tx.frameworkVersion.update({ where: { id: currentVersion.id }, data: { effectiveTo: now } });
      const newVersion = await tx.frameworkVersion.create({
        data: { planId: plan.id, effectiveFrom: now, amendmentSummary: note ?? "Schedule updated" },
      });
      await tx.frameworkSlot.createMany({ data: slots.map((s) => ({ ...s, versionId: newVersion.id })) });
    } else {
      // Still drafting — replace the one-and-only version's slots in place.
      await tx.trainingPlan.update({ where: { id: plan.id }, data: { status: "FRAMEWORK" } });
      const versionId = currentVersion
        ? currentVersion.id
        : (await tx.frameworkVersion.create({ data: { planId: plan.id, effectiveFrom: plan.startDate } })).id;
      if (currentVersion) {
        await tx.frameworkSlot.deleteMany({ where: { versionId } });
      }
      await tx.frameworkSlot.createMany({ data: slots.map((s) => ({ ...s, versionId })) });
    }
  });

  // The number of sessions in the pattern is the sessions a week now, whatever
  // the AI first suggested: carry it to the approach and to Settings.
  const perSport = new Map<Sport, number>();
  for (const sl of slots) perSport.set(sl.sport, (perSport.get(sl.sport) ?? 0) + 1);
  for (const [sport, n] of perSport) {
    await prisma.sportApproach.updateMany({ where: { planId: plan.id, sport, NOT: { weeklySessionTarget: n } }, data: { weeklySessionTarget: n } });
    await syncFrequencySetting(req.userId!, sport, n);
  }

  res.json(await loadFullPlan(plan.id));
});

// PATCH /plan/:id/framework/:slotId - manually move or edit one slot in the
// current framework version.
const updateSlotSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  timeOfDay: timeOfDaySchema.optional(),
  sessionType: sessionTypeSchema.optional(),
  movementPattern: movementPatternSchema.optional(),
  estimatedMinutes: z.number().int().positive().optional(),
  label: z.string().optional(),
});

planRouter.patch("/:id/framework/:slotId", async (req: AuthedRequest, res) => {
  const plan = await loadOwnedPlan(req.userId, req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const parsed = updateSlotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const currentVersion = await getCurrentVersion(plan.id);
  const slot = currentVersion?.slots.find((s) => s.id === req.params.slotId);
  if (!slot) return res.status(404).json({ error: "Slot not found" });

  await prisma.frameworkSlot.update({ where: { id: slot.id }, data: parsed.data });
  res.json(await loadFullPlan(plan.id));
});

// POST /plan/:id/activate - mark the framework approved and the plan live.
planRouter.post("/:id/activate", async (req: AuthedRequest, res) => {
  const plan = await loadOwnedPlan(req.userId, req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const currentVersion = await getCurrentVersion(plan.id);
  if (!currentVersion || currentVersion.slots.length === 0) {
    return res.status(400).json({ error: "Generate a weekly framework before activating the plan" });
  }

  await prisma.trainingPlan.update({ where: { id: plan.id }, data: { status: "ACTIVE" } });
  res.json(await loadFullPlan(plan.id));
});

// POST /plan/:id/amend - apply a free-text amendment request to an ACTIVE
// plan's sport approaches (weekly session count, session length, approach
// text) — content only, never the day/time schedule. Doesn't touch the
// framework version at all: after this, the affected sports' targets have
// changed, and the person goes to the schedule builder (PUT /:id/framework)
// to rework the placement themselves, which is what actually opens a new
// framework version.
const amendPlanSchema = z.object({ requestText: z.string().min(1) });

planRouter.post("/:id/amend", async (req: AuthedRequest, res) => {
  const plan = await prisma.trainingPlan.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: { approaches: true },
  });
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  if (plan.status !== "ACTIVE") {
    return res.status(400).json({ error: "Only an active plan can be amended — activate your framework first." });
  }

  const parsed = amendPlanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const amendment = await generatePlanAmendment({
      overallGoal: plan.overallGoal,
      approaches: plan.approaches.map((a) => ({
        sport: a.sport,
        approachText: a.approachText,
        weeklySessionTarget: a.weeklySessionTarget,
        sessionMinutes: a.sessionMinutes,
        milestones: (a.milestones as unknown as Milestone[] | null) ?? null,
      })),
      requestText: parsed.data.requestText,
    });

    await prisma.$transaction(
      amendment.approachUpdates
        .map((update) => plan.approaches.find((a) => a.sport === update.sport))
        .filter((existing): existing is (typeof plan.approaches)[number] => !!existing)
        .map((existing) => {
          const update = amendment.approachUpdates.find((u) => u.sport === existing.sport)!;
          return prisma.sportApproach.update({
            where: { id: existing.id },
            data: {
              approachText: update.approachText,
              weeklySessionTarget: update.weeklySessionTarget,
              sessionMinutes: update.sessionMinutes,
              milestones: (update.milestones as unknown as Prisma.InputJsonValue | undefined) ?? undefined,
            },
          });
        })
    );

    res.json({ ...(await loadFullPlan(plan.id)), changeSummary: amendment.changeSummary });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to apply that amendment" });
  }
});

// GET /plan/:id/dashboard?today=YYYY-MM-DD - completion-rate dashboard for
// the current week (Sunday start) and the last 30 days (or since the plan
// started, if sooner). `today` should be the caller's own local date (the
// app already avoids UTC-parsing pitfalls elsewhere — see
// frontend/src/lib/location.ts's parseLocalDate/formatLocalDateKey), so
// periods line up with the person's actual calendar days rather than the
// server's. Falls back to the server's date if omitted.
planRouter.get("/:id/dashboard", async (req: AuthedRequest, res) => {
  const plan = await loadOwnedPlan(req.userId, req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  if (plan.status !== "ACTIVE" && plan.status !== "FRAMEWORK") {
    return res.status(400).json({ error: "Set up sport priorities and a weekly framework before viewing the dashboard" });
  }

  const todayParam = typeof req.query.today === "string" ? req.query.today : undefined;
  const today = todayParam && /^\d{4}-\d{2}-\d{2}$/.test(todayParam) ? new Date(`${todayParam}T00:00:00`) : new Date();

  const versions = await prisma.frameworkVersion.findMany({
    where: { planId: plan.id },
    orderBy: { effectiveFrom: "asc" },
    include: { slots: true },
  });

  if (versions.length === 0) {
    return res.status(400).json({ error: "No weekly framework yet — generate one before viewing the dashboard" });
  }

  const dashboard = await buildDashboard(req.userId!, plan, versions, today);
  res.json(dashboard);
});

// POST /plan/:id/constraints - add a free-text scheduling limitation. Parses
// it via AI into structured days/times, then returns any conflicts it
// creates against the current framework along with move options for each.
const createConstraintSchema = z.object({ rawText: z.string().min(1) });

planRouter.post("/:id/constraints", async (req: AuthedRequest, res) => {
  const plan = await loadOwnedPlan(req.userId, req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const parsed = createConstraintSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const structured = await parseScheduleConstraint(parsed.data.rawText);
    const constraint = await prisma.scheduleConstraint.create({
      data: {
        planId: plan.id,
        rawText: parsed.data.rawText,
        daysOfWeek: structured.daysOfWeek,
        blockedTimeOfDay: structured.blockedTimeOfDay,
        parseExplanation: structured.parseExplanation,
      },
    });

    const conflicts = await findConstraintConflicts(plan.id, constraint.id);
    res.status(201).json({ constraint, conflicts });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to parse and apply the constraint" });
  }
});

// GET /plan/:id/constraints/:constraintId/conflicts - recompute conflicts
// (e.g. after the framework changed since the constraint was added).
planRouter.get("/:id/constraints/:constraintId/conflicts", async (req: AuthedRequest, res) => {
  const plan = await loadOwnedPlan(req.userId, req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  try {
    const conflicts = await findConstraintConflicts(plan.id, req.params.constraintId);
    res.json({ conflicts });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to compute conflicts" });
  }
});

// POST /plan/:id/constraints/:constraintId/apply - move one conflicting slot
// (in the current framework version) to a chosen alternative day/time-of-day.
const applyMoveSchema = z.object({
  slotId: z.string(),
  dayOfWeek: z.number().int().min(0).max(6),
  timeOfDay: timeOfDaySchema,
});

planRouter.post("/:id/constraints/:constraintId/apply", async (req: AuthedRequest, res) => {
  const plan = await loadOwnedPlan(req.userId, req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const parsed = applyMoveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const currentVersion = await getCurrentVersion(plan.id);
  const slot = currentVersion?.slots.find((s) => s.id === parsed.data.slotId);
  if (!slot) return res.status(404).json({ error: "Slot not found" });

  await prisma.frameworkSlot.update({
    where: { id: slot.id },
    data: { dayOfWeek: parsed.data.dayOfWeek, timeOfDay: parsed.data.timeOfDay },
  });

  res.json(await loadFullPlan(plan.id));
});

// DELETE /plan/:id/constraints/:constraintId - remove a constraint. Leaves
// any already-moved slots where they are; it just stops enforcing that limit
// going forward (e.g. the next time the schedule is rebuilt).
planRouter.delete("/:id/constraints/:constraintId", async (req: AuthedRequest, res) => {
  const plan = await loadOwnedPlan(req.userId, req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const constraint = await prisma.scheduleConstraint.findFirst({ where: { id: req.params.constraintId, planId: plan.id } });
  if (!constraint) return res.status(404).json({ error: "Constraint not found" });

  await prisma.scheduleConstraint.delete({ where: { id: constraint.id } });
  res.json(await loadFullPlan(plan.id));
});
