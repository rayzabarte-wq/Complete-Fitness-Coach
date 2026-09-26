import { Router } from "express";
import { z } from "zod";
import { generateWorkoutPlan, MovementPattern } from "../services/workoutPlanner.js";
import { AuthedRequest } from "../../lib/requireAuth.js";

export const workoutsRouter = Router();

const patternSchema = z.enum(["PUSH", "PULL", "LEGS", "CORE"]);

// POST /workouts/plan/:pattern - generate a full session (all exercises,
// weights/reps/sets, and rest intervals) for one movement pattern, based
// on the signed-in user's own exercise history.
workoutsRouter.post("/plan/:pattern", async (req: AuthedRequest, res) => {
  const parsed = patternSchema.safeParse(req.params.pattern.toUpperCase());
  if (!parsed.success) {
    return res.status(400).json({ error: "Pattern must be one of PUSH, PULL, LEGS, CORE" });
  }

  try {
    const plan = await generateWorkoutPlan(req.userId!, parsed.data as MovementPattern);
    res.status(201).json(plan);
  } catch (err) {
    console.error(err);
    // Surfacing the actual error (rather than a generic message) makes
    // problems like a missing API key easier to diagnose from the UI.
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to generate workout plan" });
  }
});
