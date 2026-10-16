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

export async function saveStepDays(userId: string, source: StepSource, days: { date: string; steps: number }[]) {
  for (const d of days) {
    const date = dayKeyToDate(d.date);
    await prisma.stepDay.upsert({
      where: { userId_date: { userId, date } },
      update: { steps: d.steps, source },
      create: { userId, date, steps: d.steps, source },
    });
  }
  return { saved: days.length };
}

export const stepDaySchema = z.object({
  date: z.string().refine(isDayKey, "date must be YYYY-MM-DD"),
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
