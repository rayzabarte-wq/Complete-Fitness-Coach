import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../../lib/prisma.js";
import { EQUIPMENT_CONFIG, Equipment } from "../lib/equipmentConfig.js";
import { Focus, FOCUS_LABELS, focusMuscles, MUSCLE_LABELS } from "../lib/training.js";
import { pickSessionExercises, BlockInfo } from "./exerciseSelection.js";
import { getRecovery } from "./recovery.js";
import { paceStatus, goalDirection, METRIC_LABELS, BodyMetric } from "../../services/goals.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type MovementPattern = Focus;

interface PlannedExercise {
  exerciseId: string;
  name: string;
  equipment: Equipment;
  suggestedWeightLb: number;
  bandLevel: string | null;
  suggestedReps: number;
  suggestedSets: number;
  restSeconds: number;
  reasoning: string;
  /** Why this exercise is in today's session (block / variation logic). */
  selectionNote: string;
  isCoreFinisher: boolean;
}

export interface WorkoutPlan {
  movementPattern: MovementPattern;
  exercises: PlannedExercise[];
  estimatedMinutes: number;
  block: BlockInfo;
  /** Muscles this session targets that haven't fully recovered yet. */
  recoveringMuscles: string[];
}

function equipmentGuidance(equipment: Equipment): string {
  const config = EQUIPMENT_CONFIG[equipment];
  if (config.kind === "weighted") {
    return `${config.label}, loadable from ${config.minLb}lb to ${config.maxLb}lb in ${config.stepLb}lb increments — suggestedWeightLb MUST be one of these exact values.`;
  }
  if (config.kind === "bodyweight") {
    return `${config.label}. Base movement is bodyweight (suggestedWeightLb: 0); optional added weight from ${config.addedWeightMinLb}lb to ${config.addedWeightMaxLb}lb in ${config.addedWeightStepLb}lb increments if progression calls for it.`;
  }
  return `${config.label}, tension levels: ${config.levels.join(", ")}. Set suggestedWeightLb to 0 and put the recommended level in bandLevel.`;
}

/** Short lines of context about the person for the coaching prompt — age
 * (if their profile has it) and any active body goal with its pace — so
 * rep ranges/volume lean the right way for what they're working toward. */
async function personContext(userId: string): Promise<{ who: string; goals: string }> {
  const [user, goals, rows] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { birthYear: true } }),
    prisma.bodyGoal.findMany({ where: { userId, status: "ACTIVE" }, include: { targets: { orderBy: { createdAt: "asc" } } } }),
    prisma.bodyMeasurement.findMany({ where: { userId }, orderBy: { measuredAt: "asc" } }),
  ]);
  const age = user.birthYear ? new Date().getFullYear() - user.birthYear : null;
  const who = age ? `a ${age}-year-old lifter` : "a lifter";
  const field = { BODY_FAT_PCT: "bodyFatPct", MUSCLE_MASS_KG: "muscleMassKg", BODY_WEIGHT_KG: "weightKg" } as const;
  const goalLines = goals.map((g) => {
    const metric = g.metric as BodyMetric;
    const current = g.targets[g.targets.length - 1];
    const readings = rows
      .filter((r) => r[field[metric]] != null && r.measuredAt >= g.startDate)
      .map((r) => ({ date: r.measuredAt, value: r[field[metric]] as number }));
    const pace = paceStatus(metric, goalDirection(g.startValue, { ...g.targets[0], reason: null }), { ...current, reason: null }, readings);
    return `${METRIC_LABELS[metric]} goal: ${current.targetValue} by ${current.targetDate.toISOString().slice(0, 10)} (${pace.label.toLowerCase()})`;
  });
  return { who, goals: goalLines.length ? goalLines.join("; ") : "" };
}

export async function generateWorkoutPlan(userId: string, pattern: MovementPattern): Promise<WorkoutPlan> {
  // Which exercises: the current training block for this focus (see
  // exerciseSelection.ts — stable within a block, rotated between blocks
  // for coverage, swapped mid-block only on a stall) plus a core finisher.
  const { picks, block } = await pickSessionExercises(userId, pattern);
  if (picks.length === 0) {
    throw new Error(`No exercises found for ${FOCUS_LABELS[pattern]} — run the seed script to load the exercise catalog.`);
  }
  const rows = await prisma.exercise.findMany({ where: { id: { in: picks.map((p) => p.exercise.id) } } });
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const exercises = picks
    .filter((p) => rowById.has(p.exercise.id))
    .map((p) => ({ exercise: rowById.get(p.exercise.id)!, note: p.note, isCoreFinisher: p.isCoreFinisher }));
  const coreFinisher = exercises.filter((p) => p.isCoreFinisher);

  const [recovery, person] = await Promise.all([getRecovery(userId), personContext(userId)]);
  const targeted = new Set(focusMuscles(pattern));
  const recovering = recovery.filter((r) => r.status === "RECOVERING" && targeted.has(r.muscle));
  const recoveryNote = recovering.length
    ? `\n\nRecovery: ${recovering.map((r) => `${MUSCLE_LABELS[r.muscle]} is about ${r.percentRecovered}% recovered`).join(", ")}. Go a little lighter on exercises that load those muscles (hold the weight rather than adding, or drop a set).`
    : "";
  const goalNote = person.goals ? `\n\nTheir current body goals: ${person.goals}.` : "";

  const exerciseBlocks = await Promise.all(
    exercises.map(async ({ exercise }) => {
      const recentSets = await prisma.setEntry.findMany({
        where: { exerciseId: exercise.id, session: { userId } },
        orderBy: { createdAt: "desc" },
        take: 4,
        include: { session: true },
      });

      const historyText =
        recentSets.length === 0
          ? "No prior logged sets — first time doing this exercise."
          : recentSets
              .map((s) => {
                const load = s.bandLevel ? `${s.bandLevel} band` : `${s.weightLb}lb`;
                return `${s.session.date.toISOString().slice(0, 10)}: ${load} x ${s.reps} reps (target was ${s.targetReps})${s.rpe ? `, RPE ${s.rpe}` : ""}`;
              })
              .join("; ");

      const daysSinceLastSession =
        recentSets.length > 0
          ? Math.round((Date.now() - recentSets[0].session.date.getTime()) / (1000 * 60 * 60 * 24))
          : null;

      return `- exerciseId: "${exercise.id}"
  name: ${exercise.name} (${exercise.category}, ${exercise.repRangeStyle} rep style)
  equipment: ${equipmentGuidance(exercise.equipment as Equipment)}
  days since last trained: ${daysSinceLastSession ?? "unknown"}
  recent history: ${historyText}`;
    })
  );

  const coreFinisherNote =
    coreFinisher.length > 0
      ? `\n\nThe last ${coreFinisher.length} exercises listed are a core finisher done at the end of the session — these typically use shorter rest (30-60s).`
      : "";

  const prompt = `You are a strength training coach building a complete ${FOCUS_LABELS[pattern]} day workout for ${person.who} training for strength, muscle tone, and definition. Factor in general recovery needs for their age when setting progression and rest.${goalNote}${recoveryNote}

Build a full session using these exercises, in this order. The exercise selection is already decided — don't suggest swaps:

${exerciseBlocks.join("\n\n")}${coreFinisherNote}

For each exercise recommend weight (or band level), reps, sets, and a rest interval in seconds between sets. Guidance:
- Compound/strength-style exercises: typically longer rest (90-180s) to support heavier loads
- Accessory/hypertrophy-style exercises: typically shorter rest (45-90s)
- Core finisher exercises (if present): typically 30-60s rest
- Apply standard progressive overload logic per exercise based on its own history (increase if targets consistently hit, hold or deload if reps were missed or stalling)
- Every suggested weight must be an exact loadable value for that exercise's equipment as described

Respond with ONLY a JSON array, no other text, one object per exercise in the same order given, in this exact shape:
[{"exerciseId": string, "suggestedWeightLb": number, "bandLevel": string | null, "suggestedReps": number, "suggestedSets": number, "restSeconds": number, "reasoning": "one short sentence"}]`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  // Claude is asked for JSON-only, but strip fences and grab the array
  // itself as a safety net in case any stray text sneaks in around it.
  const rawText = textBlock.text.replace(/```json|```/g, "").trim();
  const arrayMatch = rawText.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    throw new Error(`Claude's response wasn't valid JSON: ${rawText.slice(0, 300)}`);
  }

  let parsedList: Array<{
    exerciseId: string;
    suggestedWeightLb: number;
    bandLevel: string | null;
    suggestedReps: number;
    suggestedSets: number;
    restSeconds: number;
    reasoning: string;
  }>;
  try {
    parsedList = JSON.parse(arrayMatch[0]);
  } catch (err) {
    throw new Error(`Failed to parse Claude's response as JSON: ${(err as Error).message}`);
  }

  const exerciseById = new Map(exercises.map((e) => [e.exercise.id, e]));
  const planned: PlannedExercise[] = [];

  for (const item of parsedList) {
    const pick = exerciseById.get(item.exerciseId);
    if (!pick) continue; // skip anything Claude hallucinated an id for
    const exercise = pick.exercise;

    const weightLb = clampToLoadable(exercise.equipment as Equipment, item.suggestedWeightLb);

    await prisma.recommendation.create({
      data: {
        userId,
        exerciseId: exercise.id,
        suggestedWeightLb: weightLb,
        suggestedReps: item.suggestedReps,
        suggestedSets: item.suggestedSets,
        restSeconds: item.restSeconds,
        reasoning: item.reasoning,
      },
    });

    planned.push({
      exerciseId: exercise.id,
      name: exercise.name,
      equipment: exercise.equipment as Equipment,
      suggestedWeightLb: weightLb,
      bandLevel: item.bandLevel,
      suggestedReps: item.suggestedReps,
      suggestedSets: item.suggestedSets,
      restSeconds: item.restSeconds,
      reasoning: item.reasoning,
      selectionNote: pick.note,
      isCoreFinisher: pick.isCoreFinisher,
    });
  }

  // Rough session length: rest time between sets, plus ~40s of actual work
  // per set. Doesn't count warm-up sets or transition time between exercises.
  const estimatedSeconds = planned.reduce(
    (sum, ex) => sum + ex.suggestedSets * (ex.restSeconds + 40),
    0
  );

  return {
    movementPattern: pattern,
    exercises: planned,
    estimatedMinutes: Math.round(estimatedSeconds / 60),
    block,
    recoveringMuscles: recovering.map((r) => MUSCLE_LABELS[r.muscle]),
  };
}

function clampToLoadable(equipment: Equipment, weightLb: number): number {
  const config = EQUIPMENT_CONFIG[equipment];
  if (config.kind === "band") return 0;
  if (config.kind === "bodyweight") {
    if (weightLb <= 0) return 0;
    const steps = Math.round((weightLb - config.addedWeightMinLb) / config.addedWeightStepLb);
    const clamped = config.addedWeightMinLb + steps * config.addedWeightStepLb;
    return Math.min(Math.max(clamped, config.addedWeightMinLb), config.addedWeightMaxLb);
  }
  const steps = Math.round((weightLb - config.minLb) / config.stepLb);
  const clamped = config.minLb + steps * config.stepLb;
  return Math.min(Math.max(clamped, config.minLb), config.maxLb);
}
