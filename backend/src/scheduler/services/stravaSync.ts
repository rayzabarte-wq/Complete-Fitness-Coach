import { prisma } from "../../lib/prisma.js";

const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const REDIRECT_URI = process.env.STRAVA_REDIRECT_URI;

const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const API_BASE = "https://www.strava.com/api/v3";
const SCOPES = "activity:read_all";

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
    approval_prompt: "auto",
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

export async function handleAuthCallback(code: string, userId: string): Promise<void> {
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
  await saveTokens(userId, tokens);
}

async function saveTokens(userId: string, tokens: TokenResponse): Promise<void> {
  const expiresAt = new Date(tokens.expires_at * 1000);
  await prisma.stravaAccount.upsert({
    where: { userId },
    update: { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt },
    create: { userId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt },
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
