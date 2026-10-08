import { SessionType } from "./api.js";

// One fixed colour per activity type, used everywhere it appears (calendar
// day view, logs, progress), so the colour itself says "that's steps" or
// "that's strength". Whether a target was hit is never shown by changing
// this colour — that's a tick / fill / faded state instead.
//
// Order validated for colour-vision deficiency and normal-vision separation
// against a light surface (dataviz validate_palette.js). Several hues sit
// under 3:1 contrast on white, so they're always paired with a text label.
export type ActivityKey = "STRENGTH" | "STEPS" | "RUN" | "CYCLING" | "GOLF" | "WALK" | "SWIM" | "REST";

export const ACTIVITY_COLORS: Record<ActivityKey, string> = {
  STRENGTH: "#2a78d6",
  STEPS: "#1baf7a",
  RUN: "#eb6834",
  CYCLING: "#4a3aa7",
  GOLF: "#eda100",
  WALK: "#e87ba4",
  SWIM: "#008300",
  REST: "#b4b1a9",
};

export const ACTIVITY_LABELS: Record<ActivityKey, string> = {
  STRENGTH: "Strength",
  STEPS: "Steps",
  RUN: "Run",
  CYCLING: "Cycling",
  GOLF: "Golf",
  WALK: "Walk",
  SWIM: "Swim",
  REST: "Rest",
};

export function activityForSessionType(type: SessionType): ActivityKey {
  if (type === "STRENGTH") return "STRENGTH";
  if (type === "REST") return "REST";
  if (type === "SWIM") return "SWIM";
  if (type.startsWith("GOLF")) return "GOLF";
  if (type.startsWith("RUN")) return "RUN";
  if (type.startsWith("WALK")) return "WALK";
  return "CYCLING";
}

export const FOCUS_LABELS: Record<string, string> = {
  PUSH: "Push",
  PULL: "Pull",
  LEGS: "Legs",
  CORE: "Core",
  UPPER: "Upper",
  LOWER: "Lower",
  FULL_BODY: "Full body",
};

export const MUSCLE_LABELS: Record<string, string> = {
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
