import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { getTenDayForecast, isWeatherConfigured } from "../services/weather.js";
import { getActivitiesForDate } from "../services/stravaSync.js";
import { AuthedRequest } from "../../lib/requireAuth.js";

export const calendarRouter = Router();

const sessionTypeSchema = z.enum([
  "STRENGTH",
  "SWIM",
  "GOLF_RANGE",
  "GOLF_ROUND",
  "GOLF_SHORT_GAME",
  "GOLF_PUTTING",
  "RUN_RECOVERY",
  "RUN_TEMPO",
  "RUN_FARTLEK",
  "RUN_INTERVALS",
  "RUN_LONG_RUN",
  "WALK_WALK",
  "WALK_HIKE",
  "CYCLING_EASY",
  "CYCLING_LONG",
  "CYCLING_HILLS",
  "CYCLING_TURBO_EASY",
  "CYCLING_TURBO_LONG",
  "CYCLING_TURBO_HILLS",
  "REST",
]);

const movementPatternSchema = z.enum(["PUSH", "PULL", "LEGS", "CORE"]);

const createPlannedSessionSchema = z
  .object({
    date: z.string().datetime(),
    type: sessionTypeSchema,
    movementPattern: movementPatternSchema.optional(),
    notes: z.string().optional(),
    // Expected duration in minutes — the UI suggests a per-type default,
    // editable. Left out (or ignored) for REST, which never counts toward
    // scheduled time totals.
    estimatedMinutes: z.number().int().positive().optional(),
  })
  .refine((data) => data.type !== "STRENGTH" || data.movementPattern, {
    message: "movementPattern is required when type is STRENGTH",
    path: ["movementPattern"],
  });

// GET /calendar - the signed-in user's upcoming planned sessions (default:
// today onward). Pass ?from=&to= as ISO dates to widen the window (e.g. to
// show past sessions too).
calendarRouter.get("/", async (req: AuthedRequest, res) => {
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : new Date();
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;

  const sessions = await prisma.plannedSession.findMany({
    where: { userId: req.userId, date: { gte: from, ...(to ? { lte: to } : {}) } },
    orderBy: { date: "asc" },
  });
  res.json(sessions);
});

// POST /calendar - schedule a new session for the signed-in user.
calendarRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createPlannedSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { date, type, movementPattern, notes, estimatedMinutes } = parsed.data;

  const session = await prisma.plannedSession.create({
    data: {
      userId: req.userId!,
      date: new Date(date),
      type,
      movementPattern,
      notes,
      estimatedMinutes: type === "REST" ? undefined : estimatedMinutes,
    },
  });
  res.status(201).json(session);
});

const updatePlannedSessionSchema = z
  .object({
    date: z.string().datetime().optional(),
    type: sessionTypeSchema.optional(),
    movementPattern: movementPatternSchema.optional(),
    estimatedMinutes: z.number().int().positive().optional(),
    notes: z.string().optional(),
    completed: z.boolean().optional(),
    // Manual actual-time entry — set actualSource to MANUAL when providing
    // actualMinutes by hand (as opposed to linking a Strava activity, which
    // goes through POST /:id/strava-activity instead).
    actualMinutes: z.number().int().positive().optional(),
  })
  .refine((data) => data.type !== "STRENGTH" || data.movementPattern, {
    message: "movementPattern is required when changing type to STRENGTH",
    path: ["movementPattern"],
  });

// PATCH /calendar/:id - amend any part of a scheduled session (date, type,
// movement pattern, estimated time, notes), mark complete, or record
// actual time by hand. Scoped by userId so one user can't edit another's
// planned session by guessing an ID.
calendarRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const parsed = updatePlannedSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { date, type, movementPattern, estimatedMinutes, notes, completed, actualMinutes } = parsed.data;

  const existing = await prisma.plannedSession.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!existing) {
    return res.status(404).json({ error: "Planned session not found" });
  }

  // If switching to REST, clear the movement pattern and estimate — a rest
  // day never carries either. If switching away from STRENGTH, clear the
  // movement pattern since it's only meaningful for STRENGTH.
  const resolvedType = type ?? existing.type;

  const session = await prisma.plannedSession.update({
    where: { id: req.params.id },
    data: {
      date: date ? new Date(date) : undefined,
      type,
      movementPattern: resolvedType === "STRENGTH" ? movementPattern : resolvedType !== existing.type ? null : undefined,
      estimatedMinutes: resolvedType === "REST" ? null : estimatedMinutes,
      notes,
      completed,
      ...(actualMinutes !== undefined
        ? { actualMinutes, actualSource: "MANUAL" as const, stravaActivityId: null }
        : {}),
    },
  });
  res.json(session);
});

// DELETE /calendar/:id - remove a planned session. Same ownership check as above.
calendarRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const existing = await prisma.plannedSession.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!existing) {
    return res.status(404).json({ error: "Planned session not found" });
  }

  await prisma.plannedSession.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// GET /calendar/:id/strava-activities - Strava activities on this session's
// date, to pick one to link as the actual time (see POST .../strava-activity).
calendarRouter.get("/:id/strava-activities", async (req: AuthedRequest, res) => {
  const session = await prisma.plannedSession.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!session) {
    return res.status(404).json({ error: "Planned session not found" });
  }

  try {
    const dateKey = session.date.toISOString().slice(0, 10);
    const activities = await getActivitiesForDate(req.userId!, dateKey);
    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch Strava activities" });
  }
});

const linkStravaSchema = z.object({
  activityId: z.string(),
  movingMinutes: z.number().int().positive(),
});

// POST /calendar/:id/strava-activity - links a chosen Strava activity to
// this session, setting its actual time from the activity's moving time.
calendarRouter.post("/:id/strava-activity", async (req: AuthedRequest, res) => {
  const parsed = linkStravaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const existing = await prisma.plannedSession.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!existing) {
    return res.status(404).json({ error: "Planned session not found" });
  }

  const session = await prisma.plannedSession.update({
    where: { id: req.params.id },
    data: {
      actualMinutes: parsed.data.movingMinutes,
      actualSource: "STRAVA",
      stravaActivityId: parsed.data.activityId,
      completed: true,
    },
  });
  res.json(session);
});

// GET /calendar/weather?lat=&lon= - 10-day forecast to help decide indoor
// vs outdoor cardio/golf. Uses Open-Meteo (see services/weather.ts for
// why, not weather.com's actual API, which requires an enterprise
// agreement). Prefers the device's actual location (sent as lat/lon query
// params after the browser's geolocation prompt) over the env-configured
// fallback — important now that the app is multi-user, since a single
// fixed server-side location doesn't make sense for everyone.
calendarRouter.get("/weather", async (req, res) => {
  const lat = typeof req.query.lat === "string" ? req.query.lat : undefined;
  const lon = typeof req.query.lon === "string" ? req.query.lon : undefined;

  if (!isWeatherConfigured(lat, lon)) {
    return res.status(400).json({
      error: "Weather isn't configured — allow location access, or set LOCATION_LAT and LOCATION_LON in .env",
    });
  }
  try {
    const forecast = await getTenDayForecast(lat, lon);
    res.json(forecast);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch forecast" });
  }
});
