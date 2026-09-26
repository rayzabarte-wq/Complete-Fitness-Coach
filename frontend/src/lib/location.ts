export interface Coords {
  latitude: number;
  longitude: number;
}

/** Prompts the browser's native location permission dialog and resolves
 * with coordinates, or null if denied/unavailable/unsupported. Never
 * rejects — every failure path just means "no location", handled by the
 * caller falling back gracefully. */
export function requestLocation(): Promise<Coords | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 10000 }
    );
  });
}

/** The browser's IANA timezone (e.g. "America/New_York") — no permission
 * needed, always available. Used so date/time displays and the weather
 * forecast's day boundaries match wherever the user actually is. */
export function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Parses a YYYY-MM-DD date-only string as a local calendar date. Plain
 * `new Date("2026-09-15")` parses date-only strings as UTC midnight, which
 * renders as the previous day for anyone west of UTC — this avoids that
 * off-by-one shift. */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** The inverse of parseLocalDate — formats a Date as YYYY-MM-DD using its
 * local calendar date (not UTC), so "today" means today wherever the
 * viewer actually is. */
export function formatLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
