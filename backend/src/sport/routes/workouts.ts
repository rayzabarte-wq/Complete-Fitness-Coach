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
  // Which gym profile to build for; defaults to the user's active gym.
  gymId: z.string().optional(),
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
  const { date, plannedSessionId = null, gymId } = body.data;

  try {
    // The one place Claude is called for a strength workout: building the
    // day's workout, or explicitly regenerating it (which replaces it, and
    // anything logged in it so far). Everything else reuses the saved one.
    const plan = await generateWorkoutPlan(req.userId!, parsed.data as MovementPattern, gymId);
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
  reusedOnDate: string | null;
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

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type SavedStatus = "TODAY" | "DONE" | "MISSED" | "SCHEDULED" | "MOVED";

// GET /workouts/saved?today=YYYY-MM-DD[&days=30] - every workout built in
// the last N days (and any scheduled ahead), newest first, with a status:
// DONE (logged), TODAY, SCHEDULED (a future day), MOVED (reused on another
// day) or MISSED (built for a past day and never logged). Never calls
// Claude. This is what makes a missed or past workout recallable.
workoutsRouter.get("/saved", async (req: AuthedRequest, res) => {
  const query = z
    .object({ today: dateSchema, days: z.coerce.number().int().min(1).max(90).default(30) })
    .safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: query.error.flatten() });
  }
  const { today, days } = query.data;

  const rows = await prisma.dailyWorkout.findMany({
    where: { userId: req.userId!, date: { gte: addDays(today, -days) } },
    orderBy: { date: "desc" },
  });

  res.json(
    rows.map((row) => {
      const plan = row.plan as { movementPattern: string; exercises?: unknown[]; estimatedMinutes?: number };
      const progress = row.progress as { rows?: Record<string, { logged?: boolean }[]> } | null;
      const setsLogged = progress?.rows
        ? Object.values(progress.rows).reduce((n, sets) => n + sets.filter((r) => r.logged).length, 0)
        : 0;
      const status: SavedStatus = row.savedSessionId
        ? "DONE"
        : row.date === today
        ? "TODAY"
        : row.reusedOnDate
        ? "MOVED"
        : row.date > today
        ? "SCHEDULED"
        : "MISSED";
      return {
        id: row.id,
        date: row.date,
        status,
        movementPattern: plan.movementPattern,
        exerciseCount: plan.exercises?.length ?? 0,
        estimatedMinutes: plan.estimatedMinutes ?? 0,
        setsLogged,
        reusedOnDate: row.reusedOnDate,
        createdAt: row.createdAt,
      };
    })
  );
});

const reuseSchema = z.object({ sourceId: z.string().min(1), date: dateSchema });

// POST /workouts/reuse - use an already-built workout (a missed one, or a
// past one to repeat) for another day, with NO AI call: its plan is copied
// to that day as a fresh workout (nothing logged yet). It replaces whatever
// was built for that day. A missed workout is marked as moved; a completed
// one is left as it was.
workoutsRouter.post("/reuse", async (req: AuthedRequest, res) => {
  const parsed = reuseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { sourceId, date } = parsed.data;
  const userId = req.userId!;

  // Scoped to this account, so another user's workout can't be copied by
  // guessing its id.
  const source = await prisma.dailyWorkout.findFirst({ where: { id: sourceId, userId } });
  if (!source) {
    return res.status(404).json({ error: "That saved workout wasn't found." });
  }
  if (source.date === date) {
    return res.status(400).json({ error: "That workout is already the one for this day." });
  }

  const data = {
    workoutId: randomUUID(),
    plan: source.plan as Prisma.InputJsonValue,
    plannedSessionId: null,
    progress: Prisma.DbNull,
    savedSessionId: null,
    reusedOnDate: null,
  };
  const [target] = await prisma.$transaction([
    prisma.dailyWorkout.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, ...data },
      update: data,
    }),
    // Completed workouts stay "done"; anything else is now "moved".
    ...(source.savedSessionId
      ? []
      : [prisma.dailyWorkout.update({ where: { id: source.id }, data: { reusedOnDate: date } })]),
  ]);

  res.status(201).json(dailyWorkoutResponse(target));
});
