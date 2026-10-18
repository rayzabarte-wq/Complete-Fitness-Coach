export interface Coords {
  latitude: number;
  longitude: number;
}

/** Prompts the browser's native location permission dialog and resolves
 * with coordinates, or null if denied/unavailable/unsupported. Never
 * rejects — every failure path just means "no location", handled by the
 * caller falling back gracefully. */
export function requestLocation(timeoutMs = 10000): Promise<Coords | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { timeout: timeoutMs, maximumAge: 5 * 60 * 1000 }
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

/** Whether the browser will give a position without asking. "unknown" where
 * the Permissions API isn't available. */
async function permissionState(): Promise<"granted" | "prompt" | "denied" | "unknown"> {
  try {
    const p = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return p.state;
  } catch {
    return "unknown";
  }
}

/** The position to use for the weather, without nagging for permission.
 * - Location already allowed for this site: the current position, every time.
 * - Otherwise a remembered position is used, so Safari isn't asked again.
 * - Only with nothing remembered (the very first time), or when `refresh` is
 *   true (the person tapped Update), is the browser asked.
 * `fromSaved` says the remembered position was used rather than a fresh one. */
export async function getLocation(refresh = false): Promise<{ coords: Coords | null; fromSaved: boolean }> {
  const state = await permissionState();
  const saved = getSavedLocation();

  if (refresh || state === "granted" || (!saved && state !== "denied")) {
    const fresh = await requestLocation(state === "granted" ? 6000 : 10000);
    if (fresh) {
      saveLocation(fresh);
      return { coords: fresh, fromSaved: false };
    }
  }
  // Refused, timed out or not asked: carry on with the remembered position if any.
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
