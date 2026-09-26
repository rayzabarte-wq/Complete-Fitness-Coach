// Public interface of the Sport module — deep AI coaching capabilities
// for the sports that get their own intelligence layer (currently
// Strength and Golf; more can be added here later). Other code, in
// Scheduler or index.ts, should only import from this file, never reach
// into sport/routes or sport/services directly. This is the seam a
// future split into a separately-deployed app would cut along.
export { exercisesRouter } from "./routes/exercises.js";
export { sessionsRouter } from "./routes/sessions.js";
export { workoutsRouter } from "./routes/workouts.js";
export { golfRouter } from "./routes/golf.js";
