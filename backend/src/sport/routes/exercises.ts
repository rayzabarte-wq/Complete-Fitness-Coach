import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { AuthedRequest } from "../../lib/requireAuth.js";

export const exercisesRouter = Router();

const muscle = z.enum(["CHEST", "SHOULDERS", "TRICEPS", "BACK", "BICEPS", "QUADS", "HAMSTRINGS", "GLUTES", "CORE"]);

const createExerciseSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(["COMPOUND", "ACCESSORY"]),
  muscleGroup: z.string().trim().min(1).max(60),
  repRangeStyle: z.enum(["STRENGTH", "HYPERTROPHY"]),
  // How the exercise is loaded: free weights, a band, or bodyweight (with
  // optional added weight). A custom machine/sled is usually "BODYWEIGHT".
  equipment: z.enum(["DUMBBELL", "BARBELL", "EZ_BAR", "BAND", "BODYWEIGHT"]),
  movementPattern: z.enum(["PUSH", "PULL", "LEGS", "CORE"]),
  defaultSets: z.number().int().min(1).max(10).optional(),
  // Recovery + variation tagging (see schema.prisma's Exercise model).
  primaryMuscle: muscle.optional(),
  secondaryMuscles: z.array(muscle).optional(),
  variationTag: z.string().regex(/^[A-Z_]+$/).optional(),
  // Tick-box accessories the exercise needs, and (optionally) one of the
  // user's own CustomEquipment items it is built around.
  requires: z.array(z.enum(["BENCH", "PULL_UP_BAR", "RINGS"])).optional(),
  customEquipmentId: z.string().nullish(),
});

// GET /exercises - the shared catalog plus this user's own custom exercises
// (archived ones included, so logged history still resolves).
exercisesRouter.get("/", async (req: AuthedRequest, res) => {
  const exercises = await prisma.exercise.findMany({
    where: { OR: [{ userId: null }, { userId: req.userId }] },
    orderBy: { name: "asc" },
  });
  res.json(exercises);
});

// POST /exercises - add a custom exercise. It belongs to this user and is
// only offered to them, at gyms that have what it needs.
exercisesRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createExerciseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const userId = req.userId!;
  const { customEquipmentId, ...data } = parsed.data;

  if (customEquipmentId) {
    const owned = await prisma.customEquipment.findFirst({ where: { id: customEquipmentId, userId } });
    if (!owned) return res.status(400).json({ error: "Unknown custom equipment" });
  }
  // Names must be unique among the catalog and this user's own exercises.
  const clash = await prisma.exercise.findFirst({
    where: { name: { equals: data.name, mode: "insensitive" }, OR: [{ userId: null }, { userId }], archivedAt: null },
  });
  if (clash) return res.status(409).json({ error: `There is already an exercise called "${clash.name}"` });

  const archivedSame = await prisma.exercise.findFirst({ where: { name: data.name, userId } });
  const payload = {
    ...data,
    primaryMuscle: data.primaryMuscle ?? null,
    requires: data.requires ?? [],
    customEquipmentId: customEquipmentId ?? null,
  };
  // Re-adding the name of one they archived revives it rather than hitting
  // the (userId, name) unique index.
  const exercise = archivedSame
    ? await prisma.exercise.update({ where: { id: archivedSame.id }, data: { ...payload, archivedAt: null } })
    : await prisma.exercise.create({ data: { ...payload, userId } });
  res.status(201).json(exercise);
});

// DELETE /exercises/:id - archive one of the user's own custom exercises.
// Kept in the database so past workouts still show it, but never offered.
exercisesRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const result = await prisma.exercise.updateMany({
    where: { id: req.params.id, userId: req.userId },
    data: { archivedAt: new Date() },
  });
  if (result.count === 0) return res.status(404).json({ error: "Custom exercise not found" });
  res.status(204).send();
});
