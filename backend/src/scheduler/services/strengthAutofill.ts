import { prisma } from "../../lib/prisma.js";
import { addDays, dateToDayKey, dayKeyToDate } from "../../lib/dates.js";
// Split + recovery logic belongs to Sport; Scheduler only places sessions.
import {
  splitForDays,
  focusMuscles,
  FOCUS_LABELS,
  loadExposures,
  readyTimes,
  isReadyBy,
  lastTrainedFocus,
  nextInRotation,
  type Focus,
  type TrainingExposure,
} from "../../sport/index.js";
import { paceStatus, goalDirection, BodyMetric, METRIC_LABELS } from "../../services/goals.js";

// Week auto-fill for strength. Lays out the week's strength sessions from
// the person's split (chosen from their days-per-week setting), placing
// each one on a day when the muscles it trains are projected to have
// recovered, with rest days in the gaps. Anything the person scheduled or
// edited by hand is left alone — only earlier auto-planned, not-yet-done
// entries are replaced.

const WINDOW_DAYS = 7;
const MAX_CONSECUTIVE_TRAINING_DAYS = 3;
const DEFAULT_MINUTES = 60;

/** Exposures a not-yet-done session of this focus would add, assuming it's
 * done around midday and loads its focus muscles as primary targets. */
export function projectedExposures(focus: Focus, dayKey: string): TrainingExposure[] {
  const trainedAt = new Date(dayKeyToDate(dayKey).getTime() + 12 * 3600_000);
  return focusMuscles(focus).map((m) => ({ trainedAt, primaryMuscle: m, secondaryMuscles: [], avgRpe: null }));
}

export interface PlacementDay {
  key: string;
  /** A strength session already on this day (kept), if any. */
  existingFocus: Focus | null;
  /** True if anything at all is already scheduled (so nothing is added). */
  occupied: boolean;
  /** Days before today can't be planned. */
  past: boolean;
}

/**
 * Pure placement: which focus goes on which free day. Walks the window in
 * order, continuing the split rotation, and only places a session when the
 * focus's muscles are projected to be recovered and it wouldn't make more
 * than MAX_CONSECUTIVE_TRAINING_DAYS training days in a row.
 */
export function planPlacements(opts: {
  days: PlacementDay[];
  rotation: Focus[];
  lastFocus: Focus | null;
  sessionsWanted: number;
  baseExposures: TrainingExposure[];
  trainedBefore: number; // consecutive training days immediately before the window
}): { placements: { key: string; focus: Focus }[]; unplaced: number } {
  const exposures = [...opts.baseExposures];
  let last = opts.lastFocus;
  let remaining = opts.sessionsWanted;
  let streak = opts.trainedBefore;
  const placements: { key: string; focus: Focus }[] = [];
  const unique = [...new Set(opts.rotation)];

  for (const day of opts.days) {
    if (day.existingFocus) {
      exposures.push(...projectedExposures(day.existingFocus, day.key));
      last = day.existingFocus;
      streak++;
      continue;
    }
    // Any day that doesn't end up with strength on it breaks the streak.
    if (day.past || day.occupied || remaining <= 0 || streak >= MAX_CONSECUTIVE_TRAINING_DAYS) {
      streak = 0;
      continue;
    }
    const at = new Date(dayKeyToDate(day.key).getTime() + 12 * 3600_000);
    const ready = readyTimes(exposures);
    const isReady = (f: Focus) => focusMuscles(f).every((m) => isReadyBy(ready.get(m)?.readyAt, at));
    const next = nextInRotation(opts.rotation, last);
    const choice = [next, ...unique.filter((f) => f !== next)].find(isReady);
    if (!choice) {
      streak = 0;
      continue;
    }
    placements.push({ key: day.key, focus: choice });
    exposures.push(...projectedExposures(choice, day.key));
    last = choice;
    remaining--;
    streak++;
  }
  return { placements, unplaced: Math.max(0, remaining) };
}

async function anyGoalBehindPace(userId: string): Promise<string | null> {
  const [goals, rows] = await Promise.all([
    prisma.bodyGoal.findMany({ where: { userId, status: "ACTIVE" }, include: { targets: { orderBy: { createdAt: "asc" } } } }),
    prisma.bodyMeasurement.findMany({ where: { userId }, orderBy: { measuredAt: "asc" } }),
  ]);
  const field = { BODY_FAT_PCT: "bodyFatPct", MUSCLE_MASS_KG: "muscleMassKg", BODY_WEIGHT_KG: "weightKg" } as const;
  for (const g of goals) {
    const metric = g.metric as BodyMetric;
    const readings = rows
      .filter((r) => r[field[metric]] != null && r.measuredAt >= g.startDate)
      .map((r) => ({ date: r.measuredAt, value: r[field[metric]] as number }));
    const current = { ...g.targets[g.targets.length - 1], reason: null };
    const status = paceStatus(metric, goalDirection(g.startValue, { ...g.targets[0], reason: null }), current, readings);
    if (status.state === "BEHIND") return METRIC_LABELS[metric].toLowerCase();
  }
  return null;
}

export interface AutofillResult {
  strengthAdded: number;
  restAdded: number;
  splitLabel: string;
  notes: string[];
}

export async function autofillWeek(userId: string, startKey: string, todayKey: string): Promise<AutofillResult> {
  const start = dayKeyToDate(startKey);
  const end = addDays(start, WINDOW_DAYS);
  const today = dayKeyToDate(todayKey);
  const notes: string[] = [];

  // Clear earlier auto-planned entries that haven't happened yet; keep
  // everything the person added or changed themselves.
  await prisma.plannedSession.deleteMany({
    where: { userId, autoPlanned: true, completed: false, date: { gte: start > today ? start : today, lt: end } },
  });

  const [user, sessions, lastFocus] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { trainingDaysPerWeek: true } }),
    prisma.plannedSession.findMany({ where: { userId, date: { gte: addDays(start, -MAX_CONSECUTIVE_TRAINING_DAYS), lt: end } } }),
    lastTrainedFocus(userId),
  ]);
  const split = splitForDays(user.trainingDaysPerWeek);

  const byDay = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const k = dateToDayKey(s.date);
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }

  // Training streak running into the window, so the "no more than 3 days
  // in a row" rule holds across the week boundary.
  let trainedBefore = 0;
  for (let i = 1; i <= MAX_CONSECUTIVE_TRAINING_DAYS; i++) {
    const k = dateToDayKey(addDays(start, -i));
    if ((byDay.get(k) ?? []).some((s) => s.type === "STRENGTH")) trainedBefore++;
    else break;
  }

  const days: PlacementDay[] = Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const key = dateToDayKey(addDays(start, i));
    const list = byDay.get(key) ?? [];
    const strength = list.find((s) => s.type === "STRENGTH" && s.movementPattern);
    return {
      key,
      existingFocus: (strength?.movementPattern as Focus | undefined) ?? null,
      occupied: list.length > 0,
      past: addDays(start, i) < today,
    };
  });

  const existingStrength = days.filter((d) => d.existingFocus).length;
  let wanted = user.trainingDaysPerWeek;
  const behind = await anyGoalBehindPace(userId);
  if (behind && wanted < 6) {
    wanted += 1;
    notes.push(`Added one extra session because your ${behind} goal is behind pace.`);
  }
  const toPlace = Math.max(0, wanted - existingStrength);
  if (existingStrength > 0) {
    notes.push(`Kept the ${existingStrength} strength session${existingStrength === 1 ? "" : "s"} already on your calendar.`);
  }

  const baseExposures = await loadExposures(userId, addDays(today, -7));
  const { placements, unplaced } = planPlacements({
    days,
    rotation: split.rotation,
    lastFocus,
    sessionsWanted: toPlace,
    baseExposures,
    trainedBefore,
  });

  const placedKeys = new Set(placements.map((p) => p.key));
  const restKeys = days.filter((d) => !d.past && !d.occupied && !d.existingFocus && !placedKeys.has(d.key)).map((d) => d.key);

  await prisma.plannedSession.createMany({
    data: [
      ...placements.map((p) => ({
        userId,
        date: dayKeyToDate(p.key),
        type: "STRENGTH" as const,
        movementPattern: p.focus,
        estimatedMinutes: DEFAULT_MINUTES,
        notes: `Auto-planned · ${split.label}`,
        autoPlanned: true,
      })),
      ...restKeys.map((k) => ({ userId, date: dayKeyToDate(k), type: "REST" as const, autoPlanned: true })),
    ],
  });

  if (placements.length > 0) {
    notes.unshift(
      `Planned ${placements.map((p) => FOCUS_LABELS[p.focus]).join(", ")} on your ${split.label} split, spaced so each session's muscles have recovered.`
    );
  }
  if (unplaced > 0) {
    notes.push(
      `Couldn't fit ${unplaced} more session${unplaced === 1 ? "" : "s"} without training muscles before they've recovered or going more than ${MAX_CONSECUTIVE_TRAINING_DAYS} days in a row.`
    );
  }
  return { strengthAdded: placements.length, restAdded: restKeys.length, splitLabel: split.label, notes };
}
