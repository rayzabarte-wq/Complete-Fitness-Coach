import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { AuthedRequest } from "../../lib/requireAuth.js";
import { parseDateParam, DAY_MS } from "../../lib/dates.js";
import { getRecovery } from "../services/recovery.js";
import { getCoverage } from "../services/exerciseSelection.js";
import { suggestToday } from "../services/splitPlanner.js";
import { Muscle } from "../lib/training.js";

// Strength-side data for the Progress tab: strength progression per
// exercise, training balance (recovery now + variation coverage), and
// per-period summaries for the period-on-period comparison.

export const progressRouter = Router();

function bestScore(weightLb: number, reps: number): number {
  // Estimated 1-rep max (Epley) for loaded sets; reps for unloaded ones.
  return weightLb > 0 ? Math.round(weightLb * (1 + reps / 30) * 10) / 10 : reps;
}

async function loadSessions(userId: string, from: Date, to: Date) {
  return prisma.workoutSession.findMany({
    where: { userId, date: { gte: from, lt: to } },
    include: { sets: { include: { exercise: true } } },
    orderBy: { date: "asc" },
  });
}

function range(req: AuthedRequest, defaultDays: number) {
  const to = parseDateParam(req.query.to) ?? new Date(Date.now() + DAY_MS);
  const from = parseDateParam(req.query.from) ?? new Date(to.getTime() - defaultDays * DAY_MS);
  return { from, to };
}

// GET /progress/today - what to train today and why (split + recovery).
progressRouter.get("/today", async (req: AuthedRequest, res) => {
  res.json(await suggestToday(req.userId!));
});

// GET /progress/recovery - per-muscle recovery clocks right now.
progressRouter.get("/recovery", async (req: AuthedRequest, res) => {
  res.json(await getRecovery(req.userId!));
});

// GET /progress/balance?days=28 - recovery now, plus how evenly each
// muscle's regions/angles have been covered recently.
progressRouter.get("/balance", async (req: AuthedRequest, res) => {
  const days = Math.min(120, Math.max(7, Number(req.query.days ?? 28)));
  const [recovery, coverage] = await Promise.all([getRecovery(req.userId!), getCoverage(req.userId!, days)]);
  res.json({ days, recovery, coverage });
});

// GET /progress/strength?from=&to= - per exercise, the best set of each
// session as an estimated 1RM (or reps for bodyweight/band work).
progressRouter.get("/strength", async (req: AuthedRequest, res) => {
  const { from, to } = range(req, 180);
  const sessions = await loadSessions(req.userId!, from, to);
  const byExercise = new Map<string, { id: string; name: string; pattern: string; unit: "e1RM lb" | "reps"; points: { date: string; value: number; bestSet: string }[] }>();
  for (const s of sessions) {
    const bySessionExercise = new Map<string, (typeof s.sets)[number]>();
    for (const set of s.sets) {
      const cur = bySessionExercise.get(set.exerciseId);
      if (!cur || bestScore(set.weightLb, set.reps) > bestScore(cur.weightLb, cur.reps)) bySessionExercise.set(set.exerciseId, set);
    }
    for (const set of bySessionExercise.values()) {
      const entry =
        byExercise.get(set.exerciseId) ??
        byExercise
          .set(set.exerciseId, {
            id: set.exerciseId,
            name: set.exercise.name,
            pattern: set.exercise.movementPattern,
            unit: set.weightLb > 0 ? "e1RM lb" : "reps",
            points: [],
          })
          .get(set.exerciseId)!;
      if (set.weightLb > 0) entry.unit = "e1RM lb";
      const load = set.bandLevel ? `${set.bandLevel} band` : set.weightLb > 0 ? `${set.weightLb}lb` : "BW";
      entry.points.push({ date: s.date.toISOString(), value: bestScore(set.weightLb, set.reps), bestSet: `${load} × ${set.reps}` });
    }
  }
  res.json([...byExercise.values()].sort((a, b) => b.points.length - a.points.length || a.name.localeCompare(b.name)));
});

// GET /progress/strength/summary?from=&to= - totals for one period.
progressRouter.get("/strength/summary", async (req: AuthedRequest, res) => {
  const { from, to } = range(req, 7);
  const sessions = await loadSessions(req.userId!, from, to);
  const sets = sessions.flatMap((s) => s.sets);
  const rpes = sets.map((s) => s.rpe).filter((r): r is number => r != null);
  const setsByMuscle: Partial<Record<Muscle, number>> = {};
  for (const s of sets) {
    const m = s.exercise.primaryMuscle as Muscle | null;
    if (m) setsByMuscle[m] = (setsByMuscle[m] ?? 0) + 1;
  }
  const best = new Map<string, { name: string; value: number }>();
  for (const s of sets) {
    if (s.weightLb <= 0) continue;
    const v = bestScore(s.weightLb, s.reps);
    const cur = best.get(s.exerciseId);
    if (!cur || v > cur.value) best.set(s.exerciseId, { name: s.exercise.name, value: v });
  }
  res.json({
    sessions: sessions.length,
    sets: sets.length,
    volumeLb: Math.round(sets.reduce((a, s) => a + s.weightLb * s.reps, 0)),
    averageRpe: rpes.length ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10 : null,
    hitTargetPercent: sets.length ? Math.round((sets.filter((s) => s.hitTarget).length / sets.length) * 100) : null,
    setsByMuscle,
    bestLifts: Object.fromEntries([...best.entries()].map(([id, v]) => [id, v])),
  });
});
