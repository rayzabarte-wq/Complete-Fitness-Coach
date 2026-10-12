// Calendar-day helpers. A "day key" is YYYY-MM-DD; days are stored as UTC
// midnight of that key (the same convention PlannedSession uses), so a day
// key always round-trips regardless of the server's own timezone.

export const DAY_MS = 86400_000;

export function isDayKey(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function dayKeyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function dateToDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * DAY_MS);
}

/** Parses a ?from= / ?to= query value given as a day key or ISO timestamp. */
export function parseDateParam(v: unknown): Date | undefined {
  if (typeof v !== "string" || !v) return undefined;
  if (isDayKey(v)) return dayKeyToDate(v);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
