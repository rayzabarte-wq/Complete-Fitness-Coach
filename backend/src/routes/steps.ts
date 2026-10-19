import { Router } from "express";
import { z } from "zod";
import { StepSource } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AuthedRequest } from "../lib/requireAuth.js";
import { addDays, dateToDayKey, dayKeyToDate, isDayKey, parseDateParam } from "../lib/dates.js";
import { CONSENT_REQUIRED_MESSAGE, hasConsent } from "../services/consent.js";

// Daily steps: a simple passive daily log, normally imported from Apple
// Health by an iPhone Shortcut (see routes/ingest.ts), with manual entry as
// a fallback. The goal is an AVERAGE — progress compares your rolling
// average to it; the calendar ticks individual days that reached it.

export const stepsRouter = Router();

/**
 * Saves days of steps. `keepHigher` is for imports: a day's steps only ever go
 * up, so a later run that read less (a locked iPhone returns nothing from
 * Health, a run early in the day) must not wipe out what was already received.
 */
export async function saveStepDays(userId: string, source: StepSource, days: { date: string; steps: number }[], keepHigher = false) {
  let kept = 0;
  for (const d of days) {
    const date = dayKeyToDate(d.date);
    let steps = d.steps;
    if (keepHigher) {
      const existing = await prisma.stepDay.findUnique({ where: { userId_date: { userId, date } }, select: { steps: true } });
      if (existing && existing.steps > steps) {
        steps = existing.steps;
        kept++;
      }
    }
    await prisma.stepDay.upsert({
      where: { userId_date: { userId, date } },
      update: { steps, source },
      create: { userId, date, steps, source },
    });
  }
  return { saved: days.length, keptHigherExisting: kept };
}

/** Shortcuts often send a date with a time or in the phone's own format; make it YYYY-MM-DD. */
function normaliseDay(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/);
  if (iso) return iso[1];
  const t = Date.parse(s);
  return Number.isNaN(t) ? s : new Date(t).toISOString().slice(0, 10);
}

export const stepDaySchema = z.object({
  date: z.preprocess(normaliseDay, z.string().refine(isDayKey, "date must be YYYY-MM-DD, for example 2026-10-19")),
  // Lenient on purpose: the iPhone Shortcut often sends the total as text
  // ("8,234") or with decimals (8234.0), so both are accepted and rounded.
  steps: z.preprocess((v) => {
    if (typeof v === "string") {
      const n = Number(v.replace(/[,\s]/g, ""));
      return Number.isFinite(n) ? Math.round(n) : v;
    }
    return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : v;
  }, z.number().int().min(0).max(200000)),
});

// GET /steps?from=YYYY-MM-DD&to=YYYY-MM-DD (to exclusive) - the days in
// range, the goal, and the period's average over days with data.
stepsRouter.get("/", async (req: AuthedRequest, res) => {
  const to = parseDateParam(req.query.to) ?? addDays(dayKeyToDate(dateToDayKey(new Date())), 1);
  const from = parseDateParam(req.query.from) ?? addDays(to, -30);
  const [days, user] = await Promise.all([
    prisma.stepDay.findMany({ where: { userId: req.userId, date: { gte: from, lt: to } }, orderBy: { date: "asc" } }),
    prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { dailyStepGoal: true } }),
  ]);
  const total = days.reduce((a, d) => a + d.steps, 0);
  const goal = user.dailyStepGoal;
  res.json({
    goal,
    days: days.map((d) => ({ date: dateToDayKey(d.date), steps: d.steps, source: d.source, hitGoal: goal != null ? d.steps >= goal : null })),
    daysWithData: days.length,
    average: days.length ? Math.round(total / days.length) : null,
    daysHitGoal: goal != null ? days.filter((d) => d.steps >= goal).length : null,
  });
});

// PUT /steps/:date - set one day's steps by hand.
stepsRouter.put("/:date", async (req: AuthedRequest, res) => {
  if (!(await hasConsent(req.userId!, "BODY_DATA"))) {
    return res.status(403).json({ error: CONSENT_REQUIRED_MESSAGE.BODY_DATA });
  }
  const parsed = stepDaySchema.safeParse({ date: req.params.date, steps: req.body?.steps });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await saveStepDays(req.userId!, "MANUAL", [parsed.data]);
  res.status(204).send();
});
