import type { MovementPattern, SessionType, Sport } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { addDays, dateToDayKey, dayKeyToDate, DAY_MS } from "../../lib/dates.js";
import { SPORT_SESSION_TYPES } from "../lib/sportMapping.js";
import { splitForDays, lastTrainedFocus, nextInRotation, FOCUS_LABELS, type Focus } from "../../sport/index.js";
import { PLAN_WEEKS, RUN_TYPES, baselines, describe, minutesFor, placeRuns, planWeek, quarterOf, typesForWeek, type RunDay, type RunType } from "./runPlanner.js";

// "Plan my week": turns the plan's weekly pattern into the next 7 days of real
// workouts. The pattern holds only a sport, a day and the minutes available;
// what each session actually is gets chosen here from what has been done so far:
//  - Strength continues the split from the last strength day trained.
//  - Running takes the run types for this week of the quarter's periodised
//    plan (see runPlanner.ts), fitted onto the days chosen in the pattern.
//  - Golf, cycling, walking and swimming rotate through their session types,
//    favouring the type done least recently, with the longest slot taking the
//    long/hike/round version when it is long enough.
// Entries the app made earlier and that haven't happened yet are replaced;
// anything the person added or changed is kept and counts towards the week.

const WINDOW_DAYS = 7;
const HISTORY_DAYS = 28;

export class PlanWeekError extends Error {}

export const TYPE_LABEL: Record<SessionType, string> = {
  STRENGTH: "Strength",
  REST: "Rest",
  SWIM: "Swim",
  GOLF_RANGE: "Golf range practice",
  GOLF_ROUND: "Golf round",
  GOLF_SHORT_GAME: "Golf short game",
  GOLF_PUTTING: "Golf putting",
  GOLF_SIMULATOR: "Golf simulator",
  RUN_RECOVERY: "Easy run",
  RUN_TEMPO: "Tempo run",
  RUN_FARTLEK: "Fartlek run",
  RUN_INTERVALS: "Interval run",
  RUN_LONG_RUN: "Long run",
  WALK_WALK: "Walk",
  WALK_HIKE: "Hike",
  CYCLING_EASY: "Easy ride",
  CYCLING_LONG: "Long ride",
  CYCLING_HILLS: "Hill ride",
  CYCLING_TURBO_EASY: "Easy turbo",
  CYCLING_TURBO_LONG: "Long turbo",
  CYCLING_TURBO_HILLS: "Hill turbo",
};

// --- Pure choosing --------------------------------------------------------------

export interface DaySlot {
  key: string;
  minutes: number;
}
export interface UseStat {
  count: number;
  last: number; // ms; 0 = not in the history
}
export type Stats = Map<SessionType, UseStat>;

/** The candidate used least often lately, then the one used longest ago, then the first listed. */
export function leastRecent(candidates: SessionType[], stats: Stats): SessionType {
  let best = candidates[0];
  let bestKey: [number, number] | null = null;
  for (const c of candidates) {
    const s = stats.get(c) ?? { count: 0, last: 0 };
    const k: [number, number] = [s.count, s.last];
    if (!bestKey || k[0] < bestKey[0] || (k[0] === bestKey[0] && k[1] < bestKey[1])) {
      best = c;
      bestKey = k;
    }
  }
  return best;
}

function bump(stats: Stats, type: SessionType, key: string) {
  const s = stats.get(type) ?? { count: 0, last: 0 };
  stats.set(type, { count: s.count + 1, last: Math.max(s.last, dayKeyToDate(key).getTime()) });
}

const LONG_AT: Partial<Record<Sport, number>> = { CYCLING: 90, CYCLING_TURBO: 60 };

/** Golf, cycling, turbo, walking and swimming: a type for each slot. Slots come in date order. */
export function chooseByRotation(sport: Sport, slots: DaySlot[], visible: SessionType[], history: Stats): { key: string; type: SessionType; minutes: number }[] {
  const stats: Stats = new Map([...history].map(([k, v]) => [k, { ...v }]));
  const longest = slots.reduce<DaySlot | null>((m, s) => (!m || s.minutes > m.minutes ? s : m), null);
  return slots.map((slot) => {
    let type: SessionType;
    switch (sport) {
      case "SWIM":
        type = "SWIM";
        break;
      case "WALK":
        type = slot === longest && slot.minutes >= 120 ? "WALK_HIKE" : "WALK_WALK";
        break;
      case "CYCLING":
      case "CYCLING_TURBO": {
        const p = sport === "CYCLING" ? "CYCLING" : "CYCLING_TURBO";
        const [easy, long, hills] = [`${p}_EASY`, `${p}_LONG`, `${p}_HILLS`] as SessionType[];
        if (slot === longest && slot.minutes >= (LONG_AT[sport] ?? 90)) type = long;
        else type = slot.minutes >= 45 ? leastRecent([easy, hills], stats) : easy;
        break;
      }
      case "GOLF": {
        if (slot.minutes >= 180 && visible.includes("GOLF_ROUND")) {
          type = "GOLF_ROUND";
          break;
        }
        const options: SessionType[] = ["GOLF_RANGE", "GOLF_SHORT_GAME", "GOLF_PUTTING"];
        if (visible.includes("GOLF_SIMULATOR")) options.push("GOLF_SIMULATOR");
        type = leastRecent(options, stats);
        break;
      }
      default:
        throw new Error(`No rotation for ${sport}`);
    }
    bump(stats, type, slot.key);
    return { key: slot.key, type, minutes: slot.minutes };
  });
}

export interface StrengthDay {
  key: string;
  /** A strength session already kept on this day, with its focus. */
  existingFocus: Focus | null;
  /** The plan has a strength slot on this day to fill. */
  slot: boolean;
}

/** Continues the split's rotation from the last focus trained, through the window's days in order. */
export function chooseStrength(days: StrengthDay[], rotation: Focus[], lastFocus: Focus | null): { key: string; focus: Focus }[] {
  let last = lastFocus;
  const out: { key: string; focus: Focus }[] = [];
  for (const d of days) {
    if (d.existingFocus) {
      last = d.existingFocus;
      continue;
    }
    if (!d.slot) continue;
    const focus = nextInRotation(rotation, last);
    out.push({ key: d.key, focus });
    last = focus;
  }
  return out;
}

// --- The week ---------------------------------------------------------------------

export interface WeekFromPlanResult {
  planId: string;
  planStatus: string;
  /** Which week of the plan the window mostly falls in, and how many it has. */
  weekOfPlan: number;
  totalWeeks: number;
  endDate: string;
  added: number;
  replaced: number;
  sessions: { date: string; sport: Sport; type: SessionType; label: string; minutes: number }[];
  progress: { sport: Sport; done: number; expected: number }[];
  notes: string[];
}

const sportOf = (type: SessionType): Sport | null => {
  for (const [sport, types] of Object.entries(SPORT_SESSION_TYPES) as [Sport, SessionType[]][]) if (types.includes(type)) return sport;
  return null;
};

export async function planWeekFromPlan(userId: string, startKey: string, todayKey: string): Promise<WeekFromPlanResult> {
  const start = dayKeyToDate(startKey);
  const end = addDays(start, WINDOW_DAYS);
  const today = dayKeyToDate(todayKey);
  const notes: string[] = [];

  const plans = await prisma.trainingPlan.findMany({
    where: { userId, status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" },
    include: { versions: { where: { effectiveTo: null }, include: { slots: true } } },
  });
  const plan = plans.find((p) => p.status === "ACTIVE" && (p.versions[0]?.slots.length ?? 0) > 0) ?? plans.find((p) => (p.versions[0]?.slots.length ?? 0) > 0);
  if (!plan) throw new PlanWeekError("There's no weekly pattern to plan from yet. Start a plan and set its weekly pattern (a day and minutes for each session) first.");
  const slots = plan.versions[0].slots;
  if (plan.status !== "ACTIVE") notes.push("Your plan isn't approved yet, so this uses its draft weekly pattern.");

  const planStartKey = dateToDayKey(plan.startDate);
  const planEndKey = dateToDayKey(plan.endDate);
  const totalWeeks = Math.max(1, Math.round(((plan.endDate.getTime() - plan.startDate.getTime()) / DAY_MS + 1) / 7));
  const midKey = dateToDayKey(addDays(start, 3));
  const weekOfPlan = Math.min(totalWeeks, Math.max(1, Math.floor((dayKeyToDate(midKey).getTime() - plan.startDate.getTime()) / DAY_MS / 7) + 1));
  const sports = [...new Set(slots.map((s) => s.sport))];
  const planTypes = sports.flatMap((s) => SPORT_SESSION_TYPES[s]);

  const [user, windowSessions, historyRows, recentRuns, lastFocus, workoutCount] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { visibleSessionTypes: true } }),
    prisma.plannedSession.findMany({ where: { userId, date: { gte: start, lt: end } } }),
    prisma.plannedSession.findMany({
      where: { userId, completed: true, date: { gte: addDays(start, -HISTORY_DAYS), lt: start } },
      select: { type: true, date: true },
    }),
    prisma.plannedSession.findMany({
      where: { userId, completed: true, type: { in: RUN_TYPES }, date: { gte: addDays(today, -42), lt: addDays(today, 1) }, actualMinutes: { not: null } },
      select: { actualMinutes: true },
    }),
    lastTrainedFocus(userId),
    prisma.workoutSession.count({ where: { userId, date: { gte: plan.startDate, lt: start } } }),
  ]);

  // Earlier auto-planned entries for these sports that haven't happened are replaced.
  const isRemovable = (s: { type: SessionType; autoPlanned: boolean; completed: boolean; date: Date }) =>
    s.autoPlanned && !s.completed && s.date >= today && planTypes.includes(s.type);
  const kept = windowSessions.filter((s) => !isRemovable(s));
  const removable = windowSessions.filter(isRemovable);
  const keptOn = (key: string) => kept.filter((s) => dateToDayKey(s.date) === key);

  // The window's days that the plan covers, and the slots that fall on them.
  const dayInfo = Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const date = addDays(start, i);
    const key = dateToDayKey(date);
    return { key, date, dow: date.getUTCDay(), usable: date >= today && key >= planStartKey && key <= planEndKey };
  });
  if (!dayInfo.some((d) => d.usable)) {
    throw new PlanWeekError(
      dayKeyToDate(planEndKey) < start
        ? "Your plan ended on " + planEndKey + ". Set up a new plan from Settings to keep planning weeks from it."
        : "None of these days fall inside your plan yet. Plan from a week that starts on or after " + planStartKey + ".",
    );
  }

  const slotsFor = (sport: Sport): DaySlot[] => {
    const out: DaySlot[] = [];
    let skipped = 0;
    for (const d of dayInfo) {
      if (!d.usable) continue;
      const daySlots = slots.filter((s) => s.sport === sport && s.dayOfWeek === d.dow);
      if (daySlots.length === 0) continue;
      const here = keptOn(d.key);
      const covered = here.some((s) => sportOf(s.type) === sport) || here.some((s) => s.type === "REST");
      if (covered) {
        skipped += daySlots.length;
        continue;
      }
      const minutes = daySlots.reduce((sum, s) => sum + (s.estimatedMinutes ?? 45), 0);
      out.push({ key: d.key, minutes });
    }
    if (skipped > 0) notes.push(`${SPORT_NAME[sport]}: left ${skipped} slot${skipped === 1 ? "" : "s"} alone because you already have something planned that day.`);
    return out;
  };

  // How the person's recent sessions are spread across types, per sport.
  const statsFor = (sport: Sport): Stats => {
    const stats: Stats = new Map();
    for (const h of historyRows) if (SPORT_SESSION_TYPES[sport].includes(h.type)) bump(stats, h.type, dateToDayKey(h.date));
    for (const k of kept) if (SPORT_SESSION_TYPES[sport].includes(k.type)) bump(stats, k.type, dateToDayKey(k.date));
    return stats;
  };

  type Create = { key: string; sport: Sport; type: SessionType; minutes: number; notes: string; movementPattern?: MovementPattern };
  const creates: Create[] = [];

  for (const sport of sports) {
    const daySlots = slotsFor(sport);
    if (daySlots.length === 0) continue;

    if (sport === "STRENGTH") {
      const perWeek = slots.filter((s) => s.sport === "STRENGTH").length;
      const split = splitForDays(perWeek);
      const days: StrengthDay[] = dayInfo.map((d) => {
        const existing = keptOn(d.key).find((s) => s.type === "STRENGTH" && s.movementPattern);
        return { key: d.key, existingFocus: (existing?.movementPattern as Focus | undefined) ?? null, slot: daySlots.some((s) => s.key === d.key) };
      });
      const chosen = chooseStrength(days, split.rotation, lastFocus);
      for (const c of chosen) {
        const minutes = daySlots.find((s) => s.key === c.key)!.minutes;
        creates.push({ key: c.key, sport, type: "STRENGTH", minutes, movementPattern: c.focus as MovementPattern, notes: `Planned from your training plan · ${FOCUS_LABELS[c.focus]} · ${split.label}` });
      }
    } else if (sport === "RUN") {
      const q = quarterOf(midKey);
      const wk = planWeek(q.week);
      const base = baselines(recentRuns.reduce((m, s) => Math.max(m, s.actualMinutes ?? 0), 0) || null);
      const existingRuns = kept.filter((s) => (RUN_TYPES as string[]).includes(s.type));
      const full = typesForWeek(q.week, daySlots.length + existingRuns.length);
      for (const r of existingRuns) {
        const at = full.indexOf(r.type as RunType);
        if (at >= 0) full.splice(at, 1);
      }
      const toPlace = full.slice(0, daySlots.length).map((type) => ({ type, minutes: minutesFor(type, q.week, base) }));
      const slotKeys = new Map(daySlots.map((s) => [s.key, s.minutes]));
      const days: RunDay[] = dayInfo.map((d) => ({
        key: d.key,
        dow: d.dow,
        past: !d.usable,
        // Only the days the pattern puts a run on can take one.
        blocked: !slotKeys.has(d.key) || keptOn(d.key).some((s) => (RUN_TYPES as string[]).includes(s.type)),
        free: slotKeys.get(d.key) ?? 0,
        busy: false,
      }));
      const { placements } = placeRuns({
        days,
        toPlace,
        existingHardKeys: existingRuns.filter((r) => ["RUN_TEMPO", "RUN_FARTLEK", "RUN_INTERVALS", "RUN_LONG_RUN"].includes(r.type)).map((r) => dateToDayKey(r.date)),
        existingRunKeys: existingRuns.map((r) => dateToDayKey(r.date)),
      });
      const used = new Set(placements.map((p) => p.key));
      // Slots the hard-day rules left empty become easy runs, so every slot is used.
      const leftover = daySlots.filter((s) => !used.has(s.key)).map((s) => ({ key: s.key, type: "RUN_RECOVERY" as RunType, minutes: Math.min(s.minutes, minutesFor("RUN_RECOVERY", q.week, base)) }));
      for (const p of [...placements, ...leftover]) {
        const d = describe(p.type, q.week);
        creates.push({ key: p.key, sport, type: p.type, minutes: p.minutes, notes: `${wk.phase} · week ${q.week} of ${PLAN_WEEKS} · ${TYPE_LABEL[p.type]}: ${d.structure}\n${d.effort}` });
      }
    } else {
      for (const c of chooseByRotation(sport, daySlots, user.visibleSessionTypes, statsFor(sport))) {
        creates.push({
          key: c.key,
          sport,
          type: c.type,
          minutes: c.minutes,
          notes: sport === "GOLF" ? "Planned from your training plan. Build the drills in Log when you start it." : "Planned from your training plan.",
        });
      }
    }
  }

  // An auto rest day gives way to a session on the same day.
  const sessionDays = new Set(creates.map((c) => c.key));
  const restToClear = kept.filter((s) => s.type === "REST" && s.autoPlanned && !s.completed && sessionDays.has(dateToDayKey(s.date)));
  const deleteIds = [...removable, ...restToClear].map((s) => s.id);

  creates.sort((a, b) => a.key.localeCompare(b.key));
  await prisma.$transaction([
    ...(deleteIds.length ? [prisma.plannedSession.deleteMany({ where: { id: { in: deleteIds } } })] : []),
    prisma.plannedSession.createMany({
      data: creates.map((c) => ({
        userId,
        date: dayKeyToDate(c.key),
        type: c.type,
        movementPattern: c.movementPattern ?? null,
        estimatedMinutes: c.minutes,
        notes: c.notes,
        autoPlanned: true,
      })),
    }),
  ]);

  // Progress so far: done before this week, against what the pattern called for.
  const weeksBefore = Math.max(0, Math.floor((start.getTime() - plan.startDate.getTime()) / DAY_MS / 7));
  const doneRows = await prisma.plannedSession.findMany({
    where: { userId, completed: true, type: { in: planTypes }, date: { gte: plan.startDate, lt: start } },
    select: { type: true },
  });
  const progress = sports.map((sport) => {
    const perWeek = slots.filter((s) => s.sport === sport).length;
    let done = doneRows.filter((r) => SPORT_SESSION_TYPES[sport].includes(r.type)).length;
    if (sport === "STRENGTH") done = Math.max(done, workoutCount);
    return { sport, done, expected: perWeek * weeksBefore };
  });
  for (const p of progress) {
    if (p.expected > 0 && p.done < p.expected - 1) {
      notes.push(`${SPORT_NAME[p.sport]}: ${p.done} done against about ${p.expected} in the plan so far. The pattern hasn't been made heavier to catch up.`);
    }
  }
  if (creates.length === 0) notes.push("Nothing to add: this week's slots are already covered, or none of the pattern's days fall in these 7 days.");

  return {
    planId: plan.id,
    planStatus: plan.status,
    weekOfPlan,
    totalWeeks,
    endDate: planEndKey,
    added: creates.length,
    replaced: removable.length,
    sessions: creates.map((c) => ({ date: c.key, sport: c.sport, type: c.type, label: TYPE_LABEL[c.type], minutes: c.minutes })),
    progress,
    notes,
  };
}

const SPORT_NAME: Record<Sport, string> = {
  STRENGTH: "Strength",
  GOLF: "Golf",
  RUN: "Running",
  WALK: "Walking",
  CYCLING: "Cycling",
  CYCLING_TURBO: "Turbo",
  SWIM: "Swimming",
};
