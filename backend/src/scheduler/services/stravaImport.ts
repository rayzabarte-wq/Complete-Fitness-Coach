import type { SessionType, Sport } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { addDays, dateToDayKey, dayKeyToDate, isDayKey } from "../../lib/dates.js";
import { getActivitiesBetween, isStravaConnected, StravaActivityDetail } from "./stravaSync.js";
import { SPORT_SESSION_TYPES } from "../lib/sportMapping.js";

// Brings Strava activities into the calendar automatically. An activity that
// matches a planned session that day (same sport, not yet done) completes it;
// otherwise it is recorded as a new session that is already completed.
// Golf is left to the golf rounds importer, and strength has no Strava
// equivalent worth guessing at.

const LOOKBACK_DAYS = 14;
const MIN_MINUTES = 5;
const SYNC_EVERY_MS = 5 * 60 * 1000;
const lastSync = new Map<string, number>();

/** Which sport and session type a Strava activity counts as, or null to skip it. */
export function classify(a: Pick<StravaActivityDetail, "type" | "sportType" | "workoutType" | "movingMinutes" | "elapsedMinutes">): { sport: Sport; type: SessionType } | null {
  const t = a.sportType || a.type;
  const minutes = a.elapsedMinutes ?? a.movingMinutes;
  if (["Run", "TrailRun", "VirtualRun"].includes(t)) {
    let type: SessionType = "RUN_RECOVERY";
    if (a.workoutType === 2 || minutes >= 75) type = "RUN_LONG_RUN";
    else if (a.workoutType === 3) type = "RUN_INTERVALS";
    return { sport: "RUN", type };
  }
  if (t === "Hike") return { sport: "WALK", type: "WALK_HIKE" };
  if (t === "Walk") return { sport: "WALK", type: "WALK_WALK" };
  if (["Ride", "MountainBikeRide", "GravelRide", "EBikeRide"].includes(t)) {
    return { sport: "CYCLING", type: minutes >= 120 ? "CYCLING_LONG" : "CYCLING_EASY" };
  }
  if (t === "VirtualRide") return { sport: "CYCLING_TURBO", type: minutes >= 120 ? "CYCLING_TURBO_LONG" : "CYCLING_TURBO_EASY" };
  if (t === "Swim") return { sport: "SWIM", type: "SWIM" };
  return null;
}

export interface StravaSyncResult {
  connected: boolean;
  /** New sessions recorded as completed. */
  created: number;
  /** Planned sessions completed by a matching activity. */
  completed: number;
  error?: string;
}

export async function syncStravaActivities(userId: string, force = false): Promise<StravaSyncResult> {
  if (!(await isStravaConnected(userId))) return { connected: false, created: 0, completed: 0 };
  if (!force && Date.now() - (lastSync.get(userId) ?? 0) < SYNC_EVERY_MS) return { connected: true, created: 0, completed: 0 };

  const now = new Date();
  const from = addDays(dayKeyToDate(dateToDayKey(now)), -LOOKBACK_DAYS);
  let activities: StravaActivityDetail[];
  try {
    activities = await getActivitiesBetween(userId, from, now);
  } catch (err) {
    console.error("[strava] activity sync failed:", err);
    return { connected: true, created: 0, completed: 0, error: "Couldn't reach Strava just now." };
  }
  lastSync.set(userId, Date.now());

  let created = 0;
  let completed = 0;
  // Oldest first, so two runs in a day line up with two planned runs in order.
  for (const a of activities.sort((x, y) => x.startDate.localeCompare(y.startDate))) {
    const kind = classify(a);
    const dayKey = a.startDate.slice(0, 10);
    if (!kind || !isDayKey(dayKey) || a.movingMinutes < MIN_MINUTES) continue;
    const day = dayKeyToDate(dayKey);
    if (day < from || day > addDays(now, 1)) continue;

    const [known, linked] = await Promise.all([
      prisma.stravaImport.findUnique({ where: { userId_stravaActivityId: { userId, stravaActivityId: a.id } }, select: { id: true } }),
      prisma.plannedSession.findFirst({ where: { userId, stravaActivityId: a.id }, select: { id: true } }),
    ]);
    if (known) continue;
    if (linked) {
      // Linked by hand before auto-sync existed: remember it, change nothing.
      await prisma.stravaImport.create({ data: { userId, stravaActivityId: a.id, plannedSessionId: linked.id } });
      continue;
    }

    const planned = await prisma.plannedSession.findMany({
      where: { userId, date: { gte: day, lt: addDays(day, 1) }, completed: false, stravaActivityId: null, type: { in: SPORT_SESSION_TYPES[kind.sport] } },
      orderBy: { createdAt: "asc" },
    });
    const match = planned.find((p) => p.type === kind.type) ?? planned[0];

    let sessionId: string;
    if (match) {
      await prisma.plannedSession.update({
        where: { id: match.id },
        data: { completed: true, actualMinutes: a.movingMinutes, actualSource: "STRAVA", stravaActivityId: a.id },
      });
      sessionId = match.id;
      completed++;
    } else {
      const s = await prisma.plannedSession.create({
        data: {
          userId,
          date: day,
          type: kind.type,
          completed: true,
          estimatedMinutes: a.movingMinutes,
          actualMinutes: a.movingMinutes,
          actualSource: "STRAVA",
          stravaActivityId: a.id,
          notes: `From Strava: ${a.name.slice(0, 80)}${a.distanceMiles > 0 ? ` · ${a.distanceMiles} mi` : ""}`,
        },
      });
      sessionId = s.id;
      created++;
    }
    await prisma.stravaImport.create({ data: { userId, stravaActivityId: a.id, plannedSessionId: sessionId } });
  }
  return { connected: true, created, completed };
}
