import { Router } from "express";
import { z } from "zod";
import { NutritionSource } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AuthedRequest } from "../lib/requireAuth.js";
import { addDays, dateToDayKey, dayKeyToDate, isDayKey, parseDateParam } from "../lib/dates.js";
import { CONSENT_REQUIRED_MESSAGE, hasConsent } from "../services/consent.js";

// Daily calories and macros: a passive daily log, normally imported from
// Apple Health by an iPhone Shortcut (MyFitnessPal and similar apps write
// their totals there; see routes/ingest.ts), with manual entry as a fallback.

export const nutritionRouter = Router();

// A number that may arrive as text ("2,134.5" from a Shortcut) or be blank.
const amount = (max: number) =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : typeof v === "string" ? v.replace(/,/g, "").trim() : v),
    z.coerce.number().min(0).max(max).optional()
  );

export const nutritionDaySchema = z
  .object({
    date: z.string().refine(isDayKey, "date must be YYYY-MM-DD"),
    calories: amount(20000),
    proteinG: amount(2000),
    carbsG: amount(5000),
    fatG: amount(2000),
  })
  .refine((d) => [d.calories, d.proteinG, d.carbsG, d.fatG].some((v) => v !== undefined), "Send at least one of calories, proteinG, carbsG, fatG");

type NutritionDayInput = z.infer<typeof nutritionDaySchema>;

/** Saves each day. Only the fields sent are changed, so a day that arrives
 * with just calories doesn't wipe protein already logged for it. */
export async function saveNutritionDays(userId: string, source: NutritionSource, days: NutritionDayInput[]) {
  for (const d of days) {
    const date = dayKeyToDate(d.date);
    const values = {
      ...(d.calories !== undefined ? { calories: Math.round(d.calories) } : {}),
      ...(d.proteinG !== undefined ? { proteinG: Math.round(d.proteinG * 10) / 10 } : {}),
      ...(d.carbsG !== undefined ? { carbsG: Math.round(d.carbsG * 10) / 10 } : {}),
      ...(d.fatG !== undefined ? { fatG: Math.round(d.fatG * 10) / 10 } : {}),
    };
    await prisma.nutritionDay.upsert({
      where: { userId_date: { userId, date } },
      update: { ...values, source },
      create: { userId, date, ...values, source },
    });
  }
  return { saved: days.length };
}

const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

// GET /nutrition?from=YYYY-MM-DD&to=YYYY-MM-DD (to exclusive) - the days in
// range, with the period's average for each figure over the days that have it.
nutritionRouter.get("/", async (req: AuthedRequest, res) => {
  const to = parseDateParam(req.query.to) ?? addDays(dayKeyToDate(dateToDayKey(new Date())), 1);
  const from = parseDateParam(req.query.from) ?? addDays(to, -30);
  const rows = await prisma.nutritionDay.findMany({ where: { userId: req.userId, date: { gte: from, lt: to } }, orderBy: { date: "asc" } });
  const pick = (f: "calories" | "proteinG" | "carbsG" | "fatG") => rows.map((r) => r[f]).filter((v): v is number => v !== null);
  const avgCalories = mean(pick("calories"));
  res.json({
    days: rows.map((r) => ({
      date: dateToDayKey(r.date),
      calories: r.calories,
      proteinG: r.proteinG,
      carbsG: r.carbsG,
      fatG: r.fatG,
      source: r.source,
    })),
    daysWithData: rows.length,
    average: {
      calories: avgCalories === null ? null : Math.round(avgCalories),
      proteinG: mean(pick("proteinG")),
      carbsG: mean(pick("carbsG")),
      fatG: mean(pick("fatG")),
    },
  });
});

// PUT /nutrition/:date - set one day's figures by hand.
nutritionRouter.put("/:date", async (req: AuthedRequest, res) => {
  if (!(await hasConsent(req.userId!, "BODY_DATA"))) {
    return res.status(403).json({ error: CONSENT_REQUIRED_MESSAGE.BODY_DATA });
  }
  const parsed = nutritionDaySchema.safeParse({ ...(req.body ?? {}), date: req.params.date });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await saveNutritionDays(req.userId!, "MANUAL", [parsed.data]);
  res.status(204).send();
});
