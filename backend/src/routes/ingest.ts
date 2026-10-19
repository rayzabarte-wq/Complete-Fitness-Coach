import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { hasConsent, CONSENT_REQUIRED_MESSAGE } from "../services/consent.js";
import { hashIngestToken } from "./profile.js";
import { measurementInputSchema, saveMeasurements } from "./body.js";
import { saveStepDays, stepDaySchema } from "./steps.js";
import { nutritionDaySchema, saveNutritionDays } from "./nutrition.js";

// Data uploads from outside the browser: an iPhone Shortcut reading Apple
// Health (steps, calories and macros, and the weight/body-fat Renpho writes there), or the
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
  // Tolerant of how a Shortcut gets the header typed: any case, "Bearer" repeated,
  // quotes or stray spaces and line breaks around the token.
  const header = req.headers.authorization ?? "";
  const token = header.replace(/^(\s*bearer\s+)+/i, "").replace(/["'\s]/g, "") || null;
  if (!token) {
    console.warn("[ingest] rejected: no upload token in the Authorization header");
    return res.status(401).json({ error: "Missing upload token. The header must be Authorization: Bearer cfc_..." });
  }
  const user = await prisma.user.findUnique({ where: { ingestTokenHash: hashIngestToken(token) }, select: { id: true, suspendedAt: true } });
  if (!user) {
    console.warn("[ingest] rejected: upload token not recognised");
    return res.status(401).json({ error: "Upload token not recognised — create a new one in Settings." });
  }
  if (user.suspendedAt) return res.status(403).json({ error: "This account has been suspended." });
  if (!(await hasConsent(user.id, "BODY_DATA"))) {
    console.warn("[ingest] rejected: body data consent is off for the user", user.id);
    return res.status(403).json({ error: CONSENT_REQUIRED_MESSAGE.BODY_DATA });
  }
  req.userId = user.id;
  next();
}

ingestRouter.use(requireIngestToken);

// GET /ingest/ping - lets the Shortcut (or a browser tool) check the token and
// consent without sending any data.
ingestRouter.get("/ping", (_req, res) => res.json({ ok: true }));

// Accepts either one day ({ date, steps }) or many ({ days: [...] }) — the
// single-day shape is the easiest to build in the Shortcuts app.
const stepsBody = z.union([stepDaySchema, z.object({ days: z.array(stepDaySchema).min(1).max(400) })]);

ingestRouter.post("/steps", async (req: IngestRequest, res) => {
  const parsed = stepsBody.safeParse(req.body);
  if (!parsed.success) {
    // A failed union only says "Invalid input"; for the one-day shape, say which field was wrong.
    const single = Array.isArray(req.body?.days) ? null : stepDaySchema.safeParse(req.body);
    console.warn("[ingest] steps rejected: bad body", JSON.stringify(req.body)?.slice(0, 200));
    return res.status(400).json({ error: single && !single.success ? single.error.flatten() : parsed.error.flatten() });
  }
  const days = "days" in parsed.data ? parsed.data.days : [parsed.data];
  res.json(await saveStepDays(req.userId!, "APPLE_HEALTH", days, true));
});

// Calories and macros for a day (as written to Apple Health by MyFitnessPal
// or similar). Same shapes as steps: one day, or { days: [...] }.
const nutritionBody = z.union([nutritionDaySchema, z.object({ days: z.array(nutritionDaySchema).min(1).max(400) })]);

ingestRouter.post("/nutrition", async (req: IngestRequest, res) => {
  const parsed = nutritionBody.safeParse(req.body);
  if (!parsed.success) {
    const single = Array.isArray(req.body?.days) ? null : nutritionDaySchema.safeParse(req.body);
    return res.status(400).json({ error: single && !single.success ? single.error.flatten() : parsed.error.flatten() });
  }
  const days = "days" in parsed.data ? parsed.data.days : [parsed.data];
  res.json(await saveNutritionDays(req.userId!, "APPLE_HEALTH", days));
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
