import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AuthedRequest } from "../lib/requireAuth.js";
import { CONSENT_PURPOSES, CONSENT_TEXT_VERSION, getConsentState, recordConsents } from "../services/consent.js";

export const consentRouter = Router();

// GET /consent - each purpose's wording, the current answer, and when it
// was last changed — what Settings → Privacy & consent and the sign-up
// consent step both show.
consentRouter.get("/", async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const [state, user, history] = await Promise.all([
    getConsentState(userId),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { consentReviewedAt: true } }),
    prisma.consentRecord.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
  ]);
  res.json({
    textVersion: CONSENT_TEXT_VERSION,
    reviewed: user.consentReviewedAt !== null,
    purposes: CONSENT_PURPOSES.map((p) => ({
      ...p,
      granted: state[p.purpose],
      updatedAt: history.find((h) => h.purpose === p.purpose)?.createdAt ?? null,
    })),
    history: history.map((h) => ({ purpose: h.purpose, granted: h.granted, textVersion: h.textVersion, at: h.createdAt })),
  });
});

const choicesSchema = z.object({
  choices: z
    .object({
      PROFILE: z.boolean(),
      BODY_DATA: z.boolean(),
      BENCHMARKING: z.boolean(),
      PRODUCT_ANALYTICS: z.boolean(),
    })
    .partial(),
});

// POST /consent - record choices. Withdrawals take effect immediately (see
// services/consent.ts for what each one deletes).
consentRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = choicesSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const state = await recordConsents(req.userId!, parsed.data.choices);
  res.json({ state });
});
