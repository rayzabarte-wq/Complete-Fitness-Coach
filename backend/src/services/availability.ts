import { prisma } from "../lib/prisma.js";

export interface Availability {
  /** Minutes available per day, index 0 = Sunday .. 6 = Saturday. */
  minutesByDay: number[];
  notes: string | null;
  /** False until the person has saved it once. */
  isSet: boolean;
  updatedAt: Date | null;
  totalMinutes: number;
  daysAvailable: number;
}

export const NO_TIME = [0, 0, 0, 0, 0, 0, 0];

export function summarise(minutesByDay: number[]) {
  return {
    totalMinutes: minutesByDay.reduce((a, b) => a + b, 0),
    daysAvailable: minutesByDay.filter((m) => m > 0).length,
  };
}

/**
 * The person's average weekly time, for the weekly workout proposal to use
 * alongside their ambitions (services/ambitions.ts) and workout types. Always
 * returns something: until it's been saved, every day is 0 and isSet is false,
 * so a caller can tell "no time" from "never said".
 */
export async function getAvailability(userId: string): Promise<Availability> {
  const row = await prisma.weeklyAvailability.findUnique({ where: { userId } });
  const minutesByDay = row && row.minutesByDay.length === 7 ? row.minutesByDay : NO_TIME;
  return { minutesByDay, notes: row?.notes ?? null, isSet: !!row, updatedAt: row?.updatedAt ?? null, ...summarise(minutesByDay) };
}
