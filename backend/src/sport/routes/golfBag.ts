import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AuthedRequest } from "../../lib/requireAuth.js";
import { ALLOWED_CLUBS, STANDARD_BAG, estimatedLoft, loadGolfBag, simulatorClubs, sortByLength } from "../services/golfBag.js";
import { dateToDayKey } from "../../lib/dates.js";

// The player's golf profile (handicap, whether they shape shots) and the clubs
// in their bag. Mounted at /golf-bag behind requireAuth.
export const golfBagRouter = Router();

const CLUB_TYPES = ["DRIVER", "WOOD", "HYBRID", "IRON", "WEDGE", "SAND_WEDGE", "PUTTER"] as const;
const MAX_CLUBS = 20;

async function overview(userId: string) {
  const [bag, rows, history] = await Promise.all([
    loadGolfBag(userId),
    prisma.golfClub.findMany({ where: { userId } }),
    prisma.golfHandicapEntry.findMany({ where: { userId }, orderBy: { date: "desc" }, take: 12 }),
  ]);
  const coverage = new Map(bag.coverage.map((c) => [c.name, c]));
  return {
    handicap: bag.handicap,
    canShapeShots: bag.canShapeShots,
    // null = no restrictions. simulatorClubs are the clubs that fit the indoor space.
    simulatorLongestClub: bag.simulatorLongestClub,
    practiceSessionsPerWeek: bag.practiceSessionsPerWeek,
    simulatorClubs: simulatorClubs(bag).map((c) => c.name),
    // Club names from longest to shortest, for choosing the longest one.
    clubsByLength: sortByLength(bag.clubs).map((c) => c.name),
    // Always in order from the longest club (lowest loft) to the putter.
    clubs: sortByLength(rows).map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      loft: c.type === "PUTTER" ? null : Math.round(estimatedLoft(c) * 10) / 10,
      sessions: coverage.get(c.name)?.sessions ?? 0,
      lastPracticed: coverage.get(c.name)?.lastPracticed ?? null,
    })),
    handicapHistory: history.map((h) => ({ date: dateToDayKey(h.date), handicap: h.handicap })),
    allowed: ALLOWED_CLUBS,
  };
}

// GET /golf-bag
golfBagRouter.get("/", async (req: AuthedRequest, res) => {
  res.json(await overview(req.userId!));
});

const profileSchema = z.object({
  handicap: z.number().min(-10).max(54).nullish(),
  canShapeShots: z.boolean().nullish(),
  // Name of a club in the bag, or null for no restrictions.
  simulatorLongestClub: z.string().trim().max(40).nullish(),
  // Golf practice sessions a week (1 to 5).
  practiceSessionsPerWeek: z.number().int().min(1).max(5).optional(),
});

// PUT /golf-bag/profile { handicap?, canShapeShots? }
golfBagRouter.put("/profile", async (req: AuthedRequest, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Handicap must be between -10 and 54" });
  const userId = req.userId!;
  const data: { handicap?: number | null; canShapeShots?: boolean | null; simulatorLongestClub?: string | null; practiceSessionsPerWeek?: number } = {};
  if (parsed.data.practiceSessionsPerWeek !== undefined) data.practiceSessionsPerWeek = parsed.data.practiceSessionsPerWeek;
  if (parsed.data.handicap !== undefined) data.handicap = parsed.data.handicap === null ? null : Math.round(parsed.data.handicap * 10) / 10;
  if (parsed.data.canShapeShots !== undefined) data.canShapeShots = parsed.data.canShapeShots;

  if (parsed.data.simulatorLongestClub !== undefined) {
    const name = parsed.data.simulatorLongestClub;
    if (name !== null && !(await prisma.golfClub.findUnique({ where: { userId_name: { userId, name } } }))) {
      return res.status(400).json({ error: "Choose one of the clubs in your bag" });
    }
    data.simulatorLongestClub = name;
  }

  const before = await prisma.golfProfile.findUnique({ where: { userId } });
  await prisma.golfProfile.upsert({ where: { userId }, update: data, create: { userId, ...data } });
  // Keep a history so the handicap can be tracked over time.
  if (data.handicap !== undefined && data.handicap !== null && data.handicap !== before?.handicap) {
    await prisma.golfHandicapEntry.create({ data: { userId, handicap: data.handicap } });
  }
  res.json(await overview(userId));
});

const clubSchema = z.object({
  name: z.string().trim().min(1, "Give the club a name").max(40),
  type: z.enum(CLUB_TYPES),
});

// POST /golf-bag/clubs
golfBagRouter.post("/clubs", async (req: AuthedRequest, res) => {
  const parsed = clubSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid club" });
  const userId = req.userId!;
  const count = await prisma.golfClub.count({ where: { userId } });
  if (count >= MAX_CLUBS) return res.status(400).json({ error: `A bag holds at most ${MAX_CLUBS} clubs here` });
  if (await prisma.golfClub.findUnique({ where: { userId_name: { userId, name: parsed.data.name } } })) {
    return res.status(409).json({ error: "You already have a club with that name" });
  }
  await prisma.golfClub.create({ data: { userId, ...parsed.data, sortOrder: count } });
  res.status(201).json(await overview(userId));
});

const clubEditSchema = z
  .object({ name: z.string().trim().min(1, "Give the club a name").max(40).optional(), type: z.enum(CLUB_TYPES).optional() })
  .refine((d) => d.name !== undefined || d.type !== undefined, { message: "Nothing to change" });

// PATCH /golf-bag/clubs/:id { name?, type? }. Renaming carries over to the
// simulator limit and to the club recorded on past drills, so history and
// coverage stay attached to the club.
golfBagRouter.patch("/clubs/:id", async (req: AuthedRequest, res) => {
  const parsed = clubEditSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid club" });
  const userId = req.userId!;
  const club = await prisma.golfClub.findFirst({ where: { id: req.params.id, userId } });
  if (!club) return res.status(404).json({ error: "Club not found" });

  const { name, type } = parsed.data;
  if (name !== undefined && name !== club.name) {
    if (await prisma.golfClub.findUnique({ where: { userId_name: { userId, name } } })) {
      return res.status(409).json({ error: "You already have a club with that name" });
    }
  }
  await prisma.golfClub.update({ where: { id: club.id }, data: { ...(name !== undefined ? { name } : {}), ...(type !== undefined ? { type } : {}) } });

  if (name !== undefined && name !== club.name) {
    await prisma.golfProfile.updateMany({ where: { userId, simulatorLongestClub: club.name }, data: { simulatorLongestClub: name } });
    const sessions = await prisma.plannedSession.findMany({ where: { userId, type: { in: ["GOLF_RANGE", "GOLF_SHORT_GAME", "GOLF_PUTTING", "GOLF_SIMULATOR"] }, NOT: { drills: { equals: Prisma.DbNull } } }, select: { id: true, drills: true } });
    for (const s of sessions) {
      const drills = Array.isArray(s.drills) ? (s.drills as any[]) : [];
      if (drills.some((d) => d?.club === club.name)) {
        await prisma.plannedSession.update({ where: { id: s.id }, data: { drills: drills.map((d) => (d?.club === club.name ? { ...d, club: name } : d)) } });
      }
    }
  }
  res.json(await overview(userId));
});

// DELETE /golf-bag/clubs/:id
golfBagRouter.delete("/clubs/:id", async (req: AuthedRequest, res) => {
  const club = await prisma.golfClub.findFirst({ where: { id: req.params.id, userId: req.userId! } });
  if (club) {
    await prisma.golfClub.delete({ where: { id: club.id } });
    // If it was the simulator's longest club, the limit goes back to none.
    await prisma.golfProfile.updateMany({ where: { userId: req.userId!, simulatorLongestClub: club.name }, data: { simulatorLongestClub: null } });
  }
  res.json(await overview(req.userId!));
});

// POST /golf-bag/clubs/standard - fill an empty bag with a typical 14 clubs.
golfBagRouter.post("/clubs/standard", async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  if ((await prisma.golfClub.count({ where: { userId } })) > 0) return res.status(409).json({ error: "Your bag already has clubs in it" });
  await prisma.golfClub.createMany({ data: STANDARD_BAG.map((c, i) => ({ userId, name: c.name, type: c.type, sortOrder: i })) });
  res.status(201).json(await overview(userId));
});
