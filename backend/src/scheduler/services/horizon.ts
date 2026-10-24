import { DAY_MS, dayKeyToDate, dateToDayKey, isDayKey } from "../../lib/dates.js";

// How far ahead a new training plan looks. A plan ends on a calendar quarter
// so it lines up with the quarterly run plan and quarter reviews:
// - with at least 8 weeks (about 2 months) left in the current quarter, the
//   plan runs to the end of this quarter (a full 3 months, or the part of it
//   that remains);
// - with less than that, it runs to the end of the NEXT quarter, so the plan
//   is never just a few weeks long.
// The person can instead choose any date in the future.

export const MIN_REMAINING_DAYS = 56; // 8 weeks
export const MIN_HORIZON_DAYS = 14;
export const MAX_HORIZON_DAYS = 548; // about 18 months

export interface SuggestedHorizon {
  kind: "THIS_QUARTER" | "NEXT_QUARTER";
  endDate: string;
  weeks: number;
  quarterLabel: string; // e.g. "Q4 2026"
  reason: string;
}

/** Last day of the calendar quarter containing the day key (UTC calendar). */
export function quarterEndKey(key: string): string {
  const d = dayKeyToDate(key);
  const q = Math.floor(d.getUTCMonth() / 3);
  return dateToDayKey(new Date(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 0)));
}

export function quarterLabel(key: string): string {
  const d = dayKeyToDate(key);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}

/** Whole days from one key to another (to - from). */
export function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((dayKeyToDate(toKey).getTime() - dayKeyToDate(fromKey).getTime()) / DAY_MS);
}

export function weeksBetween(fromKey: string, toKey: string): number {
  return Math.max(1, Math.round((daysBetween(fromKey, toKey) + 1) / 7));
}

export function suggestHorizon(todayKey: string): SuggestedHorizon {
  const thisEnd = quarterEndKey(todayKey);
  const remaining = daysBetween(todayKey, thisEnd) + 1; // today counts
  if (remaining >= MIN_REMAINING_DAYS) {
    const weeks = weeksBetween(todayKey, thisEnd);
    return {
      kind: "THIS_QUARTER",
      endDate: thisEnd,
      weeks,
      quarterLabel: quarterLabel(todayKey),
      reason:
        remaining >= 85
          ? `A full quarter: about ${weeks} weeks, ending when ${quarterLabel(todayKey)} ends.`
          : `${quarterLabel(todayKey)} has about ${weeks} weeks left, so your plan runs to the end of it.`,
    };
  }
  // Day after this quarter ends is the first day of the next; its end is
  // the end of the quarter containing it.
  const nextStart = dateToDayKey(new Date(dayKeyToDate(thisEnd).getTime() + DAY_MS));
  const nextEnd = quarterEndKey(nextStart);
  const weeks = weeksBetween(todayKey, nextEnd);
  return {
    kind: "NEXT_QUARTER",
    endDate: nextEnd,
    weeks,
    quarterLabel: quarterLabel(nextStart),
    reason: `Only about ${Math.max(1, Math.round(remaining / 7))} weeks are left in ${quarterLabel(todayKey)}, so your plan runs on to the end of ${quarterLabel(nextStart)} (about ${weeks} weeks).`,
  };
}

/** Checks a person-chosen end date. Returns an error message, or null if fine. */
export function checkCustomEnd(todayKey: string, endKey: unknown): string | null {
  if (!isDayKey(endKey)) return "Choose an end date.";
  const days = daysBetween(todayKey, endKey);
  if (Number.isNaN(days)) return "Choose a valid end date.";
  if (days < MIN_HORIZON_DAYS) return "Pick a date at least two weeks from today, so there's something to plan.";
  if (days > MAX_HORIZON_DAYS) return "Pick a date within the next 18 months.";
  return null;
}

export function horizonLimits(todayKey: string) {
  return {
    min: dateToDayKey(new Date(dayKeyToDate(todayKey).getTime() + MIN_HORIZON_DAYS * DAY_MS)),
    max: dateToDayKey(new Date(dayKeyToDate(todayKey).getTime() + MAX_HORIZON_DAYS * DAY_MS)),
  };
}
