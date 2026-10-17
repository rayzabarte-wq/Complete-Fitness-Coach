import type { SessionType, Sport } from "./api.js";

export const SPORT_LABELS: Record<Sport, string> = {
  STRENGTH: "Strength",
  GOLF: "Golf",
  RUN: "Run",
  WALK: "Walk",
  CYCLING: "Cycling",
  CYCLING_TURBO: "Cycling - Turbo",
  SWIM: "Swim",
};

/** The workout types each sport switches on (Settings → Workout types). */
export const SPORT_TYPES: Record<Sport, SessionType[]> = {
  STRENGTH: ["STRENGTH"],
  GOLF: ["GOLF_RANGE", "GOLF_ROUND", "GOLF_SHORT_GAME", "GOLF_PUTTING"],
  RUN: ["RUN_RECOVERY", "RUN_TEMPO", "RUN_FARTLEK", "RUN_INTERVALS", "RUN_LONG_RUN"],
  WALK: ["WALK_WALK", "WALK_HIKE"],
  CYCLING: ["CYCLING_EASY", "CYCLING_LONG", "CYCLING_HILLS"],
  CYCLING_TURBO: ["CYCLING_TURBO_EASY", "CYCLING_TURBO_LONG", "CYCLING_TURBO_HILLS"],
  SWIM: ["SWIM"],
};
