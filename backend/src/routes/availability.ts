import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AuthedRequest } from "../lib/requireAuth.js";
import { getAvailability } from "../services/availability.js";

// The person's average weekly time for training, set in Settings and used when
// proposing the next 7 days of workouts. Mounted at /availability behind requireAuth.
export const availabilityRouter = Router();

// GET /availability
availabilityRouter.get("/", async (req: AuthedRequest, res) => {
  res.json(await getAvailability(req.userId!));
});

const saveSchema = z.object({
  // Sunday first. Up to 12 hours a day, in whole minutes.
  minutesByDay: z.array(z.number().int().min(0).max(720)).length(7, "Give a value for each of the seven days"),
  notes: z.string().trim().max(300, "Keep the notes to 300 characters or fewer").nullish(),
});

// PUT /availability
availabilityRouter.put("/", async (req: AuthedRequest, res) => {
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = { minutesByDay: parsed.data.minutesByDay, notes: parsed.data.notes || null };
  await prisma.weeklyAvailability.upsert({
    where: { userId: req.userId! },
    update: data,
    create: { userId: req.userId!, ...data },
  });
  res.json(await getAvailability(req.userId!));
});
