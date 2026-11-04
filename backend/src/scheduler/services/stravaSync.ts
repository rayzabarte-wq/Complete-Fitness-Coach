import { prisma } from "../../lib/prisma.js";

const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const REDIRECT_URI = process.env.STRAVA_REDIRECT_URI;

const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const API_BASE = "https://www.strava.com/api/v3";
// read_all: your activities. write: update the watch activity with workout
// details. profile:read_all: only to read the metric/imperial setting.
const SCOPES = "activity:read_all,activity:write,profile:read_all";

function requireConfig() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    throw new Error(
      "Strava integration isn't configured — set STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, and STRAVA_REDIRECT_URI in .env"
    );
  }
}

// state carries the connecting user's ID through the OAuth round trip, the
// same approach used for Outlook — Strava's callback is a bare browser
// redirect with no way to carry our app's Bearer token.
export function getAuthorizeUrl(userId: string): string {
  requireConfig();
  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    redirect_uri: REDIRECT_URI!,
    response_type: "code",
    // "force" so people who connected before are asked for the new permissions.
    approval_prompt: "force",
    scope: SCOPES,
    state: userId,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds (Strava gives an absolute time, not a duration)
}

export async function handleAuthCallback(code: string, userId: string, grantedScope?: string): Promise<void> {
  requireConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    throw new Error(`Strava token exchange failed: ${res.status} ${await res.text()}`);
  }

  const tokens = (await res.json()) as TokenResponse;
  // Strava lets people untick permissions, so record what was actually granted.
  const granted = (grantedScope ?? "").split(/[,\s]+/);
  await saveTokens(userId, tokens, { canWrite: granted.includes("activity:write"), canReadUnits: granted.includes("profile:read_all") });
}

async function saveTokens(userId: string, tokens: TokenResponse, flags?: { canWrite: boolean; canReadUnits: boolean }): Promise<void> {
  const expiresAt = new Date(tokens.expires_at * 1000);
  await prisma.stravaAccount.upsert({
    where: { userId },
    update: { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt, ...(flags ?? {}) },
    create: { userId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt, ...(flags ?? {}) },
  });
}

async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  requireConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(`Strava token refresh failed: ${res.status} ${await res.text()}`);
  }

  return res.json() as Promise<TokenResponse>;
}

async function getValidAccessToken(userId: string): Promise<string | null> {
  const account = await prisma.stravaAccount.findUnique({ where: { userId } });
  if (!account) return null;

  const expiresSoon = account.expiresAt.getTime() - Date.now() < 5 * 60 * 1000;
  if (!expiresSoon) return account.accessToken;

  const refreshed = await refreshTokens(account.refreshToken);
  await saveTokens(userId, refreshed);
  return refreshed.access_token;
}

export async function isStravaConnected(userId: string): Promise<boolean> {
  return (await prisma.stravaAccount.findUnique({ where: { userId } })) !== null;
}

export interface StravaStatus {
  connected: boolean;
  /** Allowed to update activities. False for people who connected before this existed. */
  canWrite: boolean;
  autoUpdate: boolean;
}

export async function getStravaStatus(userId: string): Promise<StravaStatus> {
  const a = await prisma.stravaAccount.findUnique({ where: { userId }, select: { canWrite: true, autoUpdate: true } });
  return a ? { connected: true, canWrite: a.canWrite, autoUpdate: a.autoUpdate } : { connected: false, canWrite: false, autoUpdate: false };
}

export async function setStravaAutoUpdate(userId: string, autoUpdate: boolean): Promise<void> {
  await prisma.stravaAccount.updateMany({ where: { userId }, data: { autoUpdate } });
}

async function stravaFetch(userId: string, path: string, init?: RequestInit): Promise<Response> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) throw new Error("Strava isn't connected");
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
  });
}

export interface RawWatchActivity {
  id: string;
  name: string;
  sportType: string;
  startMs: number;
  elapsedSeconds: number;
}

/** Activities starting in a UTC time range, with the UTC start Strava reports. */
export async function listActivitiesInRange(userId: string, afterMs: number, beforeMs: number): Promise<RawWatchActivity[]> {
  const params = new URLSearchParams({ after: String(Math.floor(afterMs / 1000)), before: String(Math.floor(beforeMs / 1000)), per_page: "50" });
  const res = await stravaFetch(userId, `/athlete/activities?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to fetch Strava activities: ${res.status}`);
  const batch = (await res.json()) as Array<{ id: number; name: string; type: string; sport_type?: string; start_date: string; elapsed_time: number }>;
  return batch.map((a) => ({ id: String(a.id), name: a.name, sportType: a.sport_type ?? a.type, startMs: new Date(a.start_date).getTime(), elapsedSeconds: a.elapsed_time }));
}

export interface ActivityDetail {
  id: string;
  name: string;
  description: string | null;
  calories: number | null;
  elapsedSeconds: number;
}

export async function getActivityDetail(userId: string, activityId: string): Promise<ActivityDetail> {
  const res = await stravaFetch(userId, `/activities/${encodeURIComponent(activityId)}`);
  if (!res.ok) throw new Error(`Failed to read the Strava activity: ${res.status}`);
  const a = (await res.json()) as { id: number; name: string; description?: string | null; calories?: number; elapsed_time: number };
  return { id: String(a.id), name: a.name, description: a.description ?? null, calories: a.calories && a.calories > 0 ? a.calories : null, elapsedSeconds: a.elapsed_time };
}

/** Writes only the fields given. Throws a StravaWriteError when Strava refuses. */
export class StravaWriteError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function updateActivity(userId: string, activityId: string, fields: { name?: string; description?: string }): Promise<void> {
  const res = await stravaFetch(userId, `/activities/${encodeURIComponent(activityId)}`, { method: "PUT", body: JSON.stringify(fields) });
  if (!res.ok) throw new StravaWriteError(res.status, `Strava refused the update (${res.status})`);
}

/** The athlete's own units setting ("feet" = imperial, "meters" = metric), or null if unavailable. */
export async function getMeasurementPreference(userId: string): Promise<string | null> {
  try {
    const res = await stravaFetch(userId, "/athlete");
    if (!res.ok) return null;
    const a = (await res.json()) as { measurement_preference?: string };
    return a.measurement_preference ?? null;
  } catch {
    return null;
  }
}

export async function disconnectStrava(userId: string): Promise<void> {
  await prisma.stravaAccount.deleteMany({ where: { userId } });
}

export interface StravaActivity {
  id: string;
  name: string;
  type: string; // Strava's own activity type string, e.g. "Run", "Ride"
  startDate: string; // ISO
  movingMinutes: number; // converted from Strava's moving_time (seconds)
  distanceMiles: number;
  elapsedMinutes?: number; // start to finish, including stops
}

/** Activities on the given local calendar date (YYYY-MM-DD), for picking
 * which one to link to a planned session's actual time. Strava's API
 * filters by a Unix time range, so this widens to the full day. */
export async function getActivitiesForDate(userId: string, dateKey: string): Promise<StravaActivity[]> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("Strava isn't connected");
  }

  const dayStart = Math.floor(new Date(`${dateKey}T00:00:00`).getTime() / 1000);
  const dayEnd = dayStart + 24 * 60 * 60;

  const params = new URLSearchParams({
    after: String(dayStart),
    before: String(dayEnd),
    per_page: "30",
  });

  const res = await fetch(`${API_BASE}/athlete/activities?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Strava activities: ${res.status} ${await res.text()}`);
  }

  const activities = (await res.json()) as Array<{
    id: number;
    name: string;
    type: string;
    start_date_local: string;
    moving_time: number;
    distance: number;
  }>;

  return activities.map((a) => ({
    id: String(a.id),
    name: a.name,
    type: a.type,
    startDate: a.start_date_local,
    movingMinutes: Math.round(a.moving_time / 60),
    distanceMiles: Math.round((a.distance / 1609.34) * 10) / 10,
  }));
}

/** Strava "Golf" activities that started between two dates (local days), newest
 * first. Pages through the athlete's activities in that range. */
export async function getGolfActivities(userId: string, from: Date, to: Date): Promise<StravaActivity[]> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("Strava isn't connected");
  }

  const out: StravaActivity[] = [];
  for (let page = 1; page <= 5; page++) {
    const params = new URLSearchParams({
      // A day either side, because Strava filters on UTC and callers filter on local days.
      after: String(Math.floor(from.getTime() / 1000) - 86400),
      before: String(Math.floor(to.getTime() / 1000) + 86400),
      per_page: "100",
      page: String(page),
    });
    const res = await fetch(`${API_BASE}/athlete/activities?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch Strava activities: ${res.status} ${await res.text()}`);
    }
    const batch = (await res.json()) as Array<{
      id: number;
      name: string;
      type: string;
      sport_type?: string;
      start_date_local: string;
      moving_time: number;
      elapsed_time?: number;
      distance: number;
    }>;
    for (const a of batch) {
      if (a.type !== "Golf" && a.sport_type !== "Golf") continue;
      out.push({
        id: String(a.id),
        name: a.name,
        type: "Golf",
        startDate: a.start_date_local,
        movingMinutes: Math.round(a.moving_time / 60),
        elapsedMinutes: a.elapsed_time ? Math.round(a.elapsed_time / 60) : undefined,
        distanceMiles: Math.round((a.distance / 1609.34) * 10) / 10,
      });
    }
    if (batch.length < 100) break;
  }
  return out;
}

export interface StravaActivityDetail extends StravaActivity {
  sportType: string; // Strava's finer type, e.g. "TrailRun", "GravelRide"
  workoutType: number | null; // Runs: 1 race, 2 long run, 3 workout
}

/** Every activity that started between two dates (plus a day either side, as
 * Strava filters on UTC), newest first, with the details the importer needs. */
export async function getActivitiesBetween(userId: string, from: Date, to: Date): Promise<StravaActivityDetail[]> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("Strava isn't connected");
  }
  const out: StravaActivityDetail[] = [];
  for (let page = 1; page <= 5; page++) {
    const params = new URLSearchParams({
      after: String(Math.floor(from.getTime() / 1000) - 86400),
      before: String(Math.floor(to.getTime() / 1000) + 86400),
      per_page: "100",
      page: String(page),
    });
    const res = await fetch(`${API_BASE}/athlete/activities?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch Strava activities: ${res.status} ${await res.text()}`);
    }
    const batch = (await res.json()) as Array<{
      id: number;
      name: string;
      type: string;
      sport_type?: string;
      workout_type?: number | null;
      start_date_local: string;
      moving_time: number;
      elapsed_time?: number;
      distance: number;
    }>;
    for (const a of batch) {
      out.push({
        id: String(a.id),
        name: a.name,
        type: a.type,
        sportType: a.sport_type ?? a.type,
        workoutType: a.workout_type ?? null,
        startDate: a.start_date_local,
        movingMinutes: Math.round(a.moving_time / 60),
        elapsedMinutes: a.elapsed_time ? Math.round(a.elapsed_time / 60) : undefined,
        distanceMiles: Math.round((a.distance / 1609.34) * 10) / 10,
      });
    }
    if (batch.length < 100) break;
  }
  return out;
}
