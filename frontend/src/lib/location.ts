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

// Safari (and some other browsers) ask for location permission again on every
// visit. So the last position is kept on this device and used for the weather,
// and the browser is only asked the first time or when the person taps Update.
const SAVED_KEY = "savedLocation";
const SAVED_MAX_AGE_MS = 30 * 86400_000;

/** The remembered position, if there is a recent one. */
export function getSavedLocation(): Coords | null {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v.latitude !== "number" || typeof v.longitude !== "number" || Date.now() - Number(v.savedAt) > SAVED_MAX_AGE_MS) return null;
    return { latitude: v.latitude, longitude: v.longitude };
  } catch {
    return null;
  }
}

/** Remembers a position on this device, rounded to about 1 km. Weather doesn't need more. */
export function saveLocation(c: Coords): void {
  try {
    const r = (n: number) => Math.round(n * 100) / 100;
    localStorage.setItem(SAVED_KEY, JSON.stringify({ latitude: r(c.latitude), longitude: r(c.longitude), savedAt: Date.now() }));
  } catch {
    /* private mode or storage blocked: the browser is just asked next time */
  }
}

export function forgetLocation(): void {
  try {
    localStorage.removeItem(SAVED_KEY);
  } catch {
    /* nothing to do */
  }
}

/** The position to use for the weather: the remembered one without asking the
 * browser, otherwise a fresh (prompting) request that is then remembered.
 * `refresh` skips the remembered one. Reports whether it used the remembered one. */
export async function getLocation(refresh = false): Promise<{ coords: Coords | null; fromSaved: boolean }> {
  if (!refresh) {
    const saved = getSavedLocation();
    if (saved) return { coords: saved, fromSaved: true };
  }
  const fresh = await requestLocation();
  if (fresh) {
    saveLocation(fresh);
    return { coords: fresh, fromSaved: false };
  }
  // Refresh was refused or failed: carry on with the remembered position if any.
  const saved = refresh ? getSavedLocation() : null;
  return { coords: saved, fromSaved: saved !== null };
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
