import { Router } from "express";
import { z } from "zod";
import { BodyMeasurement, MeasurementSource } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AuthedRequest } from "../lib/requireAuth.js";
import { dayKeyToDate, isDayKey, parseDateParam, DAY_MS } from "../lib/dates.js";
import { CONSENT_REQUIRED_MESSAGE, hasConsent } from "../services/consent.js";
import {
  BodyMetric,
  buildQuarterReview,
  goalDirection,
  paceStatus,
  paceValueAt,
  quarterOf,
  Reading,
  revisionDirection,
  Target,
} from "../services/goals.js";
import { bmiBenchmark, bodyFatBenchmark, Benchmark } from "../services/benchmarks.js";

// Body composition (scans), body goals with revision history, the quarterly
// goal-setting review, and benchmarks against public reference data. Shared
// core rather than Sport: body data isn't specific to any one sport.

export const bodyRouter = Router();

const METRIC_FIELD: Record<BodyMetric, "bodyFatPct" | "muscleMassKg" | "weightKg"> = {
  BODY_FAT_PCT: "bodyFatPct",
  MUSCLE_MASS_KG: "muscleMassKg",
  BODY_WEIGHT_KG: "weightKg",
};

const metricSchema = z.enum(["BODY_FAT_PCT", "MUSCLE_MASS_KG", "BODY_WEIGHT_KG"]);

export function readingsFor(metric: BodyMetric, rows: BodyMeasurement[]): Reading[] {
  const field = METRIC_FIELD[metric];
  return rows
    .filter((r) => r[field] != null)
    .map((r) => ({ date: r.measuredAt, value: r[field] as number }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

async function requireBodyConsent(userId: string): Promise<string | null> {
  return (await hasConsent(userId, "BODY_DATA")) ? null : CONSENT_REQUIRED_MESSAGE.BODY_DATA;
}

// --- Measurements ---------------------------------------------------------

const measurementInput = z
  .object({
    measuredAt: z.string().datetime().optional(),
    weightKg: z.number().min(20).max(400).optional(),
    bodyFatPct: z.number().min(2).max(75).optional(),
    muscleMassKg: z.number().min(5).max(200).optional(),
    externalId: z.string().max(200).optional(),
  })
  .refine((m) => m.weightKg != null || m.bodyFatPct != null || m.muscleMassKg != null, {
    message: "Provide at least one of weightKg, bodyFatPct, muscleMassKg",
  });

export type MeasurementInput = z.infer<typeof measurementInput>;
export const measurementInputSchema = measurementInput;

/** Inserts measurements, skipping any already imported (same source +
 * externalId). Used by the manual form and by the import endpoints. */
export async function saveMeasurements(userId: string, source: MeasurementSource, items: MeasurementInput[]) {
  let created = 0;
  let skipped = 0;
  for (const m of items) {
    const data = {
      userId,
      source,
      measuredAt: m.measuredAt ? new Date(m.measuredAt) : new Date(),
      weightKg: m.weightKg,
      bodyFatPct: m.bodyFatPct,
      muscleMassKg: m.muscleMassKg,
      externalId: m.externalId,
    };
    if (m.externalId) {
      const existing = await prisma.bodyMeasurement.findUnique({
        where: { userId_source_externalId: { userId, source, externalId: m.externalId } },
      });
      if (existing) {
        skipped++;
        continue;
      }
    }
    await prisma.bodyMeasurement.create({ data });
    created++;
  }
  return { created, skipped };
}

bodyRouter.get("/measurements", async (req: AuthedRequest, res) => {
  const from = parseDateParam(req.query.from);
  const to = parseDateParam(req.query.to);
  const rows = await prisma.bodyMeasurement.findMany({
    where: { userId: req.userId, measuredAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } },
    orderBy: { measuredAt: "asc" },
  });
  res.json(rows);
});

bodyRouter.post("/measurements", async (req: AuthedRequest, res) => {
  const blocked = await requireBodyConsent(req.userId!);
  if (blocked) return res.status(403).json({ error: blocked });
  const parsed = measurementInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const result = await saveMeasurements(req.userId!, "MANUAL", [parsed.data]);
  res.status(201).json(result);
});

bodyRouter.delete("/measurements/:id", async (req: AuthedRequest, res) => {
  const row = await prisma.bodyMeasurement.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!row) return res.status(404).json({ error: "Measurement not found" });
  await prisma.bodyMeasurement.delete({ where: { id: row.id } });
  res.status(204).send();
});

// GET /body/summary?from=&to= - per-metric first/last/average inside a
// period, for the period-on-period comparison.
bodyRouter.get("/summary", async (req: AuthedRequest, res) => {
  const from = parseDateParam(req.query.from);
  const to = parseDateParam(req.query.to);
  if (!from || !to) return res.status(400).json({ error: "from and to are required" });
  const rows = await prisma.bodyMeasurement.findMany({
    where: { userId: req.userId, measuredAt: { gte: from, lt: to } },
    orderBy: { measuredAt: "asc" },
  });
  const out: Record<string, { count: number; first: number | null; last: number | null; average: number | null }> = {};
  for (const metric of metricSchema.options) {
    const r = readingsFor(metric, rows);
    out[metric] = {
      count: r.length,
      first: r[0]?.value ?? null,
      last: r[r.length - 1]?.value ?? null,
      average: r.length ? Math.round((r.reduce((a, b) => a + b.value, 0) / r.length) * 10) / 10 : null,
    };
  }
  res.json(out);
});

// --- Goals ----------------------------------------------------------------

function toTarget(t: { anchorDate: Date; anchorValue: number; targetValue: number; targetDate: Date; reason: string | null; note: string | null; createdAt: Date }): Target {
  return { ...t, reason: t.reason as Target["reason"] };
}

// GET /body/goals - every goal with its target versions (oldest first), the
// readings needed to draw its chart, and its current pace status.
bodyRouter.get("/goals", async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const [goals, rows] = await Promise.all([
    prisma.bodyGoal.findMany({ where: { userId }, include: { targets: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "desc" } }),
    prisma.bodyMeasurement.findMany({ where: { userId }, orderBy: { measuredAt: "asc" } }),
  ]);

  res.json(
    goals.map((g) => {
      const metric = g.metric as BodyMetric;
      const targets = g.targets.map(toTarget);
      const current = targets[targets.length - 1];
      const direction = goalDirection(g.startValue, targets[0]);
      const chartFrom = new Date(g.startDate.getTime() - 14 * DAY_MS);
      const readings = readingsFor(metric, rows).filter((r) => r.date >= chartFrom);
      const sinceStart = readings.filter((r) => r.date >= g.startDate);
      return {
        id: g.id,
        metric,
        status: g.status,
        startValue: g.startValue,
        startDate: g.startDate,
        closedAt: g.closedAt,
        direction,
        targets: targets.map((t, i) => ({
          ...t,
          revisionDirection: i === 0 ? null : revisionDirection(direction, targets[i - 1], t),
        })),
        readings,
        pace: paceStatus(metric, direction, current, sinceStart),
      };
    })
  );
});

const createGoalSchema = z.object({
  metric: metricSchema,
  targetValue: z.number().positive(),
  targetDate: z.string().refine(isDayKey, "targetDate must be YYYY-MM-DD"),
  // Optional: defaults to your latest reading for the metric.
  startValue: z.number().positive().optional(),
});

bodyRouter.post("/goals", async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const blocked = await requireBodyConsent(userId);
  if (blocked) return res.status(403).json({ error: blocked });
  const parsed = createGoalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { metric, targetValue, targetDate, startValue } = parsed.data;

  const existing = await prisma.bodyGoal.findFirst({ where: { userId, metric, status: "ACTIVE" } });
  if (existing) {
    return res.status(409).json({ error: "You already have an active goal for this metric — revise it instead of starting a new one." });
  }

  const rows = await prisma.bodyMeasurement.findMany({ where: { userId }, orderBy: { measuredAt: "asc" } });
  const readings = readingsFor(metric, rows);
  const start = startValue ?? readings[readings.length - 1]?.value;
  if (start == null) {
    return res.status(400).json({ error: "Log at least one measurement for this metric first (or enter a starting value)." });
  }
  const now = new Date();
  const target = dayKeyToDate(targetDate);
  if (target.getTime() <= now.getTime()) {
    return res.status(400).json({ error: "The target date must be in the future." });
  }
  if (targetValue === start) {
    return res.status(400).json({ error: "The target is the same as where you are now." });
  }

  const goal = await prisma.bodyGoal.create({
    data: {
      userId,
      metric,
      startValue: start,
      startDate: now,
      targets: { create: { anchorDate: now, anchorValue: start, targetValue, targetDate: target } },
    },
  });
  res.status(201).json({ id: goal.id });
});

const reviseSchema = z
  .object({
    targetValue: z.number().positive().optional(),
    targetDate: z.string().refine(isDayKey, "targetDate must be YYYY-MM-DD").optional(),
    reason: z.enum(["INJURY_OR_ILLNESS", "LIFE_EVENT", "TOO_AMBITIOUS", "TOO_EASY", "CHANGED_PRIORITIES", "OTHER"]),
    note: z.string().max(500).optional(),
  })
  .refine((v) => v.targetValue != null || v.targetDate != null, { message: "Change the target value, the date, or both" });

// POST /body/goals/:id/revise - adds a new target version. The new pace
// line starts from where you actually are now (your latest reading), and
// the old version stays on record — nothing is overwritten.
bodyRouter.post("/goals/:id/revise", async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const parsed = reviseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const goal = await prisma.bodyGoal.findFirst({
    where: { id: req.params.id, userId },
    include: { targets: { orderBy: { createdAt: "asc" } } },
  });
  if (!goal) return res.status(404).json({ error: "Goal not found" });
  if (goal.status !== "ACTIVE") return res.status(400).json({ error: "Only active goals can be revised." });

  const current = toTarget(goal.targets[goal.targets.length - 1]);
  const now = new Date();
  const rows = await prisma.bodyMeasurement.findMany({ where: { userId }, orderBy: { measuredAt: "asc" } });
  const readings = readingsFor(goal.metric as BodyMetric, rows).filter((r) => r.date >= current.anchorDate);
  const anchorValue = readings[readings.length - 1]?.value ?? paceValueAt(current, now);
  const targetDate = parsed.data.targetDate ? dayKeyToDate(parsed.data.targetDate) : current.targetDate;
  if (targetDate.getTime() <= now.getTime()) return res.status(400).json({ error: "The target date must be in the future." });

  await prisma.goalTarget.create({
    data: {
      goalId: goal.id,
      anchorDate: now,
      anchorValue,
      targetValue: parsed.data.targetValue ?? current.targetValue,
      targetDate,
      reason: parsed.data.reason,
      note: parsed.data.note,
    },
  });
  res.status(201).json({ ok: true });
});

const statusSchema = z.object({ status: z.enum(["ACTIVE", "ACHIEVED", "CLOSED"]) });

// PATCH /body/goals/:id - mark a goal achieved, close it, or reopen it.
bodyRouter.patch("/goals/:id", async (req: AuthedRequest, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const goal = await prisma.bodyGoal.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!goal) return res.status(404).json({ error: "Goal not found" });
  await prisma.bodyGoal.update({
    where: { id: goal.id },
    data: { status: parsed.data.status, closedAt: parsed.data.status === "ACTIVE" ? null : new Date() },
  });
  res.status(204).send();
});

// GET /body/review?quarter=2026-Q4 - the quarterly goal-setting review
// (defaults to the current quarter).
bodyRouter.get("/review", async (req: AuthedRequest, res) => {
  const quarter = typeof req.query.quarter === "string" ? req.query.quarter : quarterOf(new Date());
  const goals = await prisma.bodyGoal.findMany({
    where: { userId: req.userId },
    include: { targets: { orderBy: { createdAt: "asc" } } },
  });
  try {
    res.json(
      buildQuarterReview(
        quarter,
        goals.map((g) => ({
          id: g.id,
          metric: g.metric as BodyMetric,
          startValue: g.startValue,
          createdAt: g.createdAt,
          status: g.status,
          closedAt: g.closedAt,
          targets: g.targets.map(toTarget),
        }))
      )
    );
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Bad quarter" });
  }
});

// GET /body/benchmarks - where your latest scan sits against published
// healthy ranges for your age and sex. Needs BENCHMARKING consent and the
// relevant profile fields; says what's missing otherwise.
bodyRouter.get("/benchmarks", async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  if (!(await hasConsent(userId, "BENCHMARKING"))) {
    return res.json({ available: false, reason: CONSENT_REQUIRED_MESSAGE.BENCHMARKING, benchmarks: [] });
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const rows = await prisma.bodyMeasurement.findMany({ where: { userId }, orderBy: { measuredAt: "asc" } });
  const latestFat = readingsFor("BODY_FAT_PCT", rows).pop();
  const latestWeight = readingsFor("BODY_WEIGHT_KG", rows).pop();
  const benchmarks: Benchmark[] = [];
  const missing: string[] = [];
  const age = user.birthYear ? new Date().getFullYear() - user.birthYear : null;

  if (latestFat) {
    if (user.sex && age) {
      const b = bodyFatBenchmark(user.sex, age, latestFat.value);
      if (b) benchmarks.push(b);
    } else missing.push("birth year and sex (for body fat)");
  }
  if (latestWeight) {
    if (user.heightCm) benchmarks.push(bmiBenchmark(user.heightCm, latestWeight.value));
    else missing.push("height (for BMI)");
  }
  if (!latestFat && !latestWeight) missing.push("a body scan");
  res.json({
    available: benchmarks.length > 0,
    reason: missing.length ? `Add ${missing.join(" and ")} to see comparisons.` : null,
    benchmarks,
  });
});
