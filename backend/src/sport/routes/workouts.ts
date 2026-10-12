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
workoutsRouter.post("/plan/:pattern", async (req: AuthedRequest, res) => {
  const parsed = patternSchema.safeParse(req.params.pattern.toUpperCase());
  if (!parsed.success) {
    return res.status(400).json({ error: "Pattern must be one of PUSH, PULL, LEGS, CORE, UPPER, LOWER, FULL_BODY" });
  }

  const body = z.object({ plannedSessionId: z.string().nullish() }).safeParse(req.body ?? {});
  const plannedSessionId = body.success ? body.data.plannedSessionId ?? null : null;

  try {
    const plan = await generateWorkoutPlan(req.userId!, parsed.data as MovementPattern);
    // Becomes the account's active workout (replacing any earlier one), so
    // it can be opened from any device until it's saved or discarded.
    const active = await prisma.activeWorkout.upsert({
      where: { userId: req.userId! },
      create: {
        userId: req.userId!,
        workoutId: randomUUID(),
        plan: plan as unknown as Prisma.InputJsonValue,
        plannedSessionId,
      },
      update: {
        workoutId: randomUUID(),
        plan: plan as unknown as Prisma.InputJsonValue,
        plannedSessionId,
        progress: Prisma.DbNull,
      },
    });
    res.status(201).json({ ...plan, workoutId: active.workoutId, plannedSessionId: active.plannedSessionId });
  } catch (err) {
    console.error(err);
    // Surfacing the actual error (rather than a generic message) makes
    // problems like a missing API key easier to diagnose from the UI.
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to generate workout plan" });
  }
});

function activeWorkoutResponse(active: {
  workoutId: string;
  plan: Prisma.JsonValue;
  plannedSessionId: string | null;
  progress: Prisma.JsonValue;
  updatedAt: Date;
}) {
  return {
    ...(active.plan as object),
    workoutId: active.workoutId,
    plannedSessionId: active.plannedSessionId,
    progress: active.progress,
    updatedAt: active.updatedAt,
  };
}

// GET /workouts/active - the workout currently in progress for this
// account, if any (null otherwise), with whatever's been entered so far.
workoutsRouter.get("/active", async (req: AuthedRequest, res) => {
  const active = await prisma.activeWorkout.findUnique({ where: { userId: req.userId! } });
  res.json(active ? activeWorkoutResponse(active) : null);
});

const progressSchema = z.object({
  workoutId: z.string(),
  // Shape is owned by the frontend (sets entered, check-in, start time);
  // stored as-is, capped in size.
  progress: z.record(z.unknown()).refine((p) => JSON.stringify(p).length <= 100_000, "Progress is too large"),
});

// PUT /workouts/active/progress - save what's been entered so far. Only
// applies if workoutId still matches, so a device showing an older
// workout can't overwrite a newer one's progress (409 tells it to reload).
workoutsRouter.put("/active/progress", async (req: AuthedRequest, res) => {
  const parsed = progressSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const updated = await prisma.activeWorkout.updateMany({
    where: { userId: req.userId!, workoutId: parsed.data.workoutId },
    data: { progress: parsed.data.progress as Prisma.InputJsonValue },
  });
  if (updated.count === 0) {
    return res.status(409).json({ error: "This workout was replaced or finished on another device." });
  }
  const active = await prisma.activeWorkout.findUniqueOrThrow({ where: { userId: req.userId! } });
  res.json({ updatedAt: active.updatedAt });
});

// DELETE /workouts/active - discard the workout in progress.
workoutsRouter.delete("/active", async (req: AuthedRequest, res) => {
  await prisma.activeWorkout.deleteMany({ where: { userId: req.userId! } });
  res.status(204).end();
});
