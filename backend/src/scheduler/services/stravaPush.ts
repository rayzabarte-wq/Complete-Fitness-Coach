import { prisma } from "../../lib/prisma.js";
import { FOCUS_LABELS_SERVER } from "./stravaPushLabels.js";
import {
  buildDescription,
  chooseName,
  estimateCalories,
  exerciseLines,
  matchWatchActivity,
  unitsFromPreference,
  SetLine,
  Units,
} from "./stravaPushCore.js";
import { getActivityDetail, getMeasurementPreference, getStravaStatus, listActivitiesInRange, StravaWriteError, updateActivity } from "./stravaSync.js";

// "Update Strava": finds the strength recording your watch already put on
// Strava and fills in its name and description from the workout you logged
// here. The watch keeps its heart rate and calories; nothing new is created.

export type PushResult =
  | { ok: true; activityId: string; renamed: boolean; estimatedKcal: number | null; units: Units; alreadyUpToDate: boolean }
  | { ok: false; code: "NOT_CONNECTED" | "NO_WRITE_PERMISSION" | "NO_WORKOUT" | "NO_MATCH" | "STRAVA_ERROR"; message: string };

const fail = (code: Extract<PushResult, { ok: false }>["code"], message: string): PushResult => ({ ok: false, code, message });

export async function pushWorkoutToStrava(userId: string, sessionId: string): Promise<PushResult> {
  const status = await getStravaStatus(userId);
  if (!status.connected) return fail("NOT_CONNECTED", "Connect Strava in Settings first.");
  if (!status.canWrite) return fail("NO_WRITE_PERMISSION", "Strava needs to be reconnected to allow updates. Settings → Connections → Strava.");

  const session = await prisma.workoutSession.findFirst({
    where: { id: sessionId, userId },
    include: { sets: { orderBy: { setOrder: "asc" }, include: { exercise: { select: { name: true, equipment: true } } } } },
  });
  if (!session || session.sets.length === 0) return fail("NO_WORKOUT", "That workout has no logged sets to send.");

  const startMs = session.startedAt?.getTime() ?? null;
  const endMs = session.endedAt?.getTime() ?? null;
  const dayStart = new Date(session.date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();

  try {
    // Re-sends go to the same activity; a first send looks for the watch recording.
    let activityId = session.stravaActivityId;
    let watchSeconds: number | null = null;
    if (!activityId) {
      const from = (startMs ?? dayStartMs) - 6 * 3600 * 1000;
      const to = (endMs ?? startMs ?? dayStartMs + 24 * 3600 * 1000) + 6 * 3600 * 1000;
      const found = await listActivitiesInRange(userId, from, to);
      const match = matchWatchActivity({ startMs, endMs, dayStartMs, dayEndMs: dayStartMs + 24 * 3600 * 1000 }, found);
      if (!match) return fail("NO_MATCH", "Couldn't find your watch's strength activity on Strava yet. Check the watch has synced, then try again.");
      activityId = match.id;
      watchSeconds = match.elapsedSeconds;
    }

    const [detail, prefs, weight] = await Promise.all([
      getActivityDetail(userId, activityId),
      getMeasurementPreference(userId),
      prisma.bodyMeasurement.findFirst({ where: { userId, weightKg: { not: null } }, orderBy: { measuredAt: "desc" }, select: { weightKg: true } }),
    ]);
    const units = unitsFromPreference(prefs);
    watchSeconds = watchSeconds ?? detail.elapsedSeconds;

    const setLines: SetLine[] = session.sets.map((s) => ({
      exercise: s.exercise.name,
      weightLb: s.weightLb,
      bandLevel: s.bandLevel,
      reps: s.reps,
      rpe: s.rpe,
      bodyweight: s.exercise.equipment === "BODYWEIGHT",
    }));
    const rpes = session.sets.map((s) => s.rpe).filter((r): r is number => r != null);
    const kcal = estimateCalories({
      weightKg: weight?.weightKg ?? null,
      minutes: watchSeconds ? watchSeconds / 60 : startMs && endMs ? (endMs - startMs) / 60000 : null,
      avgRpe: rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null,
    });

    const description = buildDescription({
      existing: detail.description,
      lines: exerciseLines(setLines, units),
      estimatedKcal: kcal,
      watchHasCalories: detail.calories != null,
    });
    const focus = session.focus ? FOCUS_LABELS_SERVER[session.focus] ?? session.focus : "Strength";
    const newName = chooseName(detail.name, focus);

    const alreadyUpToDate = description === (detail.description ?? "") && newName == null;
    if (!alreadyUpToDate) await updateActivity(userId, activityId, { description, ...(newName ? { name: newName } : {}) });

    await prisma.workoutSession.update({ where: { id: session.id }, data: { stravaActivityId: activityId, stravaPushedAt: new Date() } });
    return { ok: true, activityId, renamed: newName != null, estimatedKcal: detail.calories == null ? kcal : null, units, alreadyUpToDate };
  } catch (err) {
    console.error("[strava] push failed:", err);
    if (err instanceof StravaWriteError && (err.status === 401 || err.status === 403)) {
      return fail("NO_WRITE_PERMISSION", "Strava didn't allow the update. Reconnect Strava in Settings and allow changes to your activities.");
    }
    if (err instanceof StravaWriteError && err.status === 429) return fail("STRAVA_ERROR", "Strava is busy. Try again in a few minutes.");
    return fail("STRAVA_ERROR", "Couldn't reach Strava just now. Try again in a minute.");
  }
}

/**
 * For people with automatic updates on: send any workout from the last three
 * days that hasn't gone yet. Runs with the regular Strava check, so a watch
 * that syncs a few minutes after you finish is picked up on the next pass.
 * Quiet on failure: the next check tries again.
 */
export async function pushRecentWorkouts(userId: string): Promise<number> {
  const status = await getStravaStatus(userId);
  if (!status.connected || !status.canWrite || !status.autoUpdate) return 0;
  const since = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  const pending = await prisma.workoutSession.findMany({
    where: { userId, stravaPushedAt: null, endedAt: { not: null, gte: since } },
    select: { id: true },
    orderBy: { endedAt: "asc" },
    take: 5,
  });
  let sent = 0;
  for (const p of pending) {
    const r = await pushWorkoutToStrava(userId, p.id);
    if (r.ok) sent++;
    else if (r.code === "NO_WRITE_PERMISSION" || r.code === "NOT_CONNECTED") break;
  }
  return sent;
}
