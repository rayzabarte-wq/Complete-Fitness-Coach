import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { validateSetLoad, Equipment } from "../lib/equipmentConfig.js";
// Outlook sync is a Scheduler capability — Sport reaches it only through
// scheduler/index.ts's public interface, never by importing its internal
// files directly. This is the seam a real split would cut along.
import { isOutlookConnected, createEventForSession, updateEventForSession } from "../../scheduler/index.js";
import { AuthedRequest } from "../../lib/requireAuth.js";

export const sessionsRouter = Router();

const readinessSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

const setInputSchema = z.object({
  exerciseId: z.string(),
  weightLb: z.number().nonnegative(),
  bandLevel: z.string().optional(),
  reps: z.number().int().nonnegative(),
  targetReps: z.number().int().positive(),
  rpe: z.number().min(1).max(10).optional(),
  setOrder: z.number().int().nonnegative(),
});

const createSessionSchema = z.object({
  date: z.string().datetime().optional(), // defaults to now if omitted
  notes: z.string().optional(),
  // Captured client-side: startedAt when the Log screen opens with a
  // generated plan, endedAt when the workout is saved. Both optional so
  // logging still works if a client doesn't send them.
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
  // Pre-workout readiness check-in — all optional, 3 taps at most.
  sleepQuality: readinessSchema.optional(),
  soreness: readinessSchema.optional(),
  energyLevel: readinessSchema.optional(),
  sets: z.array(setInputSchema).min(1),
});

// Shared include shape for loading everything the Outlook event payload
// needs (exercise names/movement pattern, set loads, feedback).
const sessionForEventInclude = {
  sets: { include: { exercise: true } },
  feedback: true,
} as const;

// GET /sessions - the signed-in user's most recent sessions, with their sets
sessionsRouter.get("/", async (req: AuthedRequest, res) => {
  const limit = Number(req.query.limit ?? 20);
  const sessions = await prisma.workoutSession.findMany({
    where: { userId: req.userId },
    orderBy: { date: "desc" },
    take: limit,
    include: {
      sets: { include: { exercise: true }, orderBy: { setOrder: "asc" } },
      feedback: true,
    },
  });
  res.json(sessions);
});

// GET /sessions/exercise/:exerciseId - the signed-in user's history for one
// exercise (used by the recommendation engine and progress views)
sessionsRouter.get("/exercise/:exerciseId", async (req: AuthedRequest, res) => {
  const limit = Number(req.query.limit ?? 10);
  const sets = await prisma.setEntry.findMany({
    where: { exerciseId: req.params.exerciseId, session: { userId: req.userId } },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { session: true },
  });
  res.json(sets);
});

// POST /sessions - log a full workout session (one or more sets). Every
// set's weight/band level is checked against what the exercise's equipment
// can actually produce (see lib/equipmentConfig.ts) before saving. Also:
// - derives hitTarget per set (reps >= targetReps)
// - updates the most recent Recommendation per exercise with whether it
//   was actually followed, so that signal is available for later trend work
// - if Outlook is connected, creates a calendar event for the session
sessionsRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { date, notes, startedAt, endedAt, sleepQuality, soreness, energyLevel, sets } = parsed.data;
  const userId = req.userId!;

  const exerciseIds = [...new Set(sets.map((s) => s.exerciseId))];
  const exercises = await prisma.exercise.findMany({ where: { id: { in: exerciseIds } } });
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));

  for (const set of sets) {
    const exercise = exerciseById.get(set.exerciseId);
    if (!exercise) {
      return res.status(400).json({ error: `Unknown exerciseId: ${set.exerciseId}` });
    }
    const loadError = validateSetLoad(exercise.equipment as Equipment, set.weightLb, set.bandLevel);
    if (loadError) {
      return res.status(400).json({ error: `${exercise.name}: ${loadError}` });
    }
  }

  const session = await prisma.workoutSession.create({
    data: {
      userId,
      date: date ? new Date(date) : undefined,
      notes,
      startedAt: startedAt ? new Date(startedAt) : undefined,
      endedAt: endedAt ? new Date(endedAt) : undefined,
      sleepQuality,
      soreness,
      energyLevel,
      sets: {
        create: sets.map((s) => ({
          ...s,
          hitTarget: s.reps >= s.targetReps,
        })),
      },
    },
    include: { sets: true },
  });

  // Mark whether the most recent Recommendation per exercise (for this
  // user) was actually followed: at least one logged set matched the
  // suggested weight (or band level) and met or exceeded the suggested reps.
  for (const exerciseId of exerciseIds) {
    const latestRecommendation = await prisma.recommendation.findFirst({
      where: { exerciseId, userId },
      orderBy: { generatedAt: "desc" },
    });
    if (!latestRecommendation) continue;

    const exerciseSets = sets.filter((s) => s.exerciseId === exerciseId);
    const followedAsGiven = exerciseSets.some(
      (s) => s.weightLb === latestRecommendation.suggestedWeightLb && s.reps >= latestRecommendation.suggestedReps
    );

    await prisma.recommendation.update({
      where: { id: latestRecommendation.id },
      data: { followedAsGiven },
    });
  }

  // Sync to Outlook, if this user has it connected. Failure here shouldn't
  // fail the whole save — the workout is already logged either way — so
  // this is best-effort and just logs a warning on failure.
  if (await isOutlookConnected(userId)) {
    try {
      const sessionForEvent = await prisma.workoutSession.findUniqueOrThrow({
        where: { id: session.id },
        include: sessionForEventInclude,
      });
      const eventId = await createEventForSession(userId, sessionForEvent);
      await prisma.workoutSession.update({ where: { id: session.id }, data: { outlookEventId: eventId } });
    } catch (err) {
      console.warn("Failed to create Outlook event for session", session.id, err);
    }
  }

  res.status(201).json(session);
});

const feedbackSchema = z.object({ thumbsUp: z.boolean() });

// POST /sessions/:id/feedback - quick thumbs up/down on the session's
// generated plan, prompted right after saving a workout. Upserts so
// re-submitting (e.g. changing your mind) just updates the same row. If
// the session already has a linked Outlook event, patches it to include
// the feedback rather than creating a duplicate event.
sessionsRouter.post("/:id/feedback", async (req: AuthedRequest, res) => {
  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const userId = req.userId!;

  // Scoped by userId so one user can't leave feedback on (or even learn
  // the existence of) another user's session by guessing an ID.
  const session = await prisma.workoutSession.findFirst({ where: { id: req.params.id, userId } });
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const feedback = await prisma.sessionFeedback.upsert({
    where: { sessionId: req.params.id },
    update: { thumbsUp: parsed.data.thumbsUp },
    create: { sessionId: req.params.id, thumbsUp: parsed.data.thumbsUp },
  });

  if (session.outlookEventId && (await isOutlookConnected(userId))) {
    try {
      const sessionForEvent = await prisma.workoutSession.findUniqueOrThrow({
        where: { id: session.id },
        include: sessionForEventInclude,
      });
      await updateEventForSession(userId, sessionForEvent);
    } catch (err) {
      console.warn("Failed to update Outlook event for session", session.id, err);
    }
  }

  res.status(201).json(feedback);
});
