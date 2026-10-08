import { ConsentPurpose } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

// The wording shown for each consent. Bump CONSENT_TEXT_VERSION whenever any
// of it changes. Every ConsentRecord stores the version it was given
// against, so earlier answers stay tied to the wording people actually saw.
//
// NOTE: this is a sensible starting design, not legal advice. Before the
// app is offered to the public, have the wording, lawful bases and
// retention reviewed by someone qualified in UK GDPR / EU GDPR and the
// other markets you launch in (body composition counts as health data,
// which is special-category data under GDPR).
export const CONSENT_TEXT_VERSION = "2026-10-08";

export const CONSENT_PURPOSES: {
  purpose: ConsentPurpose;
  title: string;
  description: string;
  /** What switching it off does, shown before someone withdraws. */
  withdrawEffect: string;
}[] = [
  {
    purpose: "PROFILE",
    title: "Store my profile",
    description: "Keep my age (birth year), sex and height so the app can put my numbers in context.",
    withdrawEffect: "Your birth year, sex and height are deleted straight away.",
  },
  {
    purpose: "BODY_DATA",
    title: "Store my body and activity data",
    description:
      "Keep my body-composition scans (weight, body fat, muscle mass), daily steps and body goals, whether I type them in or import them from Renpho or Apple Health. This is health data.",
    withdrawEffect: "All your stored scans, steps and body goals are deleted straight away, and imports stop.",
  },
  {
    purpose: "BENCHMARKING",
    title: "Compare me with public reference data",
    description: "Use my profile and body data to show where I sit against published healthy ranges for my age and sex. Comparisons are worked out inside the app, and nothing is sent anywhere.",
    withdrawEffect: "Comparisons stop showing. Nothing else changes.",
  },
  {
    purpose: "PRODUCT_ANALYTICS",
    title: "Help improve the app",
    description: "Allow anonymous, aggregated usage statistics in future versions. Nothing is collected for this today.",
    withdrawEffect: "Nothing is collected. This is recorded for when the feature exists.",
  },
];

export type ConsentState = Record<ConsentPurpose, boolean | null>;

/** Current answer per purpose: the most recent record, or null if never asked. */
export async function getConsentState(userId: string): Promise<ConsentState> {
  const records = await prisma.consentRecord.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  const state: ConsentState = { PROFILE: null, BODY_DATA: null, BENCHMARKING: null, PRODUCT_ANALYTICS: null };
  for (const r of records) state[r.purpose] = r.granted;
  return state;
}

export async function hasConsent(userId: string, purpose: ConsentPurpose): Promise<boolean> {
  const latest = await prisma.consentRecord.findFirst({ where: { userId, purpose }, orderBy: { createdAt: "desc" } });
  return latest?.granted === true;
}

export const CONSENT_REQUIRED_MESSAGE: Record<ConsentPurpose, string> = {
  PROFILE: "Turn on \"Store my profile\" in Settings → Privacy & consent to save profile details.",
  BODY_DATA: "Turn on \"Store my body and activity data\" in Settings → Privacy & consent to save scans, steps or body goals.",
  BENCHMARKING: "Turn on \"Compare me with public reference data\" in Settings → Privacy & consent to see comparisons.",
  PRODUCT_ANALYTICS: "Analytics consent is required.",
};

/**
 * Records new choices (only purposes whose answer actually changed get a new
 * row) and applies the effect of any withdrawal immediately.
 */
export async function recordConsents(userId: string, choices: Partial<Record<ConsentPurpose, boolean>>): Promise<ConsentState> {
  const current = await getConsentState(userId);
  const changed = (Object.entries(choices) as [ConsentPurpose, boolean][]).filter(([p, v]) => current[p] !== v);

  await prisma.$transaction(async (tx) => {
    for (const [purpose, granted] of changed) {
      await tx.consentRecord.create({ data: { userId, purpose, granted, textVersion: CONSENT_TEXT_VERSION } });
    }
    const withdrawn = new Set(changed.filter(([, v]) => !v).map(([p]) => p));
    if (withdrawn.has("PROFILE")) {
      await tx.user.update({ where: { id: userId }, data: { birthYear: null, sex: null, heightCm: null } });
    }
    if (withdrawn.has("BODY_DATA")) {
      await tx.bodyMeasurement.deleteMany({ where: { userId } });
      await tx.bodyGoal.deleteMany({ where: { userId } });
      await tx.stepDay.deleteMany({ where: { userId } });
      // No data may flow in any more, so the upload token goes too.
      await tx.user.update({ where: { id: userId }, data: { ingestTokenHash: null } });
    }
    await tx.user.update({ where: { id: userId }, data: { consentReviewedAt: new Date() } });
  });

  return getConsentState(userId);
}
