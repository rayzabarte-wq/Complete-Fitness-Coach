import "dotenv/config";
import express from "express";
import cors from "cors";
// Two modules, two clear boundaries: Sport (deep AI coaching — Strength,
// Golf) and Scheduler (session scheduling, weather, calendar/activity
// sync). Each is imported only through its own index.ts — see the seam
// note there. Everything else here (auth, account) is shared/core, used
// by both.
import { exercisesRouter, sessionsRouter, workoutsRouter, golfRouter } from "./sport/index.js";
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
import { requireAuth } from "./lib/requireAuth.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

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

// Everything else requires a valid session token. The app is multi-user —
// every route below scopes its data to req.userId (set by requireAuth), so
// each account only ever sees and modifies its own data. account.ts
// (mounted here too) provides the data export and account deletion
// endpoints for GDPR/UK-GDPR/CCPA/Australia Privacy Act style data rights.
//
// Sport routes:
app.use("/exercises", requireAuth, exercisesRouter);
app.use("/sessions", requireAuth, sessionsRouter);
app.use("/workouts", requireAuth, workoutsRouter);
app.use("/golf", requireAuth, golfRouter);
// Scheduler routes:
app.use("/calendar", requireAuth, calendarRouter);
app.use("/plan", requireAuth, planRouter);
// Shared/core:
app.use("/account", accountRouter);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
