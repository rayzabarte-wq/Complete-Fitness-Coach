import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Every exercise here is doable with: adjustable dumbbells (4-45lb),
// barbell (20-80lb), EZ bar (20-80lb), a bench, elastic bands, a chin-up
// bar, and rings suspended from the chin-up bar. No squat rack or machines.
// movementPattern groups them into full Push / Pull / Legs / Core sessions.
const exercises = [
  // --- Push ---
  { name: "Barbell Bench Press", category: "COMPOUND", muscleGroup: "Chest", repRangeStyle: "STRENGTH", equipment: "BARBELL", movementPattern: "PUSH", defaultSets: 4 },
  { name: "Dumbbell Shoulder Press", category: "COMPOUND", muscleGroup: "Shoulders", repRangeStyle: "STRENGTH", equipment: "DUMBBELL", movementPattern: "PUSH", defaultSets: 4 },
  { name: "Dumbbell Incline Press", category: "ACCESSORY", muscleGroup: "Chest", repRangeStyle: "HYPERTROPHY", equipment: "DUMBBELL", movementPattern: "PUSH", defaultSets: 3 },
  { name: "Ring Dip", category: "ACCESSORY", muscleGroup: "Chest/Triceps", repRangeStyle: "HYPERTROPHY", equipment: "BODYWEIGHT", movementPattern: "PUSH", defaultSets: 3 },
  { name: "Dumbbell Lateral Raise", category: "ACCESSORY", muscleGroup: "Shoulders", repRangeStyle: "HYPERTROPHY", equipment: "DUMBBELL", movementPattern: "PUSH", defaultSets: 3 },
  { name: "EZ Bar Skull Crusher", category: "ACCESSORY", muscleGroup: "Triceps", repRangeStyle: "HYPERTROPHY", equipment: "EZ_BAR", movementPattern: "PUSH", defaultSets: 3 },

  // --- Pull ---
  { name: "Barbell Bent-Over Row", category: "COMPOUND", muscleGroup: "Back", repRangeStyle: "STRENGTH", equipment: "BARBELL", movementPattern: "PULL", defaultSets: 4 },
  { name: "Weighted Pull-Up", category: "COMPOUND", muscleGroup: "Back", repRangeStyle: "STRENGTH", equipment: "BODYWEIGHT", movementPattern: "PULL", defaultSets: 4 },
  { name: "Ring Row", category: "ACCESSORY", muscleGroup: "Back", repRangeStyle: "HYPERTROPHY", equipment: "BODYWEIGHT", movementPattern: "PULL", defaultSets: 3 },
  { name: "EZ Bar Curl", category: "ACCESSORY", muscleGroup: "Biceps", repRangeStyle: "HYPERTROPHY", equipment: "EZ_BAR", movementPattern: "PULL", defaultSets: 3 },
  { name: "Band Face Pull", category: "ACCESSORY", muscleGroup: "Rear Delts/Upper Back", repRangeStyle: "HYPERTROPHY", equipment: "BAND", movementPattern: "PULL", defaultSets: 3 },
  { name: "Band Pull-Apart", category: "ACCESSORY", muscleGroup: "Rear Delts/Upper Back", repRangeStyle: "HYPERTROPHY", equipment: "BAND", movementPattern: "PULL", defaultSets: 3 },

  // --- Legs ---
  { name: "Barbell Back Squat", category: "COMPOUND", muscleGroup: "Legs", repRangeStyle: "STRENGTH", equipment: "BARBELL", movementPattern: "LEGS", defaultSets: 4 },
  { name: "Barbell Deadlift", category: "COMPOUND", muscleGroup: "Legs/Posterior Chain", repRangeStyle: "STRENGTH", equipment: "BARBELL", movementPattern: "LEGS", defaultSets: 4 },
  { name: "Dumbbell Goblet Squat", category: "ACCESSORY", muscleGroup: "Legs", repRangeStyle: "HYPERTROPHY", equipment: "DUMBBELL", movementPattern: "LEGS", defaultSets: 3 },
  { name: "Dumbbell Romanian Deadlift", category: "ACCESSORY", muscleGroup: "Hamstrings", repRangeStyle: "HYPERTROPHY", equipment: "DUMBBELL", movementPattern: "LEGS", defaultSets: 3 },

  // --- Core ---
  { name: "Hanging Leg Raise", category: "ACCESSORY", muscleGroup: "Core", repRangeStyle: "HYPERTROPHY", equipment: "BODYWEIGHT", movementPattern: "CORE", defaultSets: 3 },
  { name: "Ring Plank", category: "ACCESSORY", muscleGroup: "Core", repRangeStyle: "HYPERTROPHY", equipment: "BODYWEIGHT", movementPattern: "CORE", defaultSets: 3 },
  { name: "Dumbbell Russian Twist", category: "ACCESSORY", muscleGroup: "Obliques", repRangeStyle: "HYPERTROPHY", equipment: "DUMBBELL", movementPattern: "CORE", defaultSets: 3 },
  { name: "Band Pallof Press", category: "ACCESSORY", muscleGroup: "Core/Anti-Rotation", repRangeStyle: "HYPERTROPHY", equipment: "BAND", movementPattern: "CORE", defaultSets: 3 },
] as const;

async function main() {
  for (const ex of exercises) {
    await prisma.exercise.upsert({
      where: { name: ex.name },
      update: {},
      create: ex,
    });
  }
  console.log(`Seeded ${exercises.length} exercises.`);
}

main().finally(() => prisma.$disconnect());
