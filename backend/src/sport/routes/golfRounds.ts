import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { AuthedRequest } from "../../lib/requireAuth.js";
import { DAY_MS, addDays, dateToDayKey, dayKeyToDate, isDayKey } from "../../lib/dates.js";
import { quarterBounds, quarterOf } from "../../services/goals.js";

// Golf rounds played, logged by hand, and a goal for how many to play in a
// calendar quarter. Every round counts as one towards the goal, whether it
// was 9 or 18 holes. Mounted at /golf-rounds behind requireAuth.
export const golfRoundsRouter = Router();

const quarterSchema = z.string().regex(/^\d{4}-Q[1-4]$/, "Quarter must look like 2026-Q4");

const roundSchema = z.object({
  date: z.string().refine(isDayKey, "date must be YYYY-MM-DD"),
  course: z.string().trim().min(1, "Add the course").max(80),
  holes: z.union([z.literal(9), z.literal(18)]),
  score: z.number().int().min(10).max(250).nullish(),
  notes: z.string().trim().max(500).nullish(),
});

function serialize(r: { id: string; date: Date; course: string; holes: number; score: number | null; notes: string | null }) {
  return { id: r.id, date: dateToDayKey(r.date), course: r.course, holes: r.holes, score: r.score, notes: r.notes };
}

// A round can't be dated more than a day ahead (allows for time zones).
function notInFuture(date: Date): boolean {
  return date.getTime() <= Date.now() + DAY_MS;
}

// GET /golf-rounds?quarter=2026-Q4 - the quarter's rounds, its goal and
// progress, and course names used before (for suggestions).
golfRoundsRouter.get("/", async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const parsed = quarterSchema.safeParse(req.query.quarter ?? quarterOf(new Date()));
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const quarter = parsed.data;
  const { from, to } = quarterBounds(quarter);

  const [rounds, goal, courseRows] = await Promise.all([
    prisma.golfRound.findMany({ where: { userId, date: { gte: from, lt: to } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] }),
    prisma.golfRoundGoal.findUnique({ where: { userId_quarter: { userId, quarter } } }),
    prisma.golfRound.findMany({ where: { userId }, distinct: ["course"], orderBy: { date: "desc" }, take: 20, select: { course: true } }),
  ]);

  const now = Date.now();
  const totalDays = Math.round((to.getTime() - from.getTime()) / DAY_MS);
  const daysLeft = Math.max(0, Math.min(totalDays, Math.ceil((to.getTime() - now) / DAY_MS)));
  const target = goal?.target ?? null;
  const count = rounds.length;
  const remaining = target === null ? null : Math.max(0, target - count);
  // How many rounds should be done by now to finish evenly across the quarter.
  const expectedByNow = target === null ? null : (target * (totalDays - daysLeft)) / totalDays;
  const eighteens = rounds.filter((r) => r.holes === 18 && r.score !== null).map((r) => r.score as number);

  res.json({
    quarter,
    target,
    count,
    remaining,
    daysLeft,
    // Rounds per week still needed to hit the goal (null once met or no goal).
    neededPerWeek: remaining && daysLeft > 0 ? Math.round((remaining / (daysLeft / 7)) * 10) / 10 : null,
    status:
      target === null ? null : count >= target ? "done" : daysLeft === 0 ? "missed" : count + 0.5 >= (expectedByNow ?? 0) ? "on_track" : "behind",
    averageScore18: eighteens.length ? Math.round((eighteens.reduce((a, b) => a + b, 0) / eighteens.length) * 10) / 10 : null,
    bestScore18: eighteens.length ? Math.min(...eighteens) : null,
    rounds: rounds.map(serialize),
    courses: courseRows.map((c) => c.course),
  });
});

// POST /golf-rounds - log a round. If a Round was planned on the calendar for
// that day, it is ticked off.
golfRoundsRouter.post("/", async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const parsed = roundSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const date = dayKeyToDate(parsed.data.date);
  if (!notInFuture(date)) return res.status(400).json({ error: "A round can't be dated in the future." });

  const round = await prisma.golfRound.create({
    data: { userId, date, course: parsed.data.course, holes: parsed.data.holes, score: parsed.data.score ?? null, notes: parsed.data.notes || null },
  });
  await prisma.plannedSession.updateMany({
    where: { userId, type: "GOLF_ROUND", completed: false, date: { gte: date, lt: addDays(date, 1) } },
    data: { completed: true },
  });
  res.status(201).json(serialize(round));
});

// PUT /golf-rounds/:id - replace a round's details.
golfRoundsRouter.put("/:id", async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const parsed = roundSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const date = dayKeyToDate(parsed.data.date);
  if (!notInFuture(date)) return res.status(400).json({ error: "A round can't be dated in the future." });
  const updated = await prisma.golfRound.updateMany({
    where: { id: req.params.id, userId },
    data: { date, course: parsed.data.course, holes: parsed.data.holes, score: parsed.data.score ?? null, notes: parsed.data.notes || null },
  });
  if (updated.count === 0) return res.status(404).json({ error: "No such round" });
  const round = await prisma.golfRound.findUniqueOrThrow({ where: { id: req.params.id } });
  res.json(serialize(round));
});

// DELETE /golf-rounds/:id
golfRoundsRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const deleted = await prisma.golfRound.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  if (deleted.count === 0) return res.status(404).json({ error: "No such round" });
  res.status(204).send();
});

const goalSchema = z.object({ quarter: quarterSchema, target: z.number().int().min(1).max(90) });

// PUT /golf-rounds/goal/set - set or change the rounds goal for a quarter.
golfRoundsRouter.put("/goal/set", async (req: AuthedRequest, res) => {
  const userId = req.userId!;
  const parsed = goalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { quarter, target } = parsed.data;
  await prisma.golfRoundGoal.upsert({
    where: { userId_quarter: { userId, quarter } },
    update: { target },
    create: { userId, quarter, target },
  });
  res.status(204).send();
});

// DELETE /golf-rounds/goal/:quarter - remove a quarter's goal.
golfRoundsRouter.delete("/goal/:quarter", async (req: AuthedRequest, res) => {
  const parsed = quarterSchema.safeParse(req.params.quarter);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await prisma.golfRoundGoal.deleteMany({ where: { userId: req.userId, quarter: parsed.data } });
  res.status(204).send();
});
