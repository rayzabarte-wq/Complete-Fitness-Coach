import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { SessionType, Sport } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AuthedRequest } from "../lib/requireAuth.js";
import { dayKeyToDate, isDayKey } from "../lib/dates.js";
import { SPORT_SESSION_TYPES } from "../scheduler/lib/sportMapping.js";
import { checkCustomEnd, horizonLimits, suggestHorizon, weeksBetween } from "../scheduler/services/horizon.js";
import { interpretAnswers } from "../services/onboarding.js";

// The welcome journey: optional answers in prose that suggest goal settings,
// the sports to plan for, and how far ahead the first plan looks. Mounted at
// /onboarding behind requireAuth.
export const onboardingRouter = Router();

const sportSchema = z.enum(["STRENGTH", "GOLF", "RUN", "WALK", "CYCLING", "CYCLING_TURBO", "SWIM"]);
const todaySchema = z.string().refine(isDayKey, "today must be YYYY-MM-DD");

// GET /onboarding/horizon?today=YYYY-MM-DD - the end date suggested for a plan
// started today, and the earliest and latest date a person can choose instead.
onboardingRouter.get("/horizon", (req, res) => {
  const today = todaySchema.safeParse(req.query.today);
  if (!today.success) return res.status(400).json({ error: "today must be YYYY-MM-DD" });
  res.json({ today: today.data, suggested: suggestHorizon(today.data), ...horizonLimits(today.data) });
});

const interpretLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "That's a lot of tries in a minute. Wait a moment and try again." },
});

const answersSchema = z.object({
  today: todaySchema,
  goals: z.string().trim().max(1000).default(""),
  targets: z.string().trim().max(1000).default(""),
  time: z.string().trim().max(1000).default(""),
});

// POST /onboarding/interpret - read the prose answers and suggest settings.
// Saves nothing; the person reviews and changes the suggestions first.
onboardingRouter.post("/interpret", interpretLimiter, async (req: AuthedRequest, res) => {
  const parsed = answersSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Keep each answer to 1,000 characters or fewer." });
  const { today, ...answers } = parsed.data;
  res.json(await interpretAnswers(answers, today));
});

const startSchema = z.object({
  today: todaySchema,
  about: z.string().trim().max(600).optional(),
  overallGoal: z.string().trim().max(600).optional(),
  sports: z
    .array(
      z.object({
        sport: sportSchema,
        priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
        goalNote: z.string().trim().max(300).optional(),
      }),
    )
    .max(7)
    .default([]),
  settings: z
    .object({
      trainingDaysPerWeek: z.number().int().min(2).max(6).optional(),
      runDaysPerWeek: z.number().int().min(2).max(6).optional(),
      golfPracticePerWeek: z.number().int().min(1).max(5).optional(),
      dailyStepGoal: z.number().int().min(1000).max(50000).nullable().optional(),
    })
    .default({}),
  horizon: z.union([z.object({ mode: z.literal("SUGGESTED") }), z.object({ mode: z.literal("DATE"), endDate: z.string() })]).default({ mode: "SUGGESTED" }),
});

// Types switched on for a sport. The golf simulator is a separate opt-in
// (it needs the bag set up), so it isn't added here.
function typesFor(sport: Sport): SessionType[] {
  return SPORT_SESSION_TYPES[sport].filter((t) => t !== "GOLF_SIMULATOR");
}

// POST /onboarding/start - save what the person confirmed and, if they chose
// any sports, open a plan running from today to the chosen horizon. The plan
// comes back in DRAFT; the app then asks for the AI's approach per sport.
onboardingRouter.post("/start", async (req: AuthedRequest, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Some of those choices aren't valid. Check the numbers and try again." });
  const { today, about, overallGoal, settings, horizon } = parsed.data;
  const userId = req.userId!;

  // De-duplicate in case a sport was sent twice.
  const sports = [...new Map(parsed.data.sports.map((s) => [s.sport, s])).values()];

  let endKey: string | null = null;
  if (sports.length > 0) {
    if (horizon.mode === "DATE") {
      const problem = checkCustomEnd(today, horizon.endDate);
      if (problem) return res.status(400).json({ error: problem });
      endKey = horizon.endDate;
    } else {
      endKey = suggestHorizon(today).endDate;
    }
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { visibleSessionTypes: true, onboardingCompletedAt: true } });
  const chosenTypes = sports.flatMap((s) => typesFor(s.sport));
  // First time through: show exactly what they chose. Later runs only add.
  const visible = sports.length === 0 ? user.visibleSessionTypes : user.onboardingCompletedAt === null ? [...new Set(chosenTypes)] : [...new Set([...user.visibleSessionTypes, ...chosenTypes])];
  const has = (s: Sport) => sports.some((x) => x.sport === s);

  const planId = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        visibleSessionTypes: visible,
        onboardingCompletedAt: new Date(),
        ...(about ? { ambitions: about, ambitionsUpdatedAt: new Date() } : {}),
        ...(settings.trainingDaysPerWeek !== undefined && has("STRENGTH") ? { trainingDaysPerWeek: settings.trainingDaysPerWeek } : {}),
        ...(settings.runDaysPerWeek !== undefined && has("RUN") ? { runDaysPerWeek: settings.runDaysPerWeek } : {}),
        ...(settings.dailyStepGoal !== undefined ? { dailyStepGoal: settings.dailyStepGoal } : {}),
      },
    });
    if (settings.golfPracticePerWeek !== undefined && has("GOLF")) {
      await tx.golfProfile.upsert({
        where: { userId },
        update: { practiceSessionsPerWeek: settings.golfPracticePerWeek },
        create: { userId, practiceSessionsPerWeek: settings.golfPracticePerWeek },
      });
    }
    // A sport's goal sentence is the same thing as its "ambition" in Progress.
    for (const s of sports) {
      if (s.goalNote) {
        await tx.sportAmbition.upsert({
          where: { userId_sport: { userId, sport: s.sport } },
          update: { statement: s.goalNote },
          create: { userId, sport: s.sport, statement: s.goalNote },
        });
      }
    }
    if (sports.length === 0 || !endKey) return null;
    await tx.trainingPlan.updateMany({ where: { userId, status: { not: "ARCHIVED" } }, data: { status: "ARCHIVED" } });
    const plan = await tx.trainingPlan.create({
      data: {
        userId,
        startDate: dayKeyToDate(today),
        endDate: dayKeyToDate(endKey),
        overallGoal: overallGoal || null,
        priorities: { create: sports.map((s) => ({ sport: s.sport, priority: s.priority, goalNote: s.goalNote || null })) },
      },
    });
    return plan.id;
  });

  res.status(201).json({ planId, endDate: endKey, weeks: endKey ? weeksBetween(today, endKey) : null });
});

// POST /onboarding/skip - leave the journey without saving anything.
onboardingRouter.post("/skip", async (req: AuthedRequest, res) => {
  await prisma.user.update({ where: { id: req.userId }, data: { onboardingCompletedAt: new Date() } });
  res.json({ ok: true });
});
