import { prisma } from "../lib/prisma.js";

// The only feature names that can be recorded. Anything else is rejected, so
// the table can't fill up with arbitrary text. The app (frontend/src/lib/
// usage.ts) and the Admin page (pages/Admin.tsx) use the same names.
export const USAGE_EVENTS = [
  "page_calendar",
  "run_week_planned",
  "run_days_saved",
  "onboarding_completed",
  "onboarding_skipped",
  "page_day",
  "page_log",
  "page_progress",
  "page_settings",
  "page_plan",
  "log_steps_tab",
  "log_nutrition_tab",
  "log_other_sport_tab",
  "workout_generated",
  "workout_saved",
  "gym_switched",
  "gym_preset_applied",
  "custom_equipment_added",
  "custom_exercise_created",
  "steps_saved",
  "nutrition_saved",
  "body_scan_added",
  "goal_created",
  "message_dismissed",
  "golf_round_logged",
  "golf_goal_set",
  "ambitions_saved",
  "sport_goal_saved",
  "availability_saved",
  "golf_week_proposed",
  "golf_week_added",
  "golf_profile_saved",
  "golf_clubs_edited",
  "app_install_clicked",
] as const;
export type UsageEventName = (typeof USAGE_EVENTS)[number];

// Consent given against wording that said "nothing is collected for this
// today" doesn't cover collecting, so only answers recorded from this
// wording version onwards count. Versions are dates, so a string compare works.
export const ANALYTICS_WORDING_FROM = "2026-10-16";

export async function hasAnalyticsConsent(userId: string): Promise<boolean> {
  const latest = await prisma.consentRecord.findFirst({
    where: { userId, purpose: "PRODUCT_ANALYTICS" },
    orderBy: { createdAt: "desc" },
  });
  return latest?.granted === true && latest.textVersion >= ANALYTICS_WORDING_FROM;
}

export const USAGE_RETENTION_DAYS = 365;

export async function purgeOldUsage(): Promise<void> {
  const cutoff = new Date(Date.now() - USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.usageEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
}
