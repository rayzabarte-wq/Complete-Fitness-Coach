import { Router } from "express";
import { z } from "zod";
import { generateWorkoutPlan, MovementPattern } from "../services/workoutPlanner.js";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AuthedRequest } from "../../lib/requireAuth.js";
import { prisma } from "../../lib/prisma.js";

export const workoutsRouter = Router();

const patternSchema = z.enum(["PUSH", "PULL", "LEGS", "CORE", "UPPER", "LOWER", "FULL_BODY"]);

// POST /workouts/plan/:pattern - generate a full session (all exercises,
// weights/reps/sets, and rest intervals) for one session focus (Push, Pull,
// Legs, Core, Upper, Lower or Full body), based on the signed-in user's own
// exercise history, current training block, and recovery.
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

const generateBodySchema = z.object({
  // The person's local date, so "today's workout" follows their time zone.
  date: dateSchema,
  plannedSessionId: z.string().nullish(),
});

workoutsRouter.post("/plan/:pattern", async (req: AuthedRequest, res) => {
  const parsed = patternSchema.safeParse(req.params.pattern.toUpperCase());
  if (!parsed.success) {
    return res.status(400).json({ error: "Pattern must be one of PUSH, PULL, LEGS, CORE, UPPER, LOWER, FULL_BODY" });
  }

  const body = generateBodySchema.safeParse(req.body ?? {});
  if (!body.success) {
    return res.status(400).json({ error: body.error.flatten() });
  }
  const { date, plannedSessionId = null } = body.data;

  try {
    // The one place Claude is called for a strength workout: building the
    // day's workout, or explicitly regenerating it (which replaces it, and
    // anything logged in it so far). Everything else reuses the saved one.
    const plan = await generateWorkoutPlan(req.userId!, parsed.data as MovementPattern);
    const data = {
      workoutId: randomUUID(),
      plan: plan as unknown as Prisma.InputJsonValue,
      plannedSessionId,
      progress: Prisma.DbNull,
      savedSessionId: null,
    };
    const daily = await prisma.dailyWorkout.upsert({
      where: { userId_date: { userId: req.userId!, date } },
      create: { userId: req.userId!, date, ...data },
      update: data,
    });
    res.status(201).json(dailyWorkoutResponse(daily));
  } catch (err) {
    console.error(err);
    // Surfacing the actual error (rather than a generic message) makes
    // problems like a missing API key easier to diagnose from the UI.
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to generate workout plan" });
  }
});

function dailyWorkoutResponse(daily: {
  date: string;
  workoutId: string;
  plan: Prisma.JsonValue;
  plannedSessionId: string | null;
  progress: Prisma.JsonValue;
  savedSessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...(daily.plan as object),
    date: daily.date,
    workoutId: daily.workoutId,
    plannedSessionId: daily.plannedSessionId,
    progress: daily.progress,
    savedSessionId: daily.savedSessionId,
    createdAt: daily.createdAt,
    updatedAt: daily.updatedAt,
  };
}

// GET /workouts/day/:date - the workout already built for that day (with
// whatever's been entered so far), or null. Never calls Claude, so opening
// or refreshing the app on any device is free.
workoutsRouter.get("/day/:date", async (req: AuthedRequest, res) => {
  const date = dateSchema.safeParse(req.params.date);
  if (!date.success) {
    return res.status(400).json({ error: date.error.flatten() });
  }
  const daily = await prisma.dailyWorkout.findUnique({
    where: { userId_date: { userId: req.userId!, date: date.data } },
  });
  res.json(daily ? dailyWorkoutResponse(daily) : null);
});

const progressSchema = z.object({
  workoutId: z.string(),
  // Shape is owned by the frontend (sets entered, check-in, start time);
  // stored as-is, capped in size.
  progress: z.record(z.unknown()).refine((p) => JSON.stringify(p).length <= 100_000, "Progress is too large"),
});

// PUT /workouts/day/:date/progress - save what's been entered so far. Only
// applies if workoutId still matches and the workout hasn't been saved, so
// a device showing an older version can't overwrite a regenerated one (409
// tells it to reload).
workoutsRouter.put("/day/:date/progress", async (req: AuthedRequest, res) => {
  const date = dateSchema.safeParse(req.params.date);
  const parsed = progressSchema.safeParse(req.body);
  if (!date.success || !parsed.success) {
    return res.status(400).json({ error: (date.success ? parsed : date).error!.flatten() });
  }
  const updated = await prisma.dailyWorkout.updateMany({
    where: { userId: req.userId!, date: date.data, workoutId: parsed.data.workoutId, savedSessionId: null },
    data: { progress: parsed.data.progress as Prisma.InputJsonValue },
  });
  if (updated.count === 0) {
    return res.status(409).json({ error: "This workout was regenerated or saved on another device." });
  }
  const daily = await prisma.dailyWorkout.findUniqueOrThrow({
    where: { userId_date: { userId: req.userId!, date: date.data } },
  });
  res.json({ updatedAt: daily.updatedAt });
});
