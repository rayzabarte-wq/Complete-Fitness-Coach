import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../../lib/prisma.js";
import { EQUIPMENT_CONFIG, Equipment } from "../lib/equipmentConfig.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type MovementPattern = "PUSH" | "PULL" | "LEGS" | "CORE";

// Caps how many primary (Push/Pull/Legs) exercises go into one session,
// leaving room for the 2 core exercises every non-Core session ends with.
const MAX_PRIMARY_EXERCISES = 4;
const MAX_CORE_ONLY_EXERCISES = 5; // when the pattern itself IS Core
const CORE_FINISHER_COUNT = 2;

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
}

export interface WorkoutPlan {
  movementPattern: MovementPattern;
  exercises: PlannedExercise[];
  estimatedMinutes: number;
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

async function selectExercisesForPattern(pattern: MovementPattern) {
  const all = await prisma.exercise.findMany({
    where: { movementPattern: pattern },
    orderBy: [{ category: "asc" }, { name: "asc" }], // COMPOUND before ACCESSORY
  });
  const limit = pattern === "CORE" ? MAX_CORE_ONLY_EXERCISES : MAX_PRIMARY_EXERCISES;
  return all.slice(0, limit);
}

/** Picks a random, non-repeating set of core exercises to finish a
 * Push/Pull/Legs session with, so core work rotates across sessions rather
 * than always being the same 2 movements. */
async function selectCoreFinisher(excludeIds: string[]) {
  const coreExercises = await prisma.exercise.findMany({
    where: { movementPattern: "CORE", id: { notIn: excludeIds } },
  });
  const shuffled = [...coreExercises].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, CORE_FINISHER_COUNT);
}

export async function generateWorkoutPlan(userId: string, pattern: MovementPattern): Promise<WorkoutPlan> {
  const primaryExercises = await selectExercisesForPattern(pattern);
  if (primaryExercises.length === 0) {
    throw new Error(`No exercises found for movement pattern ${pattern}`);
  }

  // Every Push/Pull/Legs session finishes with 2 core exercises. A Core
  // session is already all core, so nothing extra is appended.
  const coreFinisher =
    pattern === "CORE" ? [] : await selectCoreFinisher(primaryExercises.map((e) => e.id));

  const exercises = [...primaryExercises, ...coreFinisher];

  const exerciseBlocks = await Promise.all(
    exercises.map(async (exercise) => {
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

  const prompt = `You are a strength training coach building a complete ${pattern} day workout for a 54-year-old lifter training for strength, muscle tone, and definition. Factor in general recovery needs for someone at that age when setting progression and rest.

Build a full session using these exercises, in this order (compound movements first):

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

  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const planned: PlannedExercise[] = [];

  for (const item of parsedList) {
    const exercise = exerciseById.get(item.exerciseId);
    if (!exercise) continue; // skip anything Claude hallucinated an id for

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
