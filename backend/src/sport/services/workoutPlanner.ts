import { prisma } from "../../lib/prisma.js";
import { askClaude } from "../../lib/claude.js";
import { Equipment, ResolvedEquipment, clampToLoadable, describeWeights } from "../lib/equipmentConfig.js";
import { getGym } from "./gyms.js";
import { Focus, FOCUS_LABELS, focusMuscles, MUSCLE_LABELS } from "../lib/training.js";
import { pickSessionExercises, BlockInfo } from "./exerciseSelection.js";
import { getRecovery } from "./recovery.js";
import { paceStatus, goalDirection, METRIC_LABELS, BodyMetric } from "../../services/goals.js";

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
  /** The gym profile this workout was built for. */
  gymId: string;
  gymName: string;
  /** Muscles this session targets that haven't fully recovered yet. */
  recoveringMuscles: string[];
}

function equipmentGuidance(config: ResolvedEquipment): string {
  if (config.kind === "weighted") {
    return `${config.label}, this person can load: ${describeWeights(config.weightsLb)} — suggestedWeightLb MUST be one of these exact values.`;
  }
  if (config.kind === "bodyweight") {
    const added = config.weightsLb.filter((w) => w > 0);
    return `${config.label}. Base movement is bodyweight (suggestedWeightLb: 0); ${
      added.length > 0
        ? `optional added weight, one of: ${describeWeights(added)}, if progression calls for it.`
        : "this person doesn't add weight to bodyweight movements, so always use 0."
    }`;
  }
  return `${config.label}, tension levels available: ${config.bandLevels.join(", ")}. Set suggestedWeightLb to 0 and put the recommended level in bandLevel.`;
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

export async function generateWorkoutPlan(userId: string, pattern: MovementPattern, gymId?: string): Promise<WorkoutPlan> {
  // Which exercises: the current training block for this focus (see
  // exerciseSelection.ts — stable within a block, rotated between blocks
  // for coverage, swapped mid-block only on a stall) plus a core finisher.
  // Only exercises doable at the chosen gym (Home / Regular / Visiting) are
  // candidates (see exerciseSelection.ts), and every weight is checked
  // against that gym's loadable values rather than a fixed set of gear.
  const gym = await getGym(userId, gymId);
  const equipmentConfig = gym.equipment;
  const { picks, block } = await pickSessionExercises(userId, pattern, gym);
  if (picks.length === 0) {
    throw new Error(
      `No ${FOCUS_LABELS[pattern]} exercises match what ${gym.name} has. Tick more equipment for it under Settings > Gyms (or run the seed script if the exercise catalog is empty).`
    );
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
  equipment: ${equipmentGuidance(equipmentConfig[exercise.equipment as Equipment])}
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

  const answer = await askClaude(prompt);

  // Claude is asked for JSON-only, but strip fences and grab the array
  // itself as a safety net in case any stray text sneaks in around it.
  const rawText = answer.replace(/```json|```/g, "").trim();
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

    const exerciseEquipment = equipmentConfig[exercise.equipment as Equipment];
    const weightLb = clampToLoadable(exerciseEquipment, item.suggestedWeightLb);
    // If Claude names a band level this person doesn't own, fall back to
    // the first one they do rather than suggesting something unusable.
    const bandLevel =
      exerciseEquipment.kind === "band"
        ? item.bandLevel && exerciseEquipment.bandLevels.includes(item.bandLevel)
          ? item.bandLevel
          : exerciseEquipment.bandLevels[0]
        : null;

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
      bandLevel,
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
    gymId: gym.id,
    gymName: gym.name,
    recoveringMuscles: recovering.map((r) => MUSCLE_LABELS[r.muscle]),
  };
}
