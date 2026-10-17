import "dotenv/config";
import express, { type ErrorRequestHandler } from "express";
// Express 4 doesn't catch errors thrown in async route handlers: without
// this, one failed database call (e.g. the database being briefly
// unreachable) crashes the whole server. Must be imported right after
// express, before any routers are created.
import "express-async-errors";
import cors from "cors";
// Two modules, two clear boundaries: Sport (deep AI coaching — Strength,
// Golf) and Scheduler (session scheduling, weather, calendar/activity
// sync). Each is imported only through its own index.ts — see the seam
// note there. Everything else here (auth, account) is shared/core, used
// by both.
import { exercisesRouter, gymsRouter, sessionsRouter, workoutsRouter, golfRouter, golfRoundsRouter, progressRouter } from "./sport/index.js";
import {
  calendarRouter,
  outlookPublicRouter,
  outlookPrivateRouter,
  stravaPublicRouter,
  stravaPrivateRouter,
  planRouter,
} from "./scheduler/index.js";
import { authRouter } from "./routes/auth.js";
import { accountRouter } from "./routes/account.js";
import { profileRouter } from "./routes/profile.js";
import { consentRouter } from "./routes/consent.js";
import { bodyRouter } from "./routes/body.js";
import { stepsRouter } from "./routes/steps.js";
import { nutritionRouter } from "./routes/nutrition.js";
import { ingestRouter } from "./routes/ingest.js";
import { adminRouter } from "./routes/admin.js";
import { messagesRouter } from "./routes/messages.js";
import { usageRouter } from "./routes/usage.js";
import { ambitionsRouter } from "./routes/ambitions.js";
import { purgeOldUsage } from "./services/usage.js";
import { requireAuth } from "./lib/requireAuth.js";

const app = express();

app.use(cors());
app.use(express.json());

// version: the commit this server is running (Railway sets
// RAILWAY_GIT_COMMIT_SHA for services deployed from GitHub), so the app can
// tell when it and the server are on different versions. Older servers just
// answer { ok: true }, which is itself the signal that they're out of date.
const SERVER_VERSION = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";
app.get("/health", (_req, res) => res.json({ ok: true, version: SERVER_VERSION }));

// Registration, login, and 2FA setup are the only routes reachable without
// a session token. The Outlook and Strava OAuth connect/callback routes
// are also public, for the same reason (they're hit by browser redirects
// from Microsoft/Strava, not by our SPA's authenticated fetch calls) — see
// scheduler/routes/outlook.ts and scheduler/routes/strava.ts for how they
// identify which user is connecting.
app.use("/auth", authRouter);
app.use("/integrations/outlook", outlookPublicRouter);
app.use("/integrations/outlook", outlookPrivateRouter);
app.use("/integrations/strava", stravaPublicRouter);
app.use("/integrations/strava", stravaPrivateRouter);
// Data uploads from an iPhone Shortcut (Apple Health) or the Renpho sync
// script. Not session-authenticated: they use the personal upload token
// from Settings instead — see routes/ingest.ts.
app.use("/ingest", ingestRouter);

// Everything else requires a valid session token. The app is multi-user —
// every route below scopes its data to req.userId (set by requireAuth), so
// each account only ever sees and modifies its own data. account.ts
// (mounted here too) provides the data export and account deletion
// endpoints for GDPR/UK-GDPR/CCPA/Australia Privacy Act style data rights.
//
// Sport routes:
app.use("/exercises", requireAuth, exercisesRouter);
app.use("/gyms", requireAuth, gymsRouter);
app.use("/sessions", requireAuth, sessionsRouter);
app.use("/workouts", requireAuth, workoutsRouter);
app.use("/golf", requireAuth, golfRouter);
app.use("/golf-rounds", requireAuth, golfRoundsRouter);
app.use("/progress", requireAuth, progressRouter);
// Scheduler routes:
app.use("/calendar", requireAuth, calendarRouter);
app.use("/plan", requireAuth, planRouter);
// Shared/core:
app.use("/account", accountRouter);
app.use("/profile", requireAuth, profileRouter);
app.use("/consent", requireAuth, consentRouter);
app.use("/body", requireAuth, bodyRouter);
app.use("/steps", requireAuth, stepsRouter);
app.use("/nutrition", requireAuth, nutritionRouter);
app.use("/messages", requireAuth, messagesRouter);
app.use("/usage", requireAuth, usageRouter);
app.use("/ambitions", requireAuth, ambitionsRouter);
// Owner-only area (see lib/requireAdmin.ts): user list, suspend/delete, messages.
app.use("/admin", requireAuth, adminRouter);

// Last-resort handler for anything a route didn't catch itself: log it and
// answer with a readable JSON error instead of crashing or hanging.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  const message =
    err?.name === "PrismaClientInitializationError"
      ? "The app can't reach its database right now. Please try again in a minute."
      : "Something went wrong on the server. Please try again.";
  res.status(500).json({ error: message });
};
app.use(errorHandler);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
  // Usage records are kept for a year (see services/usage.ts): trim now, then daily.
  const trim = () => purgeOldUsage().catch((err) => console.error("[usage] purge failed:", err));
  trim();
  setInterval(trim, 24 * 60 * 60 * 1000).unref();
});
