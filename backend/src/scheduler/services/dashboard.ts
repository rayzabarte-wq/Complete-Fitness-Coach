import { prisma } from "../../lib/prisma.js";
import type { Sport, TimeOfDay, SessionType, MovementPattern } from "@prisma/client";
import { sportForSessionType, hasSessionTypeSubTypes } from "../lib/sportMapping.js";

// "UNSPECIFIED" covers a planned slot with no sessionType/movementPattern
// set (the AI didn't have a strong reason to pick one) or a rare actual
// STRENGTH session logged with no movement pattern — kept as its own
// bucket rather than dropped, so planned/completed totals still add up.
const UNSPECIFIED = "UNSPECIFIED";

interface SlotLike {
  dayOfWeek: number;
  timeOfDay: TimeOfDay;
  sport: Sport;
  sessionType: SessionType | null;
  movementPattern: MovementPattern | null;
}

interface VersionLike {
  effectiveFrom: Date;
  effectiveTo: Date | null;
  slots: SlotLike[];
}

export interface SubTypeReport {
  key: string;
  plannedCount: number;
  completedCount: number;
  completedMinutes: number;
}

export interface SportReport {
  sport: Sport;
  plannedCount: number;
  completedCount: number;
  completedMinutes: number;
  consistencyPercent: number | null;
  subTypes: SubTypeReport[];
}

export interface PeriodReport {
  totalPlanned: number;
  totalCompleted: number;
  totalCompletedMinutes: number;
  consistencyPercent: number | null;
  bySport: SportReport[];
}

export interface PeriodDashboard {
  from: string;
  to: string;
  label: string;
  current: PeriodReport;
  // Only present when the plan has been amended at least once — the same
  // period judged as if the ORIGINAL framework (the first version) had
  // applied the whole time, for comparison against `current` (which uses
  // whichever version was actually in effect on each day).
  original?: PeriodReport;
}

export interface Dashboard {
  hasAmendments: boolean;
  week: PeriodDashboard;
  month: PeriodDashboard;
}

function truncateToDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function datesInRange(from: Date, to: Date): Date[] {
  const dates: Date[] = [];
  for (let d = truncateToDay(from); d <= to; d = addDays(d, 1)) {
    dates.push(d);
  }
  return dates;
}

/** The version in effect on a given calendar day — matched at day
 * granularity (an amendment made partway through a day counts for that
 * whole day under the new version) rather than exact timestamps, since the
 * dashboard only ever reasons in whole days. */
function findVersionForDate(date: Date, versionsAsc: VersionLike[]): VersionLike | null {
  for (const v of versionsAsc) {
    const from = truncateToDay(v.effectiveFrom);
    const to = v.effectiveTo ? truncateToDay(v.effectiveTo) : null;
    if (date >= from && (to === null || date < to)) return v;
  }
  return null;
}

function subKeyForActual(sport: Sport, session: { type: SessionType; movementPattern: string | null }): string | null {
  if (sport === "STRENGTH") return session.movementPattern ?? UNSPECIFIED;
  if (hasSessionTypeSubTypes(sport)) return session.type;
  return null;
}

function subKeyForSlot(slot: SlotLike): string | null {
  if (slot.sport === "STRENGTH") return slot.movementPattern ?? UNSPECIFIED;
  if (hasSessionTypeSubTypes(slot.sport)) return slot.sessionType ?? UNSPECIFIED;
  return null;
}

function buildPeriodReport(
  from: Date,
  to: Date,
  versionsAsc: VersionLike[],
  actualSessions: { type: SessionType; movementPattern: string | null; completed: boolean; actualMinutes: number | null; estimatedMinutes: number | null; date: Date }[]
): PeriodReport {
  const plannedCount = new Map<Sport, number>();
  const plannedSub = new Map<Sport, Map<string, number>>();

  for (const date of datesInRange(from, to)) {
    const version = findVersionForDate(date, versionsAsc);
    if (!version) continue;
    const dow = date.getDay();
    for (const slot of version.slots) {
      if (slot.dayOfWeek !== dow) continue;
      plannedCount.set(slot.sport, (plannedCount.get(slot.sport) ?? 0) + 1);
      const subKey = subKeyForSlot(slot);
      if (subKey) {
        if (!plannedSub.has(slot.sport)) plannedSub.set(slot.sport, new Map());
        const m = plannedSub.get(slot.sport)!;
        m.set(subKey, (m.get(subKey) ?? 0) + 1);
      }
    }
  }

  const completedCount = new Map<Sport, number>();
  const completedMinutes = new Map<Sport, number>();
  const completedSub = new Map<Sport, Map<string, { count: number; minutes: number }>>();

  const toExclusive = addDays(truncateToDay(to), 1);
  for (const session of actualSessions) {
    if (!session.completed) continue;
    if (session.date < truncateToDay(from) || session.date >= toExclusive) continue;
    const sport = sportForSessionType(session.type);
    if (!sport) continue; // REST isn't part of the plan/dashboard grouping

    const minutes = session.actualMinutes ?? session.estimatedMinutes ?? 0;
    completedCount.set(sport, (completedCount.get(sport) ?? 0) + 1);
    completedMinutes.set(sport, (completedMinutes.get(sport) ?? 0) + minutes);

    const subKey = subKeyForActual(sport, session);
    if (subKey) {
      if (!completedSub.has(sport)) completedSub.set(sport, new Map());
      const m = completedSub.get(sport)!;
      const existing = m.get(subKey) ?? { count: 0, minutes: 0 };
      m.set(subKey, { count: existing.count + 1, minutes: existing.minutes + minutes });
    }
  }

  const allSports = new Set<Sport>([...plannedCount.keys(), ...completedCount.keys()]);
  const bySport: SportReport[] = [];
  let matchedTotal = 0;
  let totalPlanned = 0;
  let totalCompleted = 0;
  let totalCompletedMinutes = 0;

  for (const sport of allSports) {
    const planned = plannedCount.get(sport) ?? 0;
    const completed = completedCount.get(sport) ?? 0;
    const minutes = completedMinutes.get(sport) ?? 0;
    totalPlanned += planned;
    totalCompleted += completed;
    totalCompletedMinutes += minutes;
    matchedTotal += Math.min(planned, completed);

    const subKeys = new Set<string>([...(plannedSub.get(sport)?.keys() ?? []), ...(completedSub.get(sport)?.keys() ?? [])]);
    const subTypes: SubTypeReport[] = [...subKeys].map((key) => ({
      key,
      plannedCount: plannedSub.get(sport)?.get(key) ?? 0,
      completedCount: completedSub.get(sport)?.get(key)?.count ?? 0,
      completedMinutes: completedSub.get(sport)?.get(key)?.minutes ?? 0,
    }));

    bySport.push({
      sport,
      plannedCount: planned,
      completedCount: completed,
      completedMinutes: minutes,
      consistencyPercent: planned > 0 ? Math.round((Math.min(planned, completed) / planned) * 100) : null,
      subTypes,
    });
  }

  bySport.sort((a, b) => b.plannedCount - a.plannedCount);

  return {
    totalPlanned,
    totalCompleted,
    totalCompletedMinutes,
    consistencyPercent: totalPlanned > 0 ? Math.round((matchedTotal / totalPlanned) * 100) : null,
    bySport,
  };
}

export async function buildDashboard(
  userId: string,
  plan: { id: string; startDate: Date },
  versionsAsc: VersionLike[],
  today: Date
): Promise<Dashboard> {
  const todayDay = truncateToDay(today);
  const planStartDay = truncateToDay(plan.startDate);

  // Week: most recent Sunday through today, inclusive.
  const weekFrom = addDays(todayDay, -todayDay.getDay());
  const weekTo = todayDay;

  // Month: trailing 30 days, clipped to the plan's start if it began more recently.
  const trailing30 = addDays(todayDay, -29);
  const monthFrom = trailing30 > planStartDay ? trailing30 : planStartDay;
  const monthTo = todayDay;
  const daysSincePlanStart = Math.round((monthTo.getTime() - planStartDay.getTime()) / 86400000) + 1;
  const monthLabel = monthFrom.getTime() === planStartDay.getTime() && daysSincePlanStart < 30 ? `Since plan started (${daysSincePlanStart} days)` : "Last 30 days";

  const earliestFrom = weekFrom < monthFrom ? weekFrom : monthFrom;
  const actualSessions = await prisma.plannedSession.findMany({
    where: { userId, date: { gte: earliestFrom, lt: addDays(todayDay, 1) } },
    select: { type: true, movementPattern: true, completed: true, actualMinutes: true, estimatedMinutes: true, date: true },
  });

  const hasAmendments = versionsAsc.length > 1;
  const originalVersion: VersionLike[] = versionsAsc.length > 0 ? [{ ...versionsAsc[0], effectiveFrom: planStartDay, effectiveTo: null }] : [];

  return {
    hasAmendments,
    week: {
      from: weekFrom.toISOString().slice(0, 10),
      to: weekTo.toISOString().slice(0, 10),
      label: "This week (Sun–today)",
      current: buildPeriodReport(weekFrom, weekTo, versionsAsc, actualSessions),
      ...(hasAmendments ? { original: buildPeriodReport(weekFrom, weekTo, originalVersion, actualSessions) } : {}),
    },
    month: {
      from: monthFrom.toISOString().slice(0, 10),
      to: monthTo.toISOString().slice(0, 10),
      label: monthLabel,
      current: buildPeriodReport(monthFrom, monthTo, versionsAsc, actualSessions),
      ...(hasAmendments ? { original: buildPeriodReport(monthFrom, monthTo, originalVersion, actualSessions) } : {}),
    },
  };
}
