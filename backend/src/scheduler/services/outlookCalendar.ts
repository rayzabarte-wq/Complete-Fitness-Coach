import { prisma } from "../../lib/prisma.js";

const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI;

// "common" allows both personal Microsoft/Outlook.com accounts and work/school
// accounts to sign in — matches how Outlook actually gets used on iOS/macOS.
const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SCOPES = "offline_access Calendars.ReadWrite User.Read";

function requireConfig() {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    throw new Error(
      "Outlook integration isn't configured — set MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_REDIRECT_URI in .env"
    );
  }
}

// The OAuth callback is hit by a bare browser redirect from Microsoft, with
// no way to carry our app's Bearer token — so the connecting user's ID is
// passed through as the `state` param and read back on the way in. state
// isn't secret (it's just a cuid), but it lets the callback know whose
// account to attach the tokens to.
export function getAuthorizeUrl(userId: string): string {
  requireConfig();
  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    response_type: "code",
    redirect_uri: REDIRECT_URI!,
    response_mode: "query",
    scope: SCOPES,
    state: userId,
  });
  return `${AUTHORITY}/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
}

/** Exchanges the authorization code from the OAuth redirect for tokens and
 * stores them against the connecting user (identified via `state`). */
export async function handleAuthCallback(code: string, userId: string): Promise<void> {
  requireConfig();
  const res = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      redirect_uri: REDIRECT_URI!,
      grant_type: "authorization_code",
      code,
      scope: SCOPES,
    }),
  });

  if (!res.ok) {
    throw new Error(`Microsoft token exchange failed: ${res.status} ${await res.text()}`);
  }

  const tokens = (await res.json()) as TokenResponse;
  await saveTokens(userId, tokens);
}

async function saveTokens(userId: string, tokens: TokenResponse): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await prisma.microsoftAccount.upsert({
    where: { userId },
    update: { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt },
    create: { userId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt },
  });
}

async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  requireConfig();
  const res = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      redirect_uri: REDIRECT_URI!,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: SCOPES,
    }),
  });

  if (!res.ok) {
    throw new Error(`Microsoft token refresh failed: ${res.status} ${await res.text()}`);
  }

  return res.json() as Promise<TokenResponse>;
}

/** Returns a valid access token for this user, refreshing first if it's
 * expired or about to expire. Returns null if they haven't connected Outlook. */
async function getValidAccessToken(userId: string): Promise<string | null> {
  const account = await prisma.microsoftAccount.findUnique({ where: { userId } });
  if (!account) return null;

  const expiresSoon = account.expiresAt.getTime() - Date.now() < 5 * 60 * 1000; // 5 min buffer
  if (!expiresSoon) return account.accessToken;

  const refreshed = await refreshTokens(account.refreshToken);
  await saveTokens(userId, refreshed);
  return refreshed.access_token;
}

export async function isOutlookConnected(userId: string): Promise<boolean> {
  const account = await prisma.microsoftAccount.findUnique({ where: { userId } });
  return account !== null;
}

export async function disconnectOutlook(userId: string): Promise<void> {
  await prisma.microsoftAccount.deleteMany({ where: { userId } });
}

interface SessionForEvent {
  id: string;
  date: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  outlookEventId: string | null;
  sets: { exercise: { name: string; movementPattern: string }; weightLb: number; bandLevel: string | null; reps: number }[];
  feedback: { thumbsUp: boolean } | null;
}

function eventPayloadForSession(session: SessionForEvent) {
  const pattern = session.sets[0]?.exercise.movementPattern ?? "Workout";
  const start = session.startedAt ?? session.date;
  // Fall back to a 45-minute placeholder if no end time was captured, so
  // the event always has a sensible duration.
  const end = session.endedAt ?? new Date(start.getTime() + 45 * 60 * 1000);

  const exerciseLines = Object.entries(
    session.sets.reduce<Record<string, string[]>>((acc, s) => {
      const load = s.bandLevel ? `${s.bandLevel} band` : s.weightLb > 0 ? `${s.weightLb}lb` : "Bodyweight";
      (acc[s.exercise.name] ??= []).push(`${load} x ${s.reps}`);
      return acc;
    }, {})
  ).map(([name, sets]) => `${name}: ${sets.join(", ")}`);

  const feedbackLine =
    session.feedback !== null ? `\n\nPlan feedback: ${session.feedback.thumbsUp ? "👍" : "👎"}` : "";

  return {
    subject: `${pattern} Day Workout`,
    body: {
      contentType: "text",
      content: exerciseLines.join("\n") + feedbackLine,
    },
    start: { dateTime: start.toISOString(), timeZone: "UTC" },
    end: { dateTime: end.toISOString(), timeZone: "UTC" },
  };
}

async function graphRequest(userId: string, path: string, options: RequestInit): Promise<Response> {
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    throw new Error("Outlook isn't connected — nothing to sync to");
  }
  return fetch(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...options.headers },
  });
}

/** Creates a new Outlook calendar event for a just-logged session and
 * returns its event ID, to be stored on the session for future updates. */
export async function createEventForSession(userId: string, session: SessionForEvent): Promise<string> {
  const res = await graphRequest(userId, "/me/events", {
    method: "POST",
    body: JSON.stringify(eventPayloadForSession(session)),
  });
  if (!res.ok) {
    throw new Error(`Failed to create Outlook event: ${res.status} ${await res.text()}`);
  }
  const event = (await res.json()) as { id: string };
  return event.id;
}

/** Patches an existing event in place — used when a session changes after
 * its event was created (e.g. feedback submitted after saving). */
export async function updateEventForSession(userId: string, session: SessionForEvent): Promise<void> {
  if (!session.outlookEventId) return;
  const res = await graphRequest(userId, `/me/events/${session.outlookEventId}`, {
    method: "PATCH",
    body: JSON.stringify(eventPayloadForSession(session)),
  });
  if (!res.ok) {
    throw new Error(`Failed to update Outlook event: ${res.status} ${await res.text()}`);
  }
}
