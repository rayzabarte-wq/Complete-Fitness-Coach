import { prisma } from "../../lib/prisma.js";
import { addDays, dateToDayKey, dayKeyToDate, DAY_MS } from "../../lib/dates.js";
import { getAvailability } from "../../services/availability.js";

// Run planning for the next 7 days, from where today falls in a periodised
// 13-week plan that follows the calendar quarter (Jan-Mar, Apr-Jun, Jul-Sep,
// Oct-Dec). It works like strength planning: the person sets how many runs a
// week they want (Settings), and the sub-types under Run (Recovery, Tempo,
// Fartlek, Intervals, Long run) are chosen and placed to fit the phase.
//
// The plan follows widely used endurance-training principles:
//  - Phases move from aerobic base, to threshold (tempo) work, to
//    race-specific intervals, then a taper and a reset week (Lydiard,
//    Daniels and Pfitzinger style periodisation).
//  - Most running is easy and at most two harder sessions a week besides the
//    long run on small numbers of runs (the 80/20 pattern in Seiler's work).
//  - The long run grows by no more than about 10% a week.
//  - Every 4th week is a lighter week so the load can be absorbed.
//  - Hard sessions are never on back-to-back days and the long run has an
//    easy day before it.
// It is a deterministic plan (no AI call), the same way strength auto-fill is.

export type RunType = "RUN_RECOVERY" | "RUN_TEMPO" | "RUN_FARTLEK" | "RUN_INTERVALS" | "RUN_LONG_RUN";
export const RUN_TYPES: RunType[] = ["RUN_RECOVERY", "RUN_TEMPO", "RUN_FARTLEK", "RUN_INTERVALS", "RUN_LONG_RUN"];
export const MIN_RUN_DAYS = 2;
export const MAX_RUN_DAYS = 6;
export const DEFAULT_RUN_DAYS = 3;
export const PLAN_WEEKS = 13;
const WINDOW_DAYS = 7;
const MIN_MINUTES = 20;

const HARD: RunType[] = ["RUN_TEMPO", "RUN_FARTLEK", "RUN_INTERVALS", "RUN_LONG_RUN"];
const LABEL: Record<RunType, string> = {
  RUN_RECOVERY: "Easy / recovery run",
  RUN_TEMPO: "Tempo run",
  RUN_FARTLEK: "Fartlek",
  RUN_INTERVALS: "Intervals",
  RUN_LONG_RUN: "Long run",
};

export type Phase = "Base" | "Build" | "Peak" | "Taper" | "Reset";
export interface WeekPlan {
  week: number; // 1..13
  phase: Phase;
  /** A lighter week: less long-run and quality volume. */
  lighter: boolean;
  theme: string;
  /** The long run in this week as a multiple of the starting long run. */
  longFactor: number;
}

const THEME: Record<Phase, string> = {
  Base: "Aerobic base: mostly easy running, light fartlek, a gently growing long run",
  Build: "Threshold work: tempo runs and fartlek join the long run",
  Peak: "Specific work: intervals and tempo while the long run reaches its peak",
  Taper: "Taper: volume drops, a little intensity stays",
  Reset: "Reset: easy running, then an optional 5k test to see your progress",
};

// 3 weeks up, 1 lighter, three times, then taper and reset. Long-run factors
// rise by no more than ~10% a week between loaded weeks.
const WEEKS: Omit<WeekPlan, "theme">[] = [
  { week: 1, phase: "Base", lighter: false, longFactor: 1.0 },
  { week: 2, phase: "Base", lighter: false, longFactor: 1.1 },
  { week: 3, phase: "Base", lighter: false, longFactor: 1.2 },
  { week: 4, phase: "Base", lighter: true, longFactor: 0.85 },
  { week: 5, phase: "Build", lighter: false, longFactor: 1.25 },
  { week: 6, phase: "Build", lighter: false, longFactor: 1.35 },
  { week: 7, phase: "Build", lighter: false, longFactor: 1.45 },
  { week: 8, phase: "Build", lighter: true, longFactor: 1.0 },
  { week: 9, phase: "Peak", lighter: false, longFactor: 1.5 },
  { week: 10, phase: "Peak", lighter: false, longFactor: 1.6 },
  { week: 11, phase: "Peak", lighter: false, longFactor: 1.65 },
  { week: 12, phase: "Taper", lighter: true, longFactor: 1.0 },
  { week: 13, phase: "Reset", lighter: true, longFactor: 0.8 },
];
export const planWeek = (week: number): WeekPlan => {
  const w = WEEKS[Math.min(PLAN_WEEKS, Math.max(1, week)) - 1];
  return { ...w, theme: THEME[w.phase] };
};

/** Which run types a week holds, most important first; a week with n runs takes the first n. */
const ORDER: Record<Phase, RunType[]> = {
  Base: ["RUN_LONG_RUN", "RUN_RECOVERY", "RUN_FARTLEK", "RUN_RECOVERY", "RUN_RECOVERY", "RUN_RECOVERY"],
  Build: ["RUN_LONG_RUN", "RUN_TEMPO", "RUN_RECOVERY", "RUN_RECOVERY", "RUN_FARTLEK", "RUN_RECOVERY"],
  Peak: ["RUN_LONG_RUN", "RUN_INTERVALS", "RUN_RECOVERY", "RUN_RECOVERY", "RUN_TEMPO", "RUN_RECOVERY"],
  Taper: ["RUN_LONG_RUN", "RUN_INTERVALS", "RUN_RECOVERY", "RUN_RECOVERY", "RUN_RECOVERY", "RUN_RECOVERY"],
  Reset: ["RUN_LONG_RUN", "RUN_RECOVERY", "RUN_FARTLEK", "RUN_RECOVERY", "RUN_RECOVERY", "RUN_RECOVERY"],
};
export function typesForWeek(week: number, runs: number): RunType[] {
  return ORDER[planWeek(week).phase].slice(0, Math.max(0, Math.min(MAX_RUN_DAYS, runs)));
}

const round5 = (n: number) => Math.round(n / 5) * 5;

/** Baseline minutes for the quarter, from the longest recent run. */
export function baselines(recentLongestMinutes: number | null): { long: number; easy: number } {
  const long = recentLongestMinutes ? Math.min(90, Math.max(30, round5(recentLongestMinutes * 0.85))) : 40;
  return { long, easy: Math.min(60, Math.max(25, round5(long * 0.7))) };
}

export function minutesFor(type: RunType, week: number, base: { long: number; easy: number }): number {
  const w = planWeek(week);
  if (type === "RUN_LONG_RUN") return Math.min(120, round5(base.long * w.longFactor));
  const easy = round5(base.easy * (1 + (w.longFactor - 1) * 0.5));
  if (type === "RUN_RECOVERY") return Math.max(25, easy);
  return Math.max(30, round5(easy * 1.1)); // quality sessions include warm-up and cool-down
}

const EASY = "easy, conversational (RPE 3-4)";

/** What the session is, in a line, and the effort cue. */
export function describe(type: RunType, week: number): { structure: string; effort: string } {
  const w = planWeek(week);
  const k = w.week;
  switch (type) {
    case "RUN_RECOVERY":
      return { structure: "Steady easy running, short enough that you finish fresh", effort: `Effort: ${EASY}.` };
    case "RUN_LONG_RUN":
      return w.phase === "Peak"
        ? { structure: "Long run, easy start, the last 10-15 min at steady effort if you feel good", effort: "Effort: easy to steady (RPE 4-6)." }
        : { structure: "Long run at an even, easy effort", effort: `Effort: ${EASY}.` };
    case "RUN_FARTLEK": {
      if (w.phase === "Base" || w.phase === "Reset") {
        const reps = w.lighter ? "4 x 1 min" : k === 1 ? "6 x 1 min" : k === 2 ? "8 x 1 min" : "6 x 2 min";
        return { structure: `10 min easy, ${reps} brisk with equal easy running between, easy to finish`, effort: "Effort: brisk is RPE 6-7, never a sprint." };
      }
      return {
        structure: w.lighter ? "10 min easy, 6 x 1 min at 10k effort / 1 min easy, easy to finish" : "10 min easy, 8-10 x 1 min at 10k effort / 1 min easy, 10 min easy",
        effort: "Effort: hard reps RPE 7-8, recoveries easy.",
      };
    }
    case "RUN_TEMPO": {
      const block = w.phase === "Peak" ? (k === 9 ? "2 x 12 min" : k === 10 ? "2 x 15 min" : "25 min") : k === 5 ? "2 x 10 min" : k === 6 ? "3 x 10 min" : k === 7 ? "20-25 min" : "10-15 min";
      return {
        structure: `10 min easy, ${block} at tempo (2-3 min jog between blocks), 10 min easy`,
        effort: "Effort: comfortably hard, RPE 7, about 10k to half-marathon effort.",
      };
    }
    case "RUN_INTERVALS": {
      const reps = w.phase === "Taper" ? "4 x 3 min" : k === 9 ? "5 x 3 min" : k === 10 ? "6 x 3 min" : "5 x 4 min";
      return {
        structure: `10-15 min easy, ${reps} at 5k effort with 2-3 min easy jog between, easy cool-down`,
        effort: "Effort: hard but controlled, RPE 8-9; the last rep should look like the first.",
      };
    }
  }
}

export function quarterOf(dayKey: string): { label: string; startKey: string; week: number; daysIn: number } {
  const d = dayKeyToDate(dayKey);
  const q = Math.floor(d.getUTCMonth() / 3);
  const start = new Date(Date.UTC(d.getUTCFullYear(), q * 3, 1));
  const daysIn = Math.floor((d.getTime() - start.getTime()) / DAY_MS);
  return { label: `Q${q + 1} ${d.getUTCFullYear()}`, startKey: dateToDayKey(start), week: Math.min(PLAN_WEEKS, Math.floor(daysIn / 7) + 1), daysIn };
}

// --- Placement ---------------------------------------------------------------

export interface RunDay {
  key: string;
  dow: number; // 0 = Sunday (UTC)
  past: boolean;
  /** Blocked: a run or a rest day the person set is already here. */
  blocked: boolean;
  /** Minutes still free that day; null when weekly time hasn't been set. */
  free: number | null;
  /** Something other than a run is already planned (so prefer an empty day). */
  busy: boolean;
}
export interface RunToPlace { type: RunType; minutes: number }
export interface RunPlacement { key: string; type: RunType; minutes: number }

/**
 * Pure placement. Long run first (on a weekend day if there is one), then the
 * quality sessions, then easy runs. Hard sessions keep a day clear either
 * side, and each run goes on the free day furthest from the other runs.
 */
export function placeRuns(opts: { days: RunDay[]; toPlace: RunToPlace[]; existingHardKeys: string[]; existingRunKeys: string[] }): { placements: RunPlacement[]; unplaced: RunToPlace[] } {
  const hardKeys = new Set(opts.existingHardKeys);
  const runKeys = new Set(opts.existingRunKeys);
  const used = new Set<string>();
  const idx = new Map(opts.days.map((d, i) => [d.key, i]));
  const dist = (i: number, keys: Set<string>) => {
    let best = 4;
    for (const k of keys) {
      const j = idx.get(k);
      if (j !== undefined) best = Math.min(best, Math.abs(i - j));
    }
    return best;
  };
  const placements: RunPlacement[] = [];
  const unplaced: RunToPlace[] = [];

  for (const s of opts.toPlace) {
    const isHard = HARD.includes(s.type);
    let best: { i: number; score: number; minutes: number } | null = null;
    opts.days.forEach((d, i) => {
      if (d.past || d.blocked || used.has(d.key)) return;
      let minutes = s.minutes;
      if (d.free !== null) {
        if (d.free < MIN_MINUTES) return;
        minutes = Math.min(minutes, Math.floor(d.free / 5) * 5);
        if (minutes < MIN_MINUTES) return;
      }
      if (isHard && dist(i, hardKeys) < 2) return; // never back to back
      let score = Math.min(3, dist(i, runKeys)) * 10 - (d.busy ? 4 : 0) - i * 0.1;
      if (s.type === "RUN_LONG_RUN" && (d.dow === 6 || d.dow === 0)) score += 8;
      if (minutes < s.minutes) score -= 6; // prefer a day it fits whole
      if (!best || score > best.score) best = { i, score, minutes };
    });
    if (!best) {
      unplaced.push(s);
      continue;
    }
    const { i, minutes } = best as { i: number; minutes: number };
    const key = opts.days[i].key;
    used.add(key);
    runKeys.add(key);
    if (isHard) hardKeys.add(key);
    placements.push({ key, type: s.type, minutes });
  }
  return { placements: placements.sort((a, b) => a.key.localeCompare(b.key)), unplaced };
}

// --- Plan the week -------------------------------------------------------------

export interface RunPlanResult {
  added: number;
  restReplaced: number;
  quarter: string;
  week: number;
  phase: Phase;
  theme: string;
  runsPerWeek: number;
  /** The 13 weeks of this quarter, for display. */
  outline: { week: number; phase: Phase; lighter: boolean; longRunMinutes: number }[];
  notes: string[];
}

export async function planRunWeek(userId: string, startKey: string, todayKey: string): Promise<RunPlanResult> {
  const start = dayKeyToDate(startKey);
  const end = addDays(start, WINDOW_DAYS);
  const today = dayKeyToDate(todayKey);
  const notes: string[] = [];

  // The week of the plan that most of these 7 days fall in.
  const mid = dateToDayKey(addDays(start, 3));
  const q = quarterOf(mid);
  const wk = planWeek(q.week);

  // Earlier auto-planned runs that haven't happened yet are replaced.
  await prisma.plannedSession.deleteMany({
    where: { userId, autoPlanned: true, completed: false, type: { in: RUN_TYPES }, date: { gte: start > today ? start : today, lt: end } },
  });

  const [user, availability, sessions, recent] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { runDaysPerWeek: true } }),
    getAvailability(userId),
    prisma.plannedSession.findMany({ where: { userId, date: { gte: start, lt: end } } }),
    prisma.plannedSession.findMany({
      where: { userId, completed: true, type: { in: RUN_TYPES }, date: { gte: addDays(today, -42), lt: addDays(today, 1) }, actualMinutes: { not: null } },
      select: { actualMinutes: true },
    }),
  ]);
  const recentLongest = recent.reduce((m, s) => Math.max(m, s.actualMinutes ?? 0), 0) || null;
  const base = baselines(recentLongest);
  const runsPerWeek = user.runDaysPerWeek;

  const existingRuns = sessions.filter((s) => (RUN_TYPES as string[]).includes(s.type));
  const wanted = Math.max(0, runsPerWeek - existingRuns.length);
  if (existingRuns.length > 0) notes.push(`Kept the ${existingRuns.length} run${existingRuns.length === 1 ? "" : "s"} already on your calendar, which count towards your ${runsPerWeek} a week.`);

  // The week's list of run types, with the ones already planned taken out.
  const full = typesForWeek(q.week, runsPerWeek);
  const remainingTypes = [...full];
  for (const r of existingRuns) {
    const at = remainingTypes.indexOf(r.type as RunType);
    if (at >= 0) remainingTypes.splice(at, 1);
  }
  const toPlace = remainingTypes.slice(0, wanted).map((type) => ({ type, minutes: minutesFor(type, q.week, base) }));

  const byDay = new Map<string, typeof sessions>();
  for (const s of sessions) byDay.set(dateToDayKey(s.date), [...(byDay.get(dateToDayKey(s.date)) ?? []), s]);
  const days: RunDay[] = Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const d = addDays(start, i);
    const key = dateToDayKey(d);
    const list = byDay.get(key) ?? [];
    // Rest days the app put there itself can be run on; ones the person set cannot.
    const blocking = list.filter((s) => (RUN_TYPES as string[]).includes(s.type) || (s.type === "REST" && !s.autoPlanned));
    const others = list.filter((s) => !(RUN_TYPES as string[]).includes(s.type) && s.type !== "REST");
    const used = others.reduce((sum, s) => sum + (s.estimatedMinutes ?? 0), 0);
    const avail = availability.minutesByDay[d.getUTCDay()] ?? 0;
    return { key, dow: d.getUTCDay(), past: d < today, blocked: blocking.length > 0, free: availability.isSet ? Math.max(0, avail - used) : null, busy: others.length > 0 };
  });
  if (!availability.isSet) notes.push("Set your weekly time (Settings → Weekly time) and runs will be fitted to the time you have each day.");

  const { placements, unplaced } = placeRuns({
    days,
    toPlace,
    existingHardKeys: existingRuns.filter((r) => HARD.includes(r.type as RunType)).map((r) => dateToDayKey(r.date)),
    existingRunKeys: existingRuns.map((r) => dateToDayKey(r.date)),
  });

  // A planned rest day the app made earlier gives way to the run.
  const placedKeys = new Set(placements.map((p) => p.key));
  const toClear = sessions.filter((s) => s.type === "REST" && s.autoPlanned && !s.completed && placedKeys.has(dateToDayKey(s.date)));
  if (toClear.length) await prisma.plannedSession.deleteMany({ where: { id: { in: toClear.map((s) => s.id) } } });

  if (placements.length) {
    await prisma.plannedSession.createMany({
      data: placements.map((p) => {
        const d = describe(p.type, q.week);
        return {
          userId,
          date: dayKeyToDate(p.key),
          type: p.type,
          estimatedMinutes: p.minutes,
          notes: `${wk.phase} · week ${q.week} of ${PLAN_WEEKS} · ${LABEL[p.type]}: ${d.structure}\n${d.effort}`,
          autoPlanned: true,
        };
      }),
    });
    notes.unshift(
      `Planned ${placements.map((p) => LABEL[p.type].toLowerCase()).join(", ")} for ${q.label} week ${q.week} of ${PLAN_WEEKS} (${wk.phase}${wk.lighter ? ", a lighter week" : ""}).`
    );
  }
  if (unplaced.length) {
    notes.push(`Couldn't fit ${unplaced.length} run${unplaced.length === 1 ? "" : "s"}: no day had enough free time, or it would have put hard sessions on back-to-back days.`);
  }
  if (wanted === 0 && existingRuns.length > 0) notes.push("You already have as many runs this week as your target, so nothing was added.");
  if (!recentLongest) notes.push("No recent run times to go on, so lengths start modestly and grow week by week. Strava runs you do will set them from then on.");

  return {
    added: placements.length,
    restReplaced: toClear.length,
    quarter: q.label,
    week: q.week,
    phase: wk.phase,
    theme: wk.theme,
    runsPerWeek,
    outline: WEEKS.map((w) => ({ week: w.week, phase: w.phase, lighter: w.lighter, longRunMinutes: minutesFor("RUN_LONG_RUN", w.week, base) })),
    notes,
  };
}
