import type { Sport, SessionType } from "@prisma/client";

// Groups the fine-grained SessionType enum (what the Calendar/PlannedSession
// actually tracks) back up to the coarser Sport enum the 3-month plan works
// in — mirrors frontend/src/lib/sessionTypes.ts's SESSION_TYPE_TREE grouping.
// REST has no Sport — it's excluded from planning and dashboard math.
export const SPORT_SESSION_TYPES: Record<Sport, SessionType[]> = {
  STRENGTH: ["STRENGTH"],
  GOLF: ["GOLF_RANGE", "GOLF_ROUND", "GOLF_SHORT_GAME", "GOLF_PUTTING", "GOLF_SIMULATOR"],
  RUN: ["RUN_RECOVERY", "RUN_TEMPO", "RUN_FARTLEK", "RUN_INTERVALS", "RUN_LONG_RUN"],
  WALK: ["WALK_WALK", "WALK_HIKE"],
  CYCLING: ["CYCLING_EASY", "CYCLING_LONG", "CYCLING_HILLS"],
  CYCLING_TURBO: ["CYCLING_TURBO_EASY", "CYCLING_TURBO_LONG", "CYCLING_TURBO_HILLS"],
  SWIM: ["SWIM"],
};

const SESSION_TYPE_TO_SPORT = new Map<SessionType, Sport>();
for (const [sport, types] of Object.entries(SPORT_SESSION_TYPES) as [Sport, SessionType[]][]) {
  for (const t of types) SESSION_TYPE_TO_SPORT.set(t, sport);
}

/** Which Sport a specific SessionType belongs to — null for REST, which
 * isn't part of the plan/dashboard's sport grouping at all. */
export function sportForSessionType(type: SessionType): Sport | null {
  return SESSION_TYPE_TO_SPORT.get(type) ?? null;
}

/** Sports whose SessionType has more than one member — these are the ones
 * with a meaningful sub-type breakdown in the dashboard (Golf, Run, Walk,
 * Cycling, Cycling - Turbo). STRENGTH has its own sub-breakdown via
 * MovementPattern instead (see the dashboard service), and SWIM is a plain
 * leaf with nothing to break down. */
export function hasSessionTypeSubTypes(sport: Sport): boolean {
  return SPORT_SESSION_TYPES[sport].length > 1;
}
