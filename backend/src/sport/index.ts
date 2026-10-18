// Public interface of the Sport module — deep AI coaching capabilities
// for the sports that get their own intelligence layer (currently
// Strength and Golf; more can be added here later). Other code, in
// Scheduler or index.ts, should only import from this file, never reach
// into sport/routes or sport/services directly. This is the seam a
// future split into a separately-deployed app would cut along.
export { exercisesRouter } from "./routes/exercises.js";
export { gymsRouter } from "./routes/gyms.js";
export { sessionsRouter } from "./routes/sessions.js";
export { workoutsRouter } from "./routes/workouts.js";
export { golfRouter } from "./routes/golf.js";
export { golfRoundsRouter } from "./routes/golfRounds.js";
export { golfBagRouter } from "./routes/golfBag.js";
export { progressRouter } from "./routes/progress.js";

// Training vocabulary and planning functions used outside this module:
// profile.ts previews the split for each days-per-week choice, and the
// Scheduler's week auto-fill places sessions using the split rotation and
// projected per-muscle recovery.
export {
  splitForDays,
  focusMuscles,
  MIN_TRAINING_DAYS,
  MAX_TRAINING_DAYS,
  FOCUS_LABELS,
  type Focus,
  type Muscle,
} from "./lib/training.js";
export { loadExposures, readyTimes, isReadyBy, type TrainingExposure } from "./services/recovery.js";
export { lastTrainedFocus, nextInRotation } from "./services/splitPlanner.js";
