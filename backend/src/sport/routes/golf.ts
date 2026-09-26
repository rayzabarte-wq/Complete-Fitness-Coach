import { Router } from "express";
import { z } from "zod";
import { generateGolfSessionPlan, GolfSessionType } from "../services/golfPlanner.js";
import { AuthedRequest } from "../../lib/requireAuth.js";

export const golfRouter = Router();

const golfTypeSchema = z.enum(["GOLF_RANGE", "GOLF_SHORT_GAME", "GOLF_PUTTING"]);

const generatePlanSchema = z.object({
  estimatedMinutes: z.number().int().positive().optional(),
});

// POST /golf/plan/:type - generate an AI practice plan for Range, Short
// Game, or Putting. Round is intentionally not supported here — a round
// isn't a practice session to generate drills for.
golfRouter.post("/plan/:type", async (req: AuthedRequest, res) => {
  const parsedType = golfTypeSchema.safeParse(req.params.type.toUpperCase());
  if (!parsedType.success) {
    return res.status(400).json({
      error: "type must be one of GOLF_RANGE, GOLF_SHORT_GAME, GOLF_PUTTING (Round isn't supported — nothing to generate drills for)",
    });
  }

  const parsedBody = generatePlanSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({ error: parsedBody.error.flatten() });
  }

  try {
    const plan = await generateGolfSessionPlan(
      req.userId!,
      parsedType.data as GolfSessionType,
      parsedBody.data.estimatedMinutes
    );
    res.status(201).json(plan);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to generate golf session" });
  }
});
