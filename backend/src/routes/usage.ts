import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AuthedRequest } from "../lib/requireAuth.js";
import { USAGE_EVENTS, hasAnalyticsConsent } from "../services/usage.js";

// POST /usage - the app reports that a feature was used. Records nothing
// unless the person has given the analytics consent, and says so in the
// answer so the app can stop sending. Mounted behind requireAuth.
export const usageRouter = Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests." },
});

const schema = z.object({ name: z.enum(USAGE_EVENTS) });

usageRouter.post("/", limiter, async (req: AuthedRequest, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Unknown event" });
  if (!(await hasAnalyticsConsent(req.userId!))) return res.json({ recorded: false });
  await prisma.usageEvent.create({ data: { userId: req.userId!, name: parsed.data.name } });
  res.json({ recorded: true });
});
