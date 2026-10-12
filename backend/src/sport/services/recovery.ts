import { prisma } from "../../lib/prisma.js";
import { MUSCLES, Muscle } from "../lib/training.js";

// Per-muscle recovery clocks — deliberately simple. Every logged exercise
// resets the clock on the muscles it's tagged with: the full window for its
// primary muscle, a shorter one for secondary muscles. How hard the sets
// felt (RPE) stretches or shrinks the window. No heart-rate or sleep data.

export const PRIMARY_WINDOW_HOURS = 72;
export const SECONDARY_WINDOW_HOURS = 48;
/** A muscle within this many hours of its recovery time counts as ready —
 * the windows are rules of thumb, not precise to the hour, and without it
 * an evening session would block the same muscles until the evening three
 * days later. */
export const READY_GRACE_HOURS = 6;

export function isReadyBy(readyAt: Date | undefined, at: Date): boolean {
  return !readyAt || readyAt.getTime() - READY_GRACE_HOURS * 3600_000 <= at.getTime();
}

/** RPE 8 is the baseline; easier sets recover faster, near-max sets slower.
 * RPE 6 → 0.8×, 7 → 0.9×, 8 → 1.0×, 9 → 1.1×, 10 → 1.2×. Unknown → 1.0×. */
export function intensityFactor(rpe: number | null | undefined): number {
  if (rpe == null) return 1;
  return Math.min(1.2, Math.max(0.7, 1 + 0.1 * (rpe - 8)));
}

/** One exercise performed in one session — the unit the clocks run on. */
export interface TrainingExposure {
  trainedAt: Date;
  primaryMuscle: Muscle | null;
  secondaryMuscles: Muscle[];
  avgRpe: number | null;
}

export type RecoveryStatus = "READY" | "RECOVERING" | "UNTRAINED";

export interface MuscleRecovery {
  muscle: Muscle;
  status: RecoveryStatus;
  lastTrainedAt: string | null;
  readyAt: string | null;
  /** 0–100: how far through its recovery window the muscle is. */
  percentRecovered: number;
  hoursUntilReady: number;
}

/** When each muscle will next be ready, given a list of exposures. Uses
 * the latest-finishing window per muscle (a hard primary hit followed by a
 * light secondary one doesn't shorten recovery). */
export function readyTimes(exposures: TrainingExposure[]): Map<Muscle, { lastTrainedAt: Date; readyAt: Date; startedAt: Date }> {
  const out = new Map<Muscle, { lastTrainedAt: Date; readyAt: Date; startedAt: Date }>();
  for (const ex of exposures) {
    const factor = intensityFactor(ex.avgRpe);
    const hits: [Muscle, number][] = [];
    if (ex.primaryMuscle) hits.push([ex.primaryMuscle, PRIMARY_WINDOW_HOURS]);
    for (const m of ex.secondaryMuscles) {
      if (m !== ex.primaryMuscle) hits.push([m, SECONDARY_WINDOW_HOURS]);
    }
    for (const [muscle, hours] of hits) {
      const readyAt = new Date(ex.trainedAt.getTime() + hours * factor * 3600_000);
      const prev = out.get(muscle);
      const lastTrainedAt = !prev || ex.trainedAt > prev.lastTrainedAt ? ex.trainedAt : prev.lastTrainedAt;
      if (!prev || readyAt > prev.readyAt) {
        out.set(muscle, { lastTrainedAt, readyAt, startedAt: ex.trainedAt });
      } else {
        out.set(muscle, { ...prev, lastTrainedAt });
      }
    }
  }
  return out;
}

export function recoverySnapshot(exposures: TrainingExposure[], now: Date): MuscleRecovery[] {
  const times = readyTimes(exposures);
  return MUSCLES.map((muscle) => {
    const t = times.get(muscle);
    if (!t) {
      return { muscle, status: "UNTRAINED" as const, lastTrainedAt: null, readyAt: null, percentRecovered: 100, hoursUntilReady: 0 };
    }
    const total = t.readyAt.getTime() - t.startedAt.getTime();
    const elapsed = now.getTime() - t.startedAt.getTime();
    const pct = total <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
    const ready = isReadyBy(t.readyAt, now);
    return {
      muscle,
      status: ready ? ("READY" as const) : ("RECOVERING" as const),
      lastTrainedAt: t.lastTrainedAt.toISOString(),
      readyAt: t.readyAt.toISOString(),
      percentRecovered: ready ? 100 : pct,
      hoursUntilReady: ready ? 0 : Math.ceil((t.readyAt.getTime() - now.getTime()) / 3600_000),
    };
  });
}

/** Loads the user's exposures over the last `days` days (anything older is
 * long since recovered). One exposure per exercise per session, with the
 * average RPE across that exercise's sets. */
export async function loadExposures(userId: string, since: Date): Promise<TrainingExposure[]> {
  const sessions = await prisma.workoutSession.findMany({
    where: { userId, date: { gte: since } },
    include: { sets: { include: { exercise: true } } },
  });
  const exposures: TrainingExposure[] = [];
  for (const s of sessions) {
    const trainedAt = s.endedAt ?? s.date;
    const byExercise = new Map<string, typeof s.sets>();
    for (const set of s.sets) {
      const list = byExercise.get(set.exerciseId) ?? [];
      list.push(set);
      byExercise.set(set.exerciseId, list);
    }
    for (const sets of byExercise.values()) {
      const ex = sets[0].exercise;
      const rpes = sets.map((x) => x.rpe).filter((x): x is number => x != null);
      exposures.push({
        trainedAt,
        primaryMuscle: (ex.primaryMuscle as Muscle | null) ?? null,
        secondaryMuscles: (ex.secondaryMuscles as Muscle[]) ?? [],
        avgRpe: rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null,
      });
    }
  }
  return exposures;
}

export async function getRecovery(userId: string, now = new Date()): Promise<MuscleRecovery[]> {
  const since = new Date(now.getTime() - 7 * 24 * 3600_000);
  return recoverySnapshot(await loadExposures(userId, since), now);
}
