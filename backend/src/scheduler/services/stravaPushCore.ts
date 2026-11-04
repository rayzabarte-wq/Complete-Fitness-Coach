// The pure parts of "Update Strava": which watch activity belongs to a
// workout, what to write into it, and the calorie estimate. No database or
// network here, so it can be tested on its own.

export type Units = "metric" | "imperial";

export interface WatchActivity {
  id: string;
  name: string;
  /** Strava's finer type, e.g. "WeightTraining". */
  sportType: string;
  /** Start as a UTC instant (ms since epoch). */
  startMs: number;
  elapsedSeconds: number;
}

const LB_PER_KG = 2.2046226218;
const GENERIC_NAME = /^((early |late )?(morning|afternoon|evening|lunch|night)\s+)?(weight\s*training|strength( training)?|workout|gym)$/i;
export const MARKER_START = "— Complete Fitness Coach —";
export const MARKER_END = "— end —";

/** Strava types a watch's strength recording can arrive as. */
export function isStrengthLike(sportType: string): boolean {
  return sportType === "WeightTraining" || sportType === "Workout" || sportType === "Crossfit";
}

/**
 * Pick the watch activity for a workout. Needs a strength-like activity that
 * starts within 45 minutes either side of the workout; the closest start wins.
 * With no recorded start time, falls back to "the only strength activity that
 * day", and refuses to guess between several.
 */
export function matchWatchActivity(
  workout: { startMs: number | null; endMs: number | null; dayStartMs: number; dayEndMs: number },
  activities: WatchActivity[]
): WatchActivity | null {
  const candidates = activities.filter((a) => isStrengthLike(a.sportType));
  if (workout.startMs != null) {
    const slack = 45 * 60 * 1000;
    const end = workout.endMs ?? workout.startMs;
    const near = candidates
      .filter((a) => a.startMs >= workout.startMs! - slack && a.startMs <= end + slack)
      .sort((a, b) => Math.abs(a.startMs - workout.startMs!) - Math.abs(b.startMs - workout.startMs!));
    return near[0] ?? null;
  }
  const sameDay = candidates.filter((a) => a.startMs >= workout.dayStartMs && a.startMs < workout.dayEndMs);
  return sameDay.length === 1 ? sameDay[0] : null;
}

/** Strava's units setting ("feet" / "meters") as ours. Unknown means metric. */
export function unitsFromPreference(pref: string | null | undefined): Units {
  return pref === "feet" ? "imperial" : "metric";
}

/** "60 kg" or "132 lb". kg is rounded to the nearest 0.5, lb to the nearest 1. */
export function formatWeight(lb: number, units: Units): string {
  if (units === "imperial") return `${Math.round(lb)} lb`;
  const kg = Math.round((lb / LB_PER_KG) * 2) / 2;
  return `${Number.isInteger(kg) ? kg : kg.toFixed(1)} kg`;
}

export interface SetLine {
  exercise: string;
  weightLb: number;
  bandLevel: string | null;
  reps: number;
  rpe: number | null;
  /** True for bodyweight exercises, where a 0 weight means "just you". */
  bodyweight: boolean;
}

function loadText(s: SetLine, units: Units): string {
  if (s.bandLevel) return `${s.bandLevel} band`;
  if (s.weightLb <= 0) return "bodyweight";
  return s.bodyweight ? `+${formatWeight(s.weightLb, units)}` : formatWeight(s.weightLb, units);
}

/** One line per exercise. Identical consecutive sets collapse: "3×8 @ 60 kg". */
export function exerciseLines(sets: SetLine[], units: Units): string[] {
  const order: string[] = [];
  const byEx = new Map<string, SetLine[]>();
  for (const s of sets) {
    if (!byEx.has(s.exercise)) {
      byEx.set(s.exercise, []);
      order.push(s.exercise);
    }
    byEx.get(s.exercise)!.push(s);
  }
  return order.map((name) => {
    const list = byEx.get(name)!;
    const groups: { load: string; reps: number; n: number }[] = [];
    for (const s of list) {
      const load = loadText(s, units);
      const last = groups[groups.length - 1];
      if (last && last.load === load && last.reps === s.reps) last.n++;
      else groups.push({ load, reps: s.reps, n: 1 });
    }
    const parts = groups.map((g) => (g.load === "bodyweight" ? `${g.n}×${g.reps}` : `${g.n}×${g.reps} @ ${g.load}`));
    const rpes = list.map((s) => s.rpe).filter((r): r is number => r != null);
    const rpe = rpes.length ? ` (RPE ${Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10})` : "";
    return `${name}: ${parts.join(", ")}${rpe}`;
  });
}

/**
 * Calories by the MET method: MET × body weight (kg) × hours. MET is 3.5
 * (light to moderate weight training) plus 0.5 for each RPE point above 6,
 * up to 5.5. Rounded to the nearest 5. Null when we can't do it honestly.
 */
export function estimateCalories(input: { weightKg: number | null; minutes: number | null; avgRpe: number | null }): number | null {
  const { weightKg, minutes, avgRpe } = input;
  if (!weightKg || weightKg < 30 || weightKg > 300) return null;
  if (!minutes || minutes < 5 || minutes > 240) return null;
  const met = avgRpe == null ? 3.5 : Math.min(5.5, Math.max(3.5, 3.5 + 0.5 * (avgRpe - 6)));
  const kcal = met * weightKg * (minutes / 60);
  return Math.round(kcal / 5) * 5;
}

/** Strava's generic watch names get replaced; a name the person chose is kept. */
export function chooseName(existing: string, focusLabel: string): string | null {
  return GENERIC_NAME.test(existing.trim()) ? `Strength · ${focusLabel}` : null;
}

/**
 * The description to write. Our block sits between markers, so sending again
 * replaces it, and anything the person typed outside the block stays. A
 * calorie estimate is only added when the watch gave none.
 */
export function buildDescription(args: { existing: string | null; lines: string[]; estimatedKcal: number | null; watchHasCalories: boolean }): string {
  const body = [MARKER_START, ...args.lines];
  if (!args.watchHasCalories && args.estimatedKcal != null) body.push(`Est. ~${args.estimatedKcal} kcal (estimate; no heart-rate data)`);
  body.push(MARKER_END);
  const block = body.join("\n");
  const existing = (args.existing ?? "").trim();
  const start = existing.indexOf(MARKER_START);
  const end = existing.indexOf(MARKER_END);
  if (start !== -1 && end > start) {
    const before = existing.slice(0, start).trimEnd();
    const after = existing.slice(end + MARKER_END.length).trimStart();
    return [before, block, after].filter(Boolean).join("\n\n");
  }
  return existing ? `${existing}\n\n${block}` : block;
}
