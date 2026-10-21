import { Router } from "express";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AuthedRequest } from "../lib/requireAuth.js";
import { CONSENT_REQUIRED_MESSAGE, hasConsent } from "../services/consent.js";
// Split logic belongs to the Sport module — imported through its public
// interface only.
import { splitForDays, MIN_TRAINING_DAYS, MAX_TRAINING_DAYS } from "../sport/index.js";

export const profileRouter = Router();

export function hashIngestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function ageFrom(birthYear: number | null): number | null {
  return birthYear ? new Date().getFullYear() - birthYear : null;
}

// GET /profile - profile fields, training settings, and the split each
// possible days-per-week choice would give (so Settings can preview it).
profileRouter.get("/", async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
  // The latest day an upload brought in, so Settings can show whether the
  // automatic steps import is arriving.
  const lastImport = await prisma.stepDay.findFirst({ where: { userId: req.userId, source: "APPLE_HEALTH" }, orderBy: { updatedAt: "desc" } });
  res.json({
    email: user.email,
    birthYear: user.birthYear,
    age: ageFrom(user.birthYear),
    sex: user.sex,
    heightCm: user.heightCm,
    trainingDaysPerWeek: user.trainingDaysPerWeek,
    runDaysPerWeek: user.runDaysPerWeek,
    totpEnabled: user.totpEnabled,
    split: splitForDays(user.trainingDaysPerWeek),
    splitOptions: Array.from({ length: MAX_TRAINING_DAYS - MIN_TRAINING_DAYS + 1 }, (_, i) => {
      const days = MIN_TRAINING_DAYS + i;
      return { days, split: splitForDays(days) };
    }),
    dailyStepGoal: user.dailyStepGoal,
    consentReviewed: user.consentReviewedAt !== null,
    hasIngestToken: user.ingestTokenHash !== null,
    lastStepsImport: lastImport ? { date: lastImport.date.toISOString().slice(0, 10), steps: lastImport.steps, receivedAt: lastImport.updatedAt.toISOString() } : null,
  });
});

const thisYear = new Date().getFullYear();
const updateProfileSchema = z.object({
  birthYear: z.number().int().min(thisYear - 100).max(thisYear - 16).nullable().optional(),
  sex: z.enum(["MALE", "FEMALE"]).nullable().optional(),
  heightCm: z.number().min(100).max(250).nullable().optional(),
  trainingDaysPerWeek: z.number().int().min(MIN_TRAINING_DAYS).max(MAX_TRAINING_DAYS).optional(),
  runDaysPerWeek: z.number().int().min(2).max(6).optional(),
  dailyStepGoal: z.number().int().min(1000).max(50000).nullable().optional(),
});

// PATCH /profile - update profile and training settings. Profile fields
// (age, sex, height) need PROFILE consent; training settings don't.
profileRouter.patch("/", async (req: AuthedRequest, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { birthYear, sex, heightCm, trainingDaysPerWeek, runDaysPerWeek, dailyStepGoal } = parsed.data;
  const touchesProfile = [birthYear, sex, heightCm].some((v) => v !== undefined && v !== null);
  if (touchesProfile && !(await hasConsent(req.userId!, "PROFILE"))) {
    return res.status(403).json({ error: CONSENT_REQUIRED_MESSAGE.PROFILE });
  }
  await prisma.user.update({
    where: { id: req.userId },
    data: { birthYear, sex, heightCm, trainingDaysPerWeek, runDaysPerWeek, dailyStepGoal },
  });
  res.status(204).send();
});

// POST /profile/ingest-token - creates (or replaces) the personal upload
// token used by the iPhone Shortcut / Renpho sync script. Returned once —
// only its hash is stored, so it can't be shown again. Needs BODY_DATA
// consent, since that's the only kind of data it can upload.
profileRouter.post("/ingest-token", async (req: AuthedRequest, res) => {
  if (!(await hasConsent(req.userId!, "BODY_DATA"))) {
    return res.status(403).json({ error: CONSENT_REQUIRED_MESSAGE.BODY_DATA });
  }
  const token = `cfc_${randomBytes(24).toString("base64url")}`;
  await prisma.user.update({ where: { id: req.userId }, data: { ingestTokenHash: hashIngestToken(token) } });
  res.status(201).json({ token });
});

// DELETE /profile/ingest-token - revokes it; uploads stop working at once.
profileRouter.delete("/ingest-token", async (req: AuthedRequest, res) => {
  await prisma.user.update({ where: { id: req.userId }, data: { ingestTokenHash: null } });
  res.status(204).send();
});
