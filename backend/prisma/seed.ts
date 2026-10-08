import { PrismaClient, Muscle } from "@prisma/client";

const prisma = new PrismaClient();

// Every exercise here is doable with: adjustable dumbbells (5-45lb),
// barbell (20-80lb), EZ bar (20-80lb), a bench, elastic bands, a chin-up
// bar, and rings suspended from the chin-up bar. No squat rack or machines.
//
// movementPattern groups them into Push / Pull / Legs / Core sessions.
// primaryMuscle / secondaryMuscles drive the per-muscle recovery clocks.
// variationTag names the region or angle of the muscle the movement
// emphasises — the variation engine tallies these so that, across training
// blocks, every part of a muscle gets worked (flat AND incline pressing,
// overhead AND lying triceps work, squats AND single-leg work, ...).
// Rear-delt / face-pull work is tagged to BACK (upper back) with shoulders
// as secondary: it's a pulling movement for the upper back and rear delts,
// and tagging it to SHOULDERS would wrongly hold back the next Push day.
type Seed = {
  name: string;
  category: "COMPOUND" | "ACCESSORY";
  muscleGroup: string;
  repRangeStyle: "STRENGTH" | "HYPERTROPHY";
  equipment: "DUMBBELL" | "BARBELL" | "EZ_BAR" | "BAND" | "BODYWEIGHT";
  movementPattern: "PUSH" | "PULL" | "LEGS" | "CORE";
  defaultSets: number;
  primaryMuscle: Muscle;
  secondaryMuscles: Muscle[];
  variationTag: string;
};

const exercises: Seed[] = [
  // --- Push ---
  { name: "Barbell Bench Press", category: "COMPOUND", muscleGroup: "Chest", repRangeStyle: "STRENGTH", equipment: "BARBELL", movementPattern: "PUSH", defaultSets: 4, primaryMuscle: "CHEST", secondaryMuscles: ["SHOULDERS", "TRICEPS"], variationTag: "CHEST_FLAT_PRESS" },
  { name: "Dumbbell Bench Press", category: "COMPOUND", muscleGroup: "Chest", repRangeStyle: "STRENGTH", equipment: "DUMBBELL", movementPattern: "PUSH", defaultSets: 4, primaryMuscle: "CHEST", secondaryMuscles: ["SHOULDERS", "TRICEPS"], variationTag: "CHEST_FLAT_PRESS" },
  { name: "Dumbbell Incline Press", category: "ACCESSORY", muscleGroup: "Chest", repRangeStyle: "HYPERTROPHY", equipment: "DUMBBELL", movementPattern: "PUSH", defaultSets: 3, primaryMuscle: "CHEST", secondaryMuscles: ["SHOULDERS", "TRICEPS"], variationTag: "CHEST_INCLINE_PRESS" },
  { name: "Dumbbell Fly", category: "ACCESSORY", muscleGroup: "Chest", repRangeStyle: "HYPERTROPHY", equipment: "DUMBBELL", movementPattern: "PUSH", defaultSets: 3, primaryMuscle: "CHEST", secondaryMuscles: ["SHOULDERS"], variationTag: "CHEST_FLY" },
  { name: "Ring Push-Up", category: "ACCESSORY", muscleGroup: "Chest", repRangeStyle: "HYPERTROPHY", equipment: "BODYWEIGHT", movementPattern: "PUSH", defaultSets: 3, primaryMuscle: "CHEST", secondaryMuscles: ["TRICEPS", "SHOULDERS", "CORE"], variationTag: "CHEST_FLAT_PRESS" },
  { name: "Ring Dip", category: "ACCESSORY", muscleGroup: "Chest/Triceps", repRangeStyle: "HYPERTROPHY", equipment: "BODYWEIGHT", movementPattern: "PUSH", defaultSets: 3, primaryMuscle: "CHEST", secondaryMuscles: ["TRICEPS", "SHOULDERS"], variationTag: "CHEST_DIP" },
  { name: "Dumbbell Shoulder Press", category: "COMPOUND", muscleGroup: "Shoulders", repRangeStyle: "STRENGTH", equipment: "DUMBBELL", movementPattern: "PUSH", defaultSets: 4, primaryMuscle: "SHOULDERS", secondaryMuscles: ["TRICEPS"], variationTag: "SHOULDER_VERTICAL_PRESS" },
  { name: "Barbell Overhead Press", category: "COMPOUND", muscleGroup: "Shoulders", repRangeStyle: "STRENGTH", equipment: "BARBELL", movementPattern: "PUSH", defaultSets: 4, primaryMuscle: "SHOULDERS", secondaryMuscles: ["TRICEPS", "CORE"], variationTag: "SHOULDER_VERTICAL_PRESS" },
  { name: "Dumbbell Lateral Raise", category: "ACCESSORY", muscleGroup: "Shoulders", repRangeStyle: "HYPERTROPHY", equipment: "DUMBBELL", movementPattern: "PUSH", defaultSets: 3, primaryMuscle: "SHOULDERS", secondaryMuscles: [], variationTag: "SHOULDER_LATERAL" },
  { name: "EZ Bar Skull Crusher", category: "ACCESSORY", muscleGroup: "Triceps", repRangeStyle: "HYPERTROPHY", equipment: "EZ_BAR", movementPattern: "PUSH", defaultSets: 3, primaryMuscle: "TRICEPS", secondaryMuscles: [], variationTag: "TRICEPS_LYING_EXTENSION" },
  { name: "Dumbbell Overhead Triceps Extension", category: "ACCESSORY", muscleGroup: "Triceps", repRangeStyle: "HYPERTROPHY", equipment: "DUMBBELL", movementPattern: "PUSH", defaultSets: 3, primaryMuscle: "TRICEPS", secondaryMuscles: [], variationTag: "TRICEPS_OVERHEAD" },
  { name: "Band Triceps Pushdown", category: "ACCESSORY", muscleGroup: "Triceps", repRangeStyle: "HYPERTROPHY", equipment: "BAND", movementPattern: "PUSH", defaultSets: 3, primaryMuscle: "TRICEPS", secondaryMuscles: [], variationTag: "TRICEPS_PUSHDOWN" },
  { name: "EZ Bar Close-Grip Bench Press", category: "COMPOUND", muscleGroup: "Triceps", repRangeStyle: "STRENGTH", equipment: "EZ_BAR", movementPattern: "PUSH", defaultSets: 3, primaryMuscle: "TRICEPS", secondaryMuscles: ["CHEST", "SHOULDERS"], variationTag: "TRICEPS_CLOSE_GRIP_PRESS" },

  // --- Pull ---
  { name: "Barbell Bent-Over Row", category: "COMPOUND", muscleGroup: "Back", repRangeStyle: "STRENGTH", equipment: "BARBELL", movementPattern: "PULL", defaultSets: 4, primaryMuscle: "BACK", secondaryMuscles: ["BICEPS", "SHOULDERS"], variationTag: "BACK_HORIZONTAL_PULL" },
  { name: "One-Arm Dumbbell Row", category: "COMPOUND", muscleGroup: "Back", repRangeStyle: "STRENGTH", equipment: "DUMBBELL", movementPattern: "PULL", defaultSets: 4, primaryMuscle: "BACK", secondaryMuscles: ["BICEPS"], variationTag: "BACK_HORIZONTAL_PULL" },
  { name: "Weighted Pull-Up", category: "COMPOUND", muscleGroup: "Back", repRangeStyle: "STRENGTH", equipment: "BODYWEIGHT", movementPattern: "PULL", defaultSets: 4, primaryMuscle: "BACK", secondaryMuscles: ["BICEPS"], variationTag: "BACK_VERTICAL_PULL" },
  { name: "Chin-Up", category: "COMPOUND", muscleGroup: "Back", repRangeStyle: "STRENGTH", equipment: "BODYWEIGHT", movementPattern: "PULL", defaultSets: 4, primaryMuscle: "BACK", secondaryMuscles: ["BICEPS"], variationTag: "BACK_VERTICAL_PULL" },
  { name: "Ring Row", category: "ACCESSORY", muscleGroup: "Back", repRangeStyle: "HYPERTROPHY", equipment: "BODYWEIGHT", movementPattern: "PULL", defaultSets: 3, primaryMuscle: "BACK", secondaryMuscles: ["BICEPS", "SHOULDERS"], variationTag: "BACK_HORIZONTAL_PULL" },
  { name: "Dumbbell Pullover", category: "ACCESSORY", muscleGroup: "Back", repRangeStyle: "HYPERTROPHY", equipment: "DUMBBELL", movementPattern: "PULL", defaultSets: 3, primaryMuscle: "BACK", secondaryMuscles: ["CHEST"], variationTag: "BACK_PULLOVER" },
  { name: "EZ Bar Curl", category: "ACCESSORY", muscleGroup: "Biceps", repRangeStyle: "HYPERTROPHY", equipment: "EZ_BAR", movementPattern: "PULL", defaultSets: 3, primaryMuscle: "BICEPS", secondaryMuscles: [], variationTag: "BICEPS_CURL" },
  { name: "Dumbbell Hammer Curl", category: "ACCESSORY", muscleGroup: "Biceps", repRangeStyle: "HYPERTROPHY", equipment: "DUMBBELL", movementPattern: "PULL", defaultSets: 3, primaryMuscle: "BICEPS", secondaryMuscles: [], variationTag: "BICEPS_HAMMER" },
  { name: "Incline Dumbbell Curl", category: "ACCESSORY", muscleGroup: "Biceps", repRangeStyle: "HYPERTROPHY", equipment: "DUMBBELL", movementPattern: "PULL", defaultSets: 3, primaryMuscle: "BICEPS", secondaryMuscles: [], variationTag: "BICEPS_STRETCHED" },
  { name: "Band Face Pull", category: "ACCESSORY", muscleGroup: "Rear Delts/Upper Back", repRangeStyle: "HYPERTROPHY", equipment: "BAND", movementPattern: "PULL", defaultSets: 3, primaryMuscle: "BACK", secondaryMuscles: ["SHOULDERS"], variationTag: "BACK_UPPER_REAR_DELT" },
  { name: "Band Pull-Apart", category: "ACCESSORY", muscleGroup: "Rear Delts/Upper Back", repRangeStyle: "HYPERTROPHY", equipment: "BAND", movementPattern: "PULL", defaultSets: 3, primaryMuscle: "BACK", secondaryMuscles: ["SHOULDERS"], variationTag: "BACK_UPPER_REAR_DELT" },
  { name: "Dumbbell Rear Delt Fly", category: "ACCESSORY", muscleGroup: "Rear Delts/Upper Back", repRangeStyle: "HYPERTROPHY", equipment: "DUMBBELL", movementPattern: "PULL", defaultSets: 3, primaryMuscle: "BACK", secondaryMuscles: ["SHOULDERS"], variationTag: "BACK_UPPER_REAR_DELT" },

  // --- Legs ---
  { name: "Barbell Back Squat", category: "COMPOUND", muscleGroup: "Legs", repRangeStyle: "STRENGTH", equipment: "BARBELL", movementPattern: "LEGS", defaultSets: 4, primaryMuscle: "QUADS", secondaryMuscles: ["GLUTES", "CORE"], variationTag: "QUAD_SQUAT" },
  { name: "Dumbbell Goblet Squat", category: "ACCESSORY", muscleGroup: "Legs", repRangeStyle: "HYPERTROPHY", equipment: "DUMBBELL", movementPattern: "LEGS", defaultSets: 3, primaryMuscle: "QUADS", secondaryMuscles: ["GLUTES", "CORE"], variationTag: "QUAD_SQUAT" },
  { name: "Dumbbell Bulgarian Split Squat", category: "COMPOUND", muscleGroup: "Legs", repRangeStyle: "STRENGTH", equipment: "DUMBBELL", movementPattern: "LEGS", defaultSets: 3, primaryMuscle: "QUADS", secondaryMuscles: ["GLUTES"], variationTag: "QUAD_SINGLE_LEG" },
  { name: "Dumbbell Reverse Lunge", category: "ACCESSORY", muscleGroup: "Legs", repRangeStyle: "HYPERTROPHY", equipment: "DUMBBELL", movementPattern: "LEGS", defaultSets: 3, primaryMuscle: "QUADS", secondaryMuscles: ["GLUTES"], variationTag: "QUAD_SINGLE_LEG" },
  { name: "Barbell Deadlift", category: "COMPOUND", muscleGroup: "Legs/Posterior Chain", repRangeStyle: "STRENGTH", equipment: "BARBELL", movementPattern: "LEGS", defaultSets: 4, primaryMuscle: "HAMSTRINGS", secondaryMuscles: ["GLUTES", "BACK", "CORE"], variationTag: "HAMSTRING_HINGE" },
  { name: "Dumbbell Romanian Deadlift", category: "ACCESSORY", muscleGroup: "Hamstrings", repRangeStyle: "HYPERTROPHY", equipment: "DUMBBELL", movementPattern: "LEGS", defaultSets: 3, primaryMuscle: "HAMSTRINGS", secondaryMuscles: ["GLUTES", "BACK"], variationTag: "HAMSTRING_HINGE" },
  { name: "Single-Leg Dumbbell RDL", category: "ACCESSORY", muscleGroup: "Hamstrings", repRangeStyle: "HYPERTROPHY", equipment: "DUMBBELL", movementPattern: "LEGS", defaultSets: 3, primaryMuscle: "HAMSTRINGS", secondaryMuscles: ["GLUTES", "CORE"], variationTag: "HAMSTRING_SINGLE_LEG_HINGE" },
  { name: "Ring Hamstring Curl", category: "ACCESSORY", muscleGroup: "Hamstrings", repRangeStyle: "HYPERTROPHY", equipment: "BODYWEIGHT", movementPattern: "LEGS", defaultSets: 3, primaryMuscle: "HAMSTRINGS", secondaryMuscles: ["GLUTES"], variationTag: "HAMSTRING_CURL" },
  { name: "Dumbbell Hip Thrust", category: "COMPOUND", muscleGroup: "Glutes", repRangeStyle: "STRENGTH", equipment: "DUMBBELL", movementPattern: "LEGS", defaultSets: 3, primaryMuscle: "GLUTES", secondaryMuscles: ["HAMSTRINGS"], variationTag: "GLUTE_HIP_THRUST" },
  { name: "Dumbbell Step-Up", category: "ACCESSORY", muscleGroup: "Glutes", repRangeStyle: "HYPERTROPHY", equipment: "DUMBBELL", movementPattern: "LEGS", defaultSets: 3, primaryMuscle: "GLUTES", secondaryMuscles: ["QUADS"], variationTag: "GLUTE_SINGLE_LEG" },

  // --- Core ---
  { name: "Hanging Leg Raise", category: "ACCESSORY", muscleGroup: "Core", repRangeStyle: "HYPERTROPHY", equipment: "BODYWEIGHT", movementPattern: "CORE", defaultSets: 3, primaryMuscle: "CORE", secondaryMuscles: [], variationTag: "CORE_FLEXION" },
  { name: "Ring Plank", category: "ACCESSORY", muscleGroup: "Core", repRangeStyle: "HYPERTROPHY", equipment: "BODYWEIGHT", movementPattern: "CORE", defaultSets: 3, primaryMuscle: "CORE", secondaryMuscles: [], variationTag: "CORE_ANTI_EXTENSION" },
  { name: "Ring Rollout", category: "ACCESSORY", muscleGroup: "Core", repRangeStyle: "HYPERTROPHY", equipment: "BODYWEIGHT", movementPattern: "CORE", defaultSets: 3, primaryMuscle: "CORE", secondaryMuscles: ["SHOULDERS"], variationTag: "CORE_ANTI_EXTENSION" },
  { name: "Dead Bug", category: "ACCESSORY", muscleGroup: "Core", repRangeStyle: "HYPERTROPHY", equipment: "BODYWEIGHT", movementPattern: "CORE", defaultSets: 3, primaryMuscle: "CORE", secondaryMuscles: [], variationTag: "CORE_ANTI_EXTENSION" },
  { name: "Side Plank", category: "ACCESSORY", muscleGroup: "Obliques", repRangeStyle: "HYPERTROPHY", equipment: "BODYWEIGHT", movementPattern: "CORE", defaultSets: 3, primaryMuscle: "CORE", secondaryMuscles: [], variationTag: "CORE_LATERAL" },
  { name: "Dumbbell Russian Twist", category: "ACCESSORY", muscleGroup: "Obliques", repRangeStyle: "HYPERTROPHY", equipment: "DUMBBELL", movementPattern: "CORE", defaultSets: 3, primaryMuscle: "CORE", secondaryMuscles: [], variationTag: "CORE_ROTATION" },
  { name: "Band Pallof Press", category: "ACCESSORY", muscleGroup: "Core/Anti-Rotation", repRangeStyle: "HYPERTROPHY", equipment: "BAND", movementPattern: "CORE", defaultSets: 3, primaryMuscle: "CORE", secondaryMuscles: [], variationTag: "CORE_ANTI_ROTATION" },
];

async function main() {
  for (const ex of exercises) {
    await prisma.exercise.upsert({
      where: { name: ex.name },
      // Existing rows only get the recovery/variation tags filled in —
      // everything else about an existing catalog entry is left as is.
      update: { primaryMuscle: ex.primaryMuscle, secondaryMuscles: ex.secondaryMuscles, variationTag: ex.variationTag },
      create: ex,
    });
  }
  console.log(`Seeded ${exercises.length} exercises.`);
}

main().finally(() => prisma.$disconnect());
