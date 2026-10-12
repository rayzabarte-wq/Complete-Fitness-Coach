import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { hasConsent, CONSENT_REQUIRED_MESSAGE } from "../services/consent.js";
import { hashIngestToken } from "./profile.js";
import { measurementInputSchema, saveMeasurements } from "./body.js";
import { saveStepDays, stepDaySchema } from "./steps.js";

// Data uploads from outside the browser: an iPhone Shortcut reading Apple
// Health (steps, and the weight/body-fat Renpho writes there), or the
// Renpho sync script (tools/renpho_sync.py). Authenticated with the
// personal upload token from Settings, not a login session — so a Renpho
// password never has to be given to this app.

export const ingestRouter = Router();

interface IngestRequest extends Request {
  userId?: string;
}

ingestRouter.use(
  rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many uploads — slow down." } })
);

async function requireIngestToken(req: IngestRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: "Missing upload token" });
  const user = await prisma.user.findUnique({ where: { ingestTokenHash: hashIngestToken(token) }, select: { id: true } });
  if (!user) return res.status(401).json({ error: "Upload token not recognised — create a new one in Settings." });
  if (!(await hasConsent(user.id, "BODY_DATA"))) return res.status(403).json({ error: CONSENT_REQUIRED_MESSAGE.BODY_DATA });
  req.userId = user.id;
  next();
}

ingestRouter.use(requireIngestToken);

// Accepts either one day ({ date, steps }) or many ({ days: [...] }) — the
// single-day shape is the easiest to build in the Shortcuts app.
const stepsBody = z.union([stepDaySchema, z.object({ days: z.array(stepDaySchema).min(1).max(400) })]);

ingestRouter.post("/steps", async (req: IngestRequest, res) => {
  const parsed = stepsBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const days = "days" in parsed.data ? parsed.data.days : [parsed.data];
  res.json(await saveStepDays(req.userId!, "APPLE_HEALTH", days));
});

const bodyBody = z.object({
  source: z.enum(["RENPHO", "APPLE_HEALTH"]),
  measurements: z.array(measurementInputSchema).min(1).max(2000),
});

ingestRouter.post("/body", async (req: IngestRequest, res) => {
  const parsed = bodyBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await saveMeasurements(req.userId!, parsed.data.source, parsed.data.measurements));
});
