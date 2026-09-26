// Public interface of the Scheduler module — session scheduling, the
// weather forecast, and data capture for "connector" sports (ones without
// their own AI coaching layer: Run, Walk, Cycling, Cycling - Turbo, Swim),
// plus calendar sync (Outlook) and activity import (Strava). Same seam
// principle as sport/index.ts: import only from here, not from
// scheduler/routes or scheduler/services directly.
export { calendarRouter } from "./routes/calendar.js";
export { outlookPublicRouter, outlookPrivateRouter } from "./routes/outlook.js";
export { stravaPublicRouter, stravaPrivateRouter } from "./routes/strava.js";
export { planRouter } from "./routes/plan.js";

// A few service-level functions are used outside this module: the Sport
// module's session logging syncs to Outlook (see sport/routes/sessions.ts),
// and account.ts's data export/deletion needs connection status for both
// integrations.
export { isOutlookConnected, createEventForSession, updateEventForSession } from "./services/outlookCalendar.js";
export { isStravaConnected } from "./services/stravaSync.js";
