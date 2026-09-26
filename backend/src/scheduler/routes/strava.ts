import { Router } from "express";
import { z } from "zod";
import {
  getAuthorizeUrl,
  handleAuthCallback,
  isStravaConnected,
  disconnectStrava,
  getActivitiesForDate,
} from "../services/stravaSync.js";
import { requireAuth, AuthedRequest } from "../../lib/requireAuth.js";
import { verifySessionToken } from "../../services/auth.js";

// Same split as outlook.ts: /connect and /callback are hit by bare browser
// redirects (to Strava, then back), so they can't carry our Authorization
// header — they stay public. /status, /disconnect, and /activities are
// called from the SPA via fetch, so they go through requireAuth.
export const stravaPublicRouter = Router();
export const stravaPrivateRouter = Router();

const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

// GET /integrations/strava/connect?token=... - same pattern as Outlook's
// connect route: the session token is verified here (since a plain
// navigation can't carry our normal Authorization header), and the
// resulting userId is threaded through as the OAuth `state` param.
stravaPublicRouter.get("/connect", (req, res) => {
  const token = req.query.token as string | undefined;
  const payload = token ? verifySessionToken(token) : null;
  if (!payload) {
    return res.redirect(`${FRONTEND_URL}/settings?strava=error&message=not_logged_in`);
  }

  try {
    res.redirect(getAuthorizeUrl(payload.sub));
  } catch (err) {
    res.status(500).send(err instanceof Error ? err.message : "Failed to start Strava connection");
  }
});

// GET /integrations/strava/callback - Strava redirects here after the user
// approves (or denies) access. `state` carries the userId from /connect.
stravaPublicRouter.get("/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  const userId = req.query.state as string | undefined;
  const error = req.query.error as string | undefined;

  if (error) {
    return res.redirect(`${FRONTEND_URL}/settings?strava=error&message=${encodeURIComponent(error)}`);
  }
  if (!code || !userId) {
    return res.redirect(`${FRONTEND_URL}/settings?strava=error&message=missing_code`);
  }

  try {
    await handleAuthCallback(code, userId);
    res.redirect(`${FRONTEND_URL}/settings?strava=connected`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.redirect(`${FRONTEND_URL}/settings?strava=error&message=${encodeURIComponent(message)}`);
  }
});

// GET /integrations/strava/status - whether the signed-in user has Strava linked.
stravaPrivateRouter.get("/status", requireAuth, async (req: AuthedRequest, res) => {
  res.json({ connected: await isStravaConnected(req.userId!) });
});

// POST /integrations/strava/disconnect - removes this user's stored tokens.
stravaPrivateRouter.post("/disconnect", requireAuth, async (req: AuthedRequest, res) => {
  await disconnectStrava(req.userId!);
  res.json({ connected: false });
});

const dateQuerySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// GET /integrations/strava/activities?date=YYYY-MM-DD - activities on that
// local calendar date, for picking one to link as a session's actual time.
stravaPrivateRouter.get("/activities", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = dateQuerySchema.safeParse(req.query.date);
  if (!parsed.success) {
    return res.status(400).json({ error: "date query param must be YYYY-MM-DD" });
  }

  try {
    const activities = await getActivitiesForDate(req.userId!, parsed.data);
    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch activities" });
  }
});
