import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";

export const exercisesRouter = Router();

const createExerciseSchema = z.object({
  name: z.string().min(1),
  category: z.enum(["COMPOUND", "ACCESSORY"]),
  muscleGroup: z.string().min(1),
  repRangeStyle: z.enum(["STRENGTH", "HYPERTROPHY"]),
  equipment: z.enum(["DUMBBELL", "BARBELL", "EZ_BAR", "BAND", "BODYWEIGHT"]),
  movementPattern: z.enum(["PUSH", "PULL", "LEGS", "CORE"]),
  defaultSets: z.number().int().min(1).max(10).optional(),
});

// GET /exercises - list the shared exercise catalog. Not scoped per-user —
// exercise names/equipment/rep ranges aren't personal data about anyone,
// so every account sees and can add to the same catalog.
exercisesRouter.get("/", async (_req, res) => {
  const exercises = await prisma.exercise.findMany({ orderBy: { name: "asc" } });
  res.json(exercises);
});

// POST /exercises - add a new exercise to the catalog
exercisesRouter.post("/", async (req, res) => {
  const parsed = createExerciseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const exercise = await prisma.exercise.create({ data: parsed.data });
  res.status(201).json(exercise);
});
