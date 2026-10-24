import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { getTenDayForecast, isWeatherConfigured } from "../services/weather.js";
import { getActivitiesForDate } from "../services/stravaSync.js";
import { syncStravaActivities } from "../services/stravaImport.js";
import { AuthedRequest } from "../../lib/requireAuth.js";
import { addDays, dateToDayKey, dayKeyToDate, isDayKey } from "../../lib/dates.js";
import { autofillWeek } from "../services/strengthAutofill.js";
import { planRunWeek } from "../services/runPlanner.js";
import { planWeekFromPlan, PlanWeekError } from "../services/weekFromPlan.js";

export const calendarRouter = Router();

const sessionTypeSchema = z.enum([
  "STRENGTH",
  "SWIM",
  "GOLF_RANGE",
  "GOLF_ROUND",
  "GOLF_SHORT_GAME",
  "GOLF_PUTTING",
  "GOLF_SIMULATOR",
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

const movementPatternSchema = z.enum(["PUSH", "PULL", "LEGS", "CORE", "UPPER", "LOWER", "FULL_BODY"]);

// Golf practice drills: a checklist, each with a tick and a comment.
const drillsSchema = z
  .array(
    z.object({
      name: z.string().trim().min(1).max(80),
      // The exact club used, from the person's bag.
      club: z.string().trim().max(40).nullish(),
      detail: z.string().trim().max(400).default(""),
      minutes: z.number().int().min(0).max(240).default(0),
      done: z.boolean().default(false),
      comment: z.string().trim().max(500).default(""),
      // How well it went, 1 to 10 (like RPE on a strength set). Optional.
      rating: z.number().int().min(1).max(10).nullish(),
    })
  )
  .max(10);

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
    drills: drillsSchema.optional(),
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

const autofillSchema = z.object({
  // First day of the 7-day window, and today, both as the person's LOCAL
  // calendar day (YYYY-MM-DD) — days before today are never planned.
  start: z.string().refine(isDayKey),
  today: z.string().refine(isDayKey),
});

// POST /calendar/autofill - lay out the week's strength sessions (and rest
// days) from the split and recovery. See services/strengthAutofill.ts.
calendarRouter.post("/autofill", async (req: AuthedRequest, res) => {
  const parsed = autofillSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    res.json(await autofillWeek(req.userId!, parsed.data.start, parsed.data.today));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Auto-fill failed" });
  }
});

// POST /calendar/run-plan - plan the next 7 days of running from where the
// calendar quarter's periodised plan has got to. See services/runPlanner.ts.
calendarRouter.post("/run-plan", async (req: AuthedRequest, res) => {
  const parsed = autofillSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    res.json(await planRunWeek(req.userId!, parsed.data.start, parsed.data.today));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Run planning failed" });
  }
});

// POST /calendar/week-plan - the next 7 days of workouts from the training
// plan's weekly pattern (a day and minutes per session), choosing what each
// session is from what has been done so far. See services/weekFromPlan.ts.
calendarRouter.post("/week-plan", async (req: AuthedRequest, res) => {
  const parsed = autofillSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    res.json(await planWeekFromPlan(req.userId!, parsed.data.start, parsed.data.today));
  } catch (err) {
    if (err instanceof PlanWeekError) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Couldn't plan the week" });
  }
});

// GET /calendar/days?from=YYYY-MM-DD&to=YYYY-MM-DD&tzOffset=-60 - what
// actually happened each day, for the calendar's simplified day view and its
// drill-down: steps (and whether they reached the goal), strength workouts
// logged, and any body scan. tzOffset is the browser's
// Date.getTimezoneOffset(), used to put timestamped entries (workouts,
// scans) on the person's local day.
calendarRouter.get("/days", async (req: AuthedRequest, res) => {
  const fromKey = req.query.from;
  const toKey = req.query.to;
  if (!isDayKey(fromKey) || !isDayKey(toKey)) {
    return res.status(400).json({ error: "from and to must be YYYY-MM-DD" });
  }
  const offsetMin = Number(req.query.tzOffset ?? 0) || 0;
  const from = dayKeyToDate(fromKey);
  const to = dayKeyToDate(toKey);
  // Timestamps are shifted by the offset to land on local days; widen the
  // query by a day each side so nothing near midnight is missed.
  const [steps, workouts, scans, user] = await Promise.all([
    prisma.stepDay.findMany({ where: { userId: req.userId, date: { gte: from, lt: to } } }),
    prisma.workoutSession.findMany({
      where: { userId: req.userId, date: { gte: addDays(from, -1), lt: addDays(to, 1) } },
      include: { sets: { include: { exercise: true }, orderBy: { setOrder: "asc" } } },
      orderBy: { date: "asc" },
    }),
    prisma.bodyMeasurement.findMany({
      where: { userId: req.userId, measuredAt: { gte: addDays(from, -1), lt: addDays(to, 1) } },
      orderBy: { measuredAt: "asc" },
    }),
    prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { dailyStepGoal: true } }),
  ]);
  const localKey = (d: Date) => dateToDayKey(new Date(d.getTime() - offsetMin * 60_000));

  const out = new Map<string, any>();
  for (let d = from; d < to; d = addDays(d, 1)) {
    out.set(dateToDayKey(d), { date: dateToDayKey(d), steps: null, stepGoal: user.dailyStepGoal, hitStepGoal: null, workouts: [], scan: null });
  }
  for (const s of steps) {
    const day = out.get(dateToDayKey(s.date));
    if (!day) continue;
    day.steps = s.steps;
    day.hitStepGoal = user.dailyStepGoal != null ? s.steps >= user.dailyStepGoal : null;
  }
  for (const w of workouts) {
    const day = out.get(localKey(w.date));
    if (!day) continue;
    const exercises = new Map<string, { name: string; sets: string[] }>();
    for (const set of w.sets) {
      const e = exercises.get(set.exerciseId) ?? exercises.set(set.exerciseId, { name: set.exercise.name, sets: [] }).get(set.exerciseId)!;
      const load = set.bandLevel ? `${set.bandLevel} band` : set.weightLb > 0 ? `${set.weightLb}lb` : "BW";
      e.sets.push(`${load} × ${set.reps}${set.rpe ? ` @${set.rpe}` : ""}`);
    }
    day.workouts.push({
      id: w.id,
      focus: w.focus,
      setCount: w.sets.length,
      minutes: w.startedAt && w.endedAt ? Math.round((w.endedAt.getTime() - w.startedAt.getTime()) / 60000) : null,
      exercises: [...exercises.values()],
    });
  }
  for (const m of scans) {
    const day = out.get(localKey(m.measuredAt));
    if (day) day.scan = { weightKg: m.weightKg, bodyFatPct: m.bodyFatPct, muscleMassKg: m.muscleMassKg, source: m.source };
  }
  res.json([...out.values()]);
});

// POST /calendar - schedule a new session for the signed-in user.
calendarRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createPlannedSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { date, type, movementPattern, notes, estimatedMinutes, drills } = parsed.data;

  const session = await prisma.plannedSession.create({
    data: {
      userId: req.userId!,
      date: new Date(date),
      type,
      movementPattern,
      notes,
      estimatedMinutes: type === "REST" ? undefined : estimatedMinutes,
      drills: drills?.length ? drills : undefined,
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
    drills: drillsSchema.optional(),
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
  const { date, type, movementPattern, estimatedMinutes, notes, completed, actualMinutes, drills } = parsed.data;

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
      // An empty list clears the checklist.
      drills: drills === undefined ? undefined : drills.length ? drills : Prisma.DbNull,
      // A hand edit makes it the person's own entry: re-running auto-fill
      // will no longer replace it.
      ...(date || type || movementPattern || estimatedMinutes || notes !== undefined || drills !== undefined ? { autoPlanned: false } : {}),
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

// POST /calendar/strava-sync - bring recent Strava activities (runs, walks,
// hikes, rides, swims) into the calendar. Each completes a matching planned
// session that day, or is recorded as a new completed one. At most every 5
// minutes unless { force: true }.
calendarRouter.post("/strava-sync", async (req: AuthedRequest, res) => {
  res.json(await syncStravaActivities(req.userId!, req.body?.force === true));
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
