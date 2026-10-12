// Shared strength-training vocabulary: the muscle list, what each session
// focus covers, and which split a given number of training days per week
// maps to. Pure data + pure functions — no database access — so it can be
// unit-tested directly and reused by the recovery, selection and auto-fill
// services.

export type Muscle =
  | "CHEST"
  | "SHOULDERS"
  | "TRICEPS"
  | "BACK"
  | "BICEPS"
  | "QUADS"
  | "HAMSTRINGS"
  | "GLUTES"
  | "CORE";

export const MUSCLES: Muscle[] = ["CHEST", "SHOULDERS", "TRICEPS", "BACK", "BICEPS", "QUADS", "HAMSTRINGS", "GLUTES", "CORE"];

export const MUSCLE_LABELS: Record<Muscle, string> = {
  CHEST: "Chest",
  SHOULDERS: "Shoulders",
  TRICEPS: "Triceps",
  BACK: "Back",
  BICEPS: "Biceps",
  QUADS: "Quads",
  HAMSTRINGS: "Hamstrings",
  GLUTES: "Glutes",
  CORE: "Core",
};

/** The movement patterns an exercise can belong to. */
export type ExercisePattern = "PUSH" | "PULL" | "LEGS" | "CORE";

/** A session's focus: one of the exercise patterns, or a combined focus
 * used by the upper/lower and full-body splits. */
export type Focus = ExercisePattern | "UPPER" | "LOWER" | "FULL_BODY";

export const FOCUSES: Focus[] = ["PUSH", "PULL", "LEGS", "CORE", "UPPER", "LOWER", "FULL_BODY"];

export const FOCUS_LABELS: Record<Focus, string> = {
  PUSH: "Push",
  PULL: "Pull",
  LEGS: "Legs",
  CORE: "Core",
  UPPER: "Upper",
  LOWER: "Lower",
  FULL_BODY: "Full body",
};

/** Which exercise patterns a focus draws its main exercises from. */
export const FOCUS_SOURCE_PATTERNS: Record<Focus, ExercisePattern[]> = {
  PUSH: ["PUSH"],
  PULL: ["PULL"],
  LEGS: ["LEGS"],
  CORE: ["CORE"],
  UPPER: ["PUSH", "PULL"],
  LOWER: ["LEGS"],
  FULL_BODY: ["PUSH", "PULL", "LEGS"],
};

/** The main-exercise slots for each focus. Each slot is filled with one
 * exercise whose PRIMARY muscle is in the slot's list — so a Push day always
 * covers chest, shoulders and triceps rather than, say, three chest moves.
 * Four slots per session (plus the 2-exercise core finisher), matching the
 * "4 exercises + 2 core" session shape. */
export const FOCUS_SLOTS: Record<Focus, Muscle[][]> = {
  PUSH: [["CHEST"], ["SHOULDERS"], ["TRICEPS"], ["CHEST"]],
  PULL: [["BACK"], ["BICEPS"], ["BACK"], ["BACK"]],
  LEGS: [["QUADS"], ["HAMSTRINGS"], ["GLUTES"], ["QUADS"]],
  CORE: [["CORE"], ["CORE"], ["CORE"], ["CORE"], ["CORE"]],
  UPPER: [["CHEST"], ["BACK"], ["SHOULDERS"], ["TRICEPS", "BICEPS"]],
  LOWER: [["QUADS"], ["HAMSTRINGS"], ["GLUTES"], ["QUADS", "HAMSTRINGS"]],
  FULL_BODY: [["QUADS"], ["CHEST"], ["BACK"], ["HAMSTRINGS", "GLUTES"]],
};

/** Muscles a focus loads as a primary target — used when projecting
 * recovery for sessions that haven't happened yet (auto-fill). */
export function focusMuscles(focus: Focus): Muscle[] {
  return [...new Set(FOCUS_SLOTS[focus].flat())];
}

export interface Split {
  key: "FULL_BODY" | "UPPER_LOWER" | "PPLUL" | "PPL";
  label: string;
  /** Session order to cycle through. */
  rotation: Focus[];
  /** Plain-language reason this split fits the chosen number of days. */
  explanation: string;
}

export const MIN_TRAINING_DAYS = 2;
export const MAX_TRAINING_DAYS = 6;

/**
 * Picks the split for a weekly training-day commitment so every muscle is
 * still trained about twice a week — the frequency the hypertrophy research
 * favours over once a week when weekly volume is matched (Schoenfeld,
 * Ogborn & Krieger 2016, Sports Medicine). Push/pull/legs only gets there
 * at ~6 days; with fewer days it drops to once a week per muscle, so fewer
 * days switch to upper/lower or full body instead.
 */
export function splitForDays(days: number): Split {
  const d = Math.min(Math.max(Math.round(days), MIN_TRAINING_DAYS), MAX_TRAINING_DAYS);
  if (d <= 3) {
    return {
      key: "FULL_BODY",
      label: `Full body × ${d}`,
      rotation: Array.from({ length: d }, () => "FULL_BODY" as Focus),
      explanation: `With ${d} days a week, full-body sessions are the only way to hit each muscle ${d === 2 ? "twice" : "two to three times"} a week. A ${d}-day push/pull/legs would train each muscle just once.`,
    };
  }
  if (d === 4) {
    return {
      key: "UPPER_LOWER",
      label: "Upper / Lower",
      rotation: ["UPPER", "LOWER", "UPPER", "LOWER"],
      explanation: "With 4 days a week, upper/lower trains every muscle twice a week. Push/pull/legs over 4 days would train some muscles only once.",
    };
  }
  if (d === 5) {
    return {
      key: "PPLUL",
      label: "Push / Pull / Legs / Upper / Lower",
      rotation: ["PUSH", "PULL", "LEGS", "UPPER", "LOWER"],
      explanation: "With 5 days a week, push/pull/legs followed by upper/lower trains every muscle twice a week.",
    };
  }
  return {
    key: "PPL",
    label: "Push / Pull / Legs × 2",
    rotation: ["PUSH", "PULL", "LEGS", "PUSH", "PULL", "LEGS"],
    explanation: "With 6 days a week, push/pull/legs run twice trains every muscle twice a week, with the most focus per session.",
  };
}
