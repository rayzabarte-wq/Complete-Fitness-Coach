import { Router } from "express";
import { z } from "zod";
import { Sport } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AuthedRequest } from "../lib/requireAuth.js";
import { SPORT_SESSION_TYPES } from "../scheduler/lib/sportMapping.js";
import { SPORTS, progressFor, sportsMentioned } from "../services/ambitions.js";

// Ambitions: a few sentences about the person and what they want from sport,
// which suggest workout types to switch on, and a sentence or two per sport to
// review against their progress in it. Mounted at /ambitions behind requireAuth.
export const ambitionsRouter = Router();

async function overview(userId: string) {
  const [user, rows] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { ambitions: true, ambitionsUpdatedAt: true, visibleSessionTypes: true } }),
    prisma.sportAmbition.findMany({ where: { userId } }),
  ]);
  const statements = new Map(rows.map((r) => [r.sport, r]));
  const isActive = (sport: Sport) => SPORT_SESSION_TYPES[sport].some((t) => user.visibleSessionTypes.includes(t));

  const sports = await Promise.all(
    SPORTS.map(async (sport) => {
      const active = isActive(sport);
      const row = statements.get(sport);
      return {
        sport,
        active,
        statement: row?.statement ?? null,
        statementUpdatedAt: row?.updatedAt ?? null,
        progress: active ? await progressFor(userId, sport) : null,
      };
    }),
  );

  return {
    ambitions: user.ambitions,
    ambitionsUpdatedAt: user.ambitionsUpdatedAt,
    // Sports the text seems to be about that aren't switched on yet.
    suggestions: user.ambitions ? sportsMentioned(user.ambitions).filter((s) => !isActive(s)) : [],
    sports,
  };
}

// GET /ambitions
ambitionsRouter.get("/", async (req: AuthedRequest, res) => {
  res.json(await overview(req.userId!));
});

const textSchema = z.object({ ambitions: z.string().trim().max(600, "Keep it to 600 characters or fewer") });

// PUT /ambitions/text - save (or, when empty, clear) the "about me" sentences.
ambitionsRouter.put("/text", async (req: AuthedRequest, res) => {
  const parsed = textSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const text = parsed.data.ambitions;
  await prisma.user.update({
    where: { id: req.userId },
    data: { ambitions: text || null, ambitionsUpdatedAt: text ? new Date() : null },
  });
  res.json(await overview(req.userId!));
});

const statementSchema = z.object({ statement: z.string().trim().max(300, "Keep it to 300 characters or fewer") });

// PUT /ambitions/sports/:sport - save (or, when empty, clear) a sport's statement.
ambitionsRouter.put("/sports/:sport", async (req: AuthedRequest, res) => {
  const sport = z.nativeEnum(Sport).safeParse(String(req.params.sport).toUpperCase());
  if (!sport.success) return res.status(400).json({ error: "Unknown sport" });
  const parsed = statementSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const userId = req.userId!;
  if (!parsed.data.statement) {
    await prisma.sportAmbition.deleteMany({ where: { userId, sport: sport.data } });
  } else {
    await prisma.sportAmbition.upsert({
      where: { userId_sport: { userId, sport: sport.data } },
      update: { statement: parsed.data.statement },
      create: { userId, sport: sport.data, statement: parsed.data.statement },
    });
  }
  res.json(await overview(userId));
});
