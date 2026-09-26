import { Router } from "express";
import {
  getAuthorizeUrl,
  handleAuthCallback,
  isOutlookConnected,
  disconnectOutlook,
} from "../services/outlookCalendar.js";
import { requireAuth, AuthedRequest } from "../../lib/requireAuth.js";
import { verifySessionToken } from "../../services/auth.js";

// Split into two routers: /connect and /callback are hit directly by the
// browser via redirects (to Microsoft, then back from it), so they can't
// carry our app's Authorization header the way a normal fetch call does —
// they stay public, same as /auth/login. /status and /disconnect are
// called from the SPA itself via fetch, so they go through requireAuth
// like everything else.
export const outlookPublicRouter = Router();
export const outlookPrivateRouter = Router();

const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

// GET /integrations/outlook/connect?token=... - redirects the browser into
// Microsoft's OAuth consent screen. Triggered by a plain navigation (not a
// fetch call) to a link that includes the current session token as a query
// param, since that's the only way this route can identify who's
// connecting. That session token is verified here, and the resulting
// userId is threaded through as the OAuth `state` param so /callback (also
// unauthenticated) knows whose account to attach the tokens to.
outlookPublicRouter.get("/connect", (req, res) => {
  const token = req.query.token as string | undefined;
  const payload = token ? verifySessionToken(token) : null;
  if (!payload) {
    return res.redirect(`${FRONTEND_URL}/settings?outlook=error&message=not_logged_in`);
  }

  try {
    res.redirect(getAuthorizeUrl(payload.sub));
  } catch (err) {
    res.status(500).send(err instanceof Error ? err.message : "Failed to start Outlook connection");
  }
});

// GET /integrations/outlook/callback - Microsoft redirects here after the
// user approves (or denies) access. `state` carries the userId set in
// /connect above.
outlookPublicRouter.get("/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  const userId = req.query.state as string | undefined;
  const error = req.query.error_description as string | undefined;

  if (error) {
    return res.redirect(`${FRONTEND_URL}/settings?outlook=error&message=${encodeURIComponent(error)}`);
  }
  if (!code || !userId) {
    return res.redirect(`${FRONTEND_URL}/settings?outlook=error&message=missing_code`);
  }

  try {
    await handleAuthCallback(code, userId);
    res.redirect(`${FRONTEND_URL}/settings?outlook=connected`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    res.redirect(`${FRONTEND_URL}/settings?outlook=error&message=${encodeURIComponent(message)}`);
  }
});

// GET /integrations/outlook/status - whether the signed-in user has an
// Outlook account linked.
outlookPrivateRouter.get("/status", requireAuth, async (req: AuthedRequest, res) => {
  res.json({ connected: await isOutlookConnected(req.userId!) });
});

// POST /integrations/outlook/disconnect - removes this user's stored
// tokens. Doesn't delete already-created calendar events.
outlookPrivateRouter.post("/disconnect", requireAuth, async (req: AuthedRequest, res) => {
  await disconnectOutlook(req.userId!);
  res.json({ connected: false });
});
