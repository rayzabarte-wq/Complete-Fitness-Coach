import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { AuthedRequest } from "../../lib/requireAuth.js";
import {
  generateSportApproaches,
  generateWeeklyFramework,
  parseScheduleConstraint,
  findConstraintConflicts,
  generatePlanAmendment,
  getCurrentVersion,
} from "../services/trainingPlanner.js";
import { buildDashboard } from "../services/dashboard.js";

export const planRouter = Router();

const sportSchema = z.enum(["STRENGTH", "GOLF", "RUN", "WALK", "CYCLING", "CYCLING_TURBO", "SWIM"]);
const priorityLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
const timeOfDaySchema = z.enum(["MORNING", "AFTERNOON", "EVENING"]);
const movementPatternSchema = z.enum(["PUSH", "PULL", "LEGS", "CORE"]);

// Loads a plan with everything the frontend needs, shaped so `slots` is
// always the CURRENT framework version's slots (flattened, for backward
// compatibility with a single weekly-template view) and `versions` is a
// lightweight history list (no nested slots — the dashboard endpoint is
// where those get used, not the plan-shape response). Used after every
// mutation so the frontend can just replace its local plan state wholesale.
async function loadFullPlan(planId: string) {
  const plan = await prisma.trainingPlan.findUnique({
    where: { id: planId },
    include: {
      priorities: true,
      approaches: true,
      constraints: true,
      versions: {
        orderBy: { effectiveFrom: "asc" },
        include: { slots: { orderBy: [{ dayOfWeek: "asc" }, { timeOfDay: "asc" }] } },
      },
    },
  });
  if (!plan) return null;

  const currentVersion = plan.versions.find((v) => v.effectiveTo === null) ?? null;
  const { versions, ...rest } = plan;
  return {
    ...rest,
    slots: currentVersion?.slots ?? [],
    versions: versions.map((v) => ({
      id: v.id,
      effectiveFrom: v.effectiveFrom,
      effectiveTo: v.effectiveTo,
      amendmentSummary: v.amendmentSummary,
      amendmentRequest: v.amendmentRequest,
    })),
  };
}

async function loadOwnedPlan(userId: string | undefined, planId: string) {
  return prisma.trainingPlan.findFirst({ where: { id: planId, userId } });
}

// POST /plan - start a new 3-month plan. Archives any existing non-archived
// plan for this user first, since only one plan is "current" at a time.
const createPlanSchema = z.object({
  overallGoal: z.string().optional(),
  priorities: z
    .array(z.object({ sport: sportSchema, priority: priorityLevelSchema, goalNote: z.string().optional() }))
    .min(1),
});

planRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createPlanSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { overallGoal, priorities } = parsed.data;

  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + 3);

  const plan = await prisma.$transaction(async (tx) => {
    await tx.trainingPlan.updateMany({
      where: { userId: req.userId!, status: { not: "ARCHIVED" } },
      data: { status: "ARCHIVED" },
    });
    return tx.trainingPlan.create({
      data: {
        userId: req.userId!,
        startDate,
        endDate,
        overallGoal,
        priorities: { create: priorities.map((p) => ({ sport: p.sport, priority: p.priority, goalNote: p.goalNote })) },
      },
    });
  });

  res.status(201).json(await loadFullPlan(plan.id));
});

// GET /plan/current - the signed-in user's most recent non-archived plan,
// with priorities, approaches, the current framework version's slots, a
// lightweight version history, and constraints. 404 if none started yet.
planRouter.get("/current", async (req: AuthedRequest, res) => {
  const plan = await prisma.trainingPlan.findFirst({
    where: { userId: req.userId, status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" },
  });
  if (!plan) {
    return res.status(404).json({ error: "No current training plan" });
  }
  res.json(await loadFullPlan(plan.id));
});

// PATCH /plan/:id/priorities - replace the priority list before generating
// (or regenerating) approaches. Only sensible while the plan is still DRAFT.
const updatePrioritiesSchema = z.object({
  overallGoal: z.string().optional(),
  priorities: z
    .array(z.object({ sport: sportSchema, priority: priorityLevelSchema, goalNote: z.string().optional() }))
    .min(1),
});

planRouter.patch("/:id/priorities", async (req: AuthedRequest, res) => {
  const plan = await loadOwnedPlan(req.userId, req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const parsed = updatePrioritiesSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  await prisma.$transaction([
    prisma.sportPriority.deleteMany({ where: { planId: plan.id } }),
    prisma.trainingPlan.update({
      where: { id: plan.id },
      data: {
        overallGoal: parsed.data.overallGoal,
        priorities: { create: parsed.data.priorities.map((p) => ({ sport: p.sport, priority: p.priority, goalNote: p.goalNote })) },
      },
    }),
  ]);

  res.json(await loadFullPlan(plan.id));
});

// POST /plan/:id/approaches/generate - AI-generate (or regenerate) a
// PROPOSED approach for each prioritized sport, replacing any prior ones.
planRouter.post("/:id/approaches/generate", async (req: AuthedRequest, res) => {
  const plan = await prisma.trainingPlan.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: { priorities: true },
  });
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  if (plan.priorities.length === 0) {
    return res.status(400).json({ error: "Set sport priorities before generating approaches" });
  }

  try {
    const generated = await generateSportApproaches(plan.overallGoal, plan.priorities);

    await prisma.$transaction([
      prisma.sportApproach.deleteMany({ where: { planId: plan.id } }),
      ...generated.map((a) =>
        prisma.sportApproach.create({
          data: { planId: plan.id, sport: a.sport, approachText: a.approachText, weeklySessionTarget: a.weeklySessionTarget },
        })
      ),
    ]);

    res.json(await loadFullPlan(plan.id));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to generate sport approaches" });
  }
});

// PATCH /plan/:id/approaches/:sport - approve an approach as-is, or edit its
// text/weekly target (an edit implicitly counts as approved, since the user
// has taken ownership of the wording/number at that point).
const updateApproachSchema = z.object({
  status: z.enum(["PROPOSED", "APPROVED"]).optional(),
  approachText: z.string().optional(),
  weeklySessionTarget: z.number().int().positive().optional(),
});

planRouter.patch("/:id/approaches/:sport", async (req: AuthedRequest, res) => {
  const plan = await loadOwnedPlan(req.userId, req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const sportParsed = sportSchema.safeParse(req.params.sport);
  if (!sportParsed.success) return res.status(400).json({ error: "Invalid sport" });

  const parsed = updateApproachSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.sportApproach.findFirst({ where: { planId: plan.id, sport: sportParsed.data } });
  if (!existing) return res.status(404).json({ error: "Approach not found for this sport" });

  const { status, approachText, weeklySessionTarget } = parsed.data;
  await prisma.sportApproach.update({
    where: { id: existing.id },
    data: {
      approachText,
      weeklySessionTarget,
      status: status ?? (approachText || weeklySessionTarget ? "APPROVED" : undefined),
    },
  });

  res.json(await loadFullPlan(plan.id));
});

// POST /plan/:id/framework/generate - AI-generate the recurring weekly
// framework. While the plan is still DRAFT/FRAMEWORK (not yet activated),
// this replaces the one-and-only version's slots in place — there's no
// progress yet worth preserving as history. Once the plan is ACTIVE, use
// POST /:id/amend instead, which properly versions the change.
planRouter.post("/:id/framework/generate", async (req: AuthedRequest, res) => {
  const plan = await prisma.trainingPlan.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: { approaches: true, constraints: true },
  });
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  if (plan.status === "ACTIVE") {
    return res.status(400).json({ error: "Plan is already active — use a plan amendment to change the framework for the remainder of the plan." });
  }
  if (plan.approaches.length === 0) {
    return res.status(400).json({ error: "Generate and approve sport approaches first" });
  }
  const unapproved = plan.approaches.filter((a) => a.status !== "APPROVED");
  if (unapproved.length > 0) {
    return res.status(400).json({ error: `Approve every sport's approach first (still pending: ${unapproved.map((a) => a.sport).join(", ")})` });
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId! } });

  try {
    const generated = await generateWeeklyFramework(
      plan.approaches.map((a) => ({ sport: a.sport, approachText: a.approachText, weeklySessionTarget: a.weeklySessionTarget })),
      user?.visibleSessionTypes ?? [],
      plan.constraints.map((c) => ({ rawText: c.rawText, daysOfWeek: c.daysOfWeek, blockedTimeOfDay: c.blockedTimeOfDay }))
    );

    const existingVersion = await getCurrentVersion(plan.id);

    await prisma.$transaction(async (tx) => {
      await tx.trainingPlan.update({ where: { id: plan.id }, data: { status: "FRAMEWORK" } });

      const versionId = existingVersion
        ? existingVersion.id
        : (await tx.frameworkVersion.create({ data: { planId: plan.id, effectiveFrom: plan.startDate } })).id;

      if (existingVersion) {
        await tx.frameworkSlot.deleteMany({ where: { versionId } });
      }

      await tx.frameworkSlot.createMany({
        data: generated.map((s) => ({
          versionId,
          dayOfWeek: s.dayOfWeek,
          timeOfDay: s.timeOfDay,
          sport: s.sport,
          sessionType: s.sessionType ?? null,
          movementPattern: s.movementPattern ?? null,
          label: s.label ?? null,
          notes: s.notes ?? null,
        })),
      });
    });

    res.json(await loadFullPlan(plan.id));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to generate the weekly framework" });
  }
});

// PATCH /plan/:id/framework/:slotId - manually move or edit one slot in the
// current framework version.
const updateSlotSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  timeOfDay: timeOfDaySchema.optional(),
  movementPattern: movementPatternSchema.optional(),
  label: z.string().optional(),
});

planRouter.patch("/:id/framework/:slotId", async (req: AuthedRequest, res) => {
  const plan = await loadOwnedPlan(req.userId, req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const parsed = updateSlotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const currentVersion = await getCurrentVersion(plan.id);
  const slot = currentVersion?.slots.find((s) => s.id === req.params.slotId);
  if (!slot) return res.status(404).json({ error: "Slot not found" });

  await prisma.frameworkSlot.update({ where: { id: slot.id }, data: parsed.data });
  res.json(await loadFullPlan(plan.id));
});

// POST /plan/:id/activate - mark the framework approved and the plan live.
planRouter.post("/:id/activate", async (req: AuthedRequest, res) => {
  const plan = await loadOwnedPlan(req.userId, req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const currentVersion = await getCurrentVersion(plan.id);
  if (!currentVersion || currentVersion.slots.length === 0) {
    return res.status(400).json({ error: "Generate a weekly framework before activating the plan" });
  }

  await prisma.trainingPlan.update({ where: { id: plan.id }, data: { status: "ACTIVE" } });
  res.json(await loadFullPlan(plan.id));
});

// POST /plan/:id/amend - apply a free-text amendment request to an ACTIVE
// plan's framework (and, where relevant, the affected sports' approaches),
// for the remainder of the 3 months. Closes the current framework version
// and opens a new one, so the dashboard can show progress against the plan
// as it stood before this change as well as the plan as it now stands.
const amendPlanSchema = z.object({ requestText: z.string().min(1) });

planRouter.post("/:id/amend", async (req: AuthedRequest, res) => {
  const plan = await prisma.trainingPlan.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: { approaches: true, constraints: true },
  });
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  if (plan.status !== "ACTIVE") {
    return res.status(400).json({ error: "Only an active plan can be amended — activate your framework first." });
  }

  const parsed = amendPlanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const currentVersion = await getCurrentVersion(plan.id);
  if (!currentVersion) {
    return res.status(400).json({ error: "No active framework version found for this plan" });
  }

  try {
    const amendment = await generatePlanAmendment({
      overallGoal: plan.overallGoal,
      approaches: plan.approaches.map((a) => ({ sport: a.sport, approachText: a.approachText, weeklySessionTarget: a.weeklySessionTarget })),
      currentSlots: currentVersion.slots.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        timeOfDay: s.timeOfDay,
        sport: s.sport,
        sessionType: s.sessionType,
        movementPattern: s.movementPattern,
        label: s.label,
      })),
      constraints: plan.constraints.map((c) => ({ rawText: c.rawText, daysOfWeek: c.daysOfWeek, blockedTimeOfDay: c.blockedTimeOfDay })),
      requestText: parsed.data.requestText,
    });

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.frameworkVersion.update({ where: { id: currentVersion.id }, data: { effectiveTo: now } });

      for (const update of amendment.approachUpdates) {
        const existing = plan.approaches.find((a) => a.sport === update.sport);
        if (!existing) continue;
        await tx.sportApproach.update({
          where: { id: existing.id },
          data: { approachText: update.approachText, weeklySessionTarget: update.weeklySessionTarget },
        });
      }

      const newVersion = await tx.frameworkVersion.create({
        data: {
          planId: plan.id,
          effectiveFrom: now,
          amendmentSummary: amendment.changeSummary,
          amendmentRequest: parsed.data.requestText,
        },
      });

      await tx.frameworkSlot.createMany({
        data: amendment.slots.map((s) => ({
          versionId: newVersion.id,
          dayOfWeek: s.dayOfWeek,
          timeOfDay: s.timeOfDay,
          sport: s.sport,
          sessionType: s.sessionType ?? null,
          movementPattern: s.movementPattern ?? null,
          label: s.label ?? null,
          notes: s.notes ?? null,
        })),
      });
    });

    res.json(await loadFullPlan(plan.id));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to apply that amendment" });
  }
});

// GET /plan/:id/dashboard?today=YYYY-MM-DD - completion-rate dashboard for
// the current week (Sunday start) and the last 30 days (or since the plan
// started, if sooner). `today` should be the caller's own local date (the
// app already avoids UTC-parsing pitfalls elsewhere — see
// frontend/src/lib/location.ts's parseLocalDate/formatLocalDateKey), so
// periods line up with the person's actual calendar days rather than the
// server's. Falls back to the server's date if omitted.
planRouter.get("/:id/dashboard", async (req: AuthedRequest, res) => {
  const plan = await loadOwnedPlan(req.userId, req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  if (plan.status !== "ACTIVE" && plan.status !== "FRAMEWORK") {
    return res.status(400).json({ error: "Set up sport priorities and a weekly framework before viewing the dashboard" });
  }

  const todayParam = typeof req.query.today === "string" ? req.query.today : undefined;
  const today = todayParam && /^\d{4}-\d{2}-\d{2}$/.test(todayParam) ? new Date(`${todayParam}T00:00:00`) : new Date();

  const versions = await prisma.frameworkVersion.findMany({
    where: { planId: plan.id },
    orderBy: { effectiveFrom: "asc" },
    include: { slots: true },
  });

  if (versions.length === 0) {
    return res.status(400).json({ error: "No weekly framework yet — generate one before viewing the dashboard" });
  }

  const dashboard = await buildDashboard(req.userId!, plan, versions, today);
  res.json(dashboard);
});

// POST /plan/:id/constraints - add a free-text scheduling limitation. Parses
// it via AI into structured days/times, then returns any conflicts it
// creates against the current framework along with move options for each.
const createConstraintSchema = z.object({ rawText: z.string().min(1) });

planRouter.post("/:id/constraints", async (req: AuthedRequest, res) => {
  const plan = await loadOwnedPlan(req.userId, req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const parsed = createConstraintSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const structured = await parseScheduleConstraint(parsed.data.rawText);
    const constraint = await prisma.scheduleConstraint.create({
      data: {
        planId: plan.id,
        rawText: parsed.data.rawText,
        daysOfWeek: structured.daysOfWeek,
        blockedTimeOfDay: structured.blockedTimeOfDay,
        parseExplanation: structured.parseExplanation,
      },
    });

    const conflicts = await findConstraintConflicts(plan.id, constraint.id);
    res.status(201).json({ constraint, conflicts });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to parse and apply the constraint" });
  }
});

// GET /plan/:id/constraints/:constraintId/conflicts - recompute conflicts
// (e.g. after the framework changed since the constraint was added).
planRouter.get("/:id/constraints/:constraintId/conflicts", async (req: AuthedRequest, res) => {
  const plan = await loadOwnedPlan(req.userId, req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  try {
    const conflicts = await findConstraintConflicts(plan.id, req.params.constraintId);
    res.json({ conflicts });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to compute conflicts" });
  }
});

// POST /plan/:id/constraints/:constraintId/apply - move one conflicting slot
// (in the current framework version) to a chosen alternative day/time-of-day.
const applyMoveSchema = z.object({
  slotId: z.string(),
  dayOfWeek: z.number().int().min(0).max(6),
  timeOfDay: timeOfDaySchema,
});

planRouter.post("/:id/constraints/:constraintId/apply", async (req: AuthedRequest, res) => {
  const plan = await loadOwnedPlan(req.userId, req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const parsed = applyMoveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const currentVersion = await getCurrentVersion(plan.id);
  const slot = currentVersion?.slots.find((s) => s.id === parsed.data.slotId);
  if (!slot) return res.status(404).json({ error: "Slot not found" });

  await prisma.frameworkSlot.update({
    where: { id: slot.id },
    data: { dayOfWeek: parsed.data.dayOfWeek, timeOfDay: parsed.data.timeOfDay },
  });

  res.json(await loadFullPlan(plan.id));
});

// DELETE /plan/:id/constraints/:constraintId - remove a constraint. Leaves
// any already-moved slots where they are; it just stops enforcing that limit
// going forward (e.g. on the next framework regeneration or amendment).
planRouter.delete("/:id/constraints/:constraintId", async (req: AuthedRequest, res) => {
  const plan = await loadOwnedPlan(req.userId, req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const constraint = await prisma.scheduleConstraint.findFirst({ where: { id: req.params.constraintId, planId: plan.id } });
  if (!constraint) return res.status(404).json({ error: "Constraint not found" });

  await prisma.scheduleConstraint.delete({ where: { id: constraint.id } });
  res.json(await loadFullPlan(plan.id));
});
