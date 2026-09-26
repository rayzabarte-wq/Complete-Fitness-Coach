-- CreateEnum
CREATE TYPE "ExerciseCategory" AS ENUM ('COMPOUND', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "RepRangeStyle" AS ENUM ('STRENGTH', 'HYPERTROPHY');

-- CreateEnum
CREATE TYPE "Equipment" AS ENUM ('DUMBBELL', 'BARBELL', 'EZ_BAR', 'BAND', 'BODYWEIGHT');

-- CreateEnum
CREATE TYPE "MovementPattern" AS ENUM ('PUSH', 'PULL', 'LEGS', 'CORE');

-- CreateEnum
CREATE TYPE "ReadinessLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('STRENGTH', 'SWIM', 'GOLF_RANGE', 'GOLF_ROUND', 'GOLF_SHORT_GAME', 'GOLF_PUTTING', 'RUN_RECOVERY', 'RUN_TEMPO', 'RUN_FARTLEK', 'RUN_INTERVALS', 'RUN_LONG_RUN', 'WALK_WALK', 'WALK_HIKE', 'CYCLING_EASY', 'CYCLING_LONG', 'CYCLING_HILLS', 'CYCLING_TURBO_EASY', 'CYCLING_TURBO_LONG', 'CYCLING_TURBO_HILLS', 'REST');

-- CreateEnum
CREATE TYPE "ActualTimeSource" AS ENUM ('MANUAL', 'STRAVA');

-- CreateEnum
CREATE TYPE "Sport" AS ENUM ('STRENGTH', 'GOLF', 'RUN', 'WALK', 'CYCLING', 'CYCLING_TURBO', 'SWIM');

-- CreateEnum
CREATE TYPE "PriorityLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "TimeOfDay" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'FRAMEWORK', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ApproachStatus" AS ENUM ('PROPOSED', 'APPROVED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visibleSessionTypes" "SessionType"[] DEFAULT ARRAY['STRENGTH', 'SWIM', 'GOLF_RANGE', 'GOLF_ROUND', 'GOLF_SHORT_GAME', 'GOLF_PUTTING', 'RUN_RECOVERY', 'RUN_TEMPO', 'RUN_FARTLEK', 'RUN_INTERVALS', 'RUN_LONG_RUN', 'WALK_WALK', 'WALK_HIKE', 'CYCLING_EASY', 'CYCLING_LONG', 'CYCLING_HILLS', 'CYCLING_TURBO_EASY', 'CYCLING_TURBO_LONG', 'CYCLING_TURBO_HILLS']::"SessionType"[],

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ExerciseCategory" NOT NULL,
    "muscleGroup" TEXT NOT NULL,
    "repRangeStyle" "RepRangeStyle" NOT NULL,
    "equipment" "Equipment" NOT NULL,
    "movementPattern" "MovementPattern" NOT NULL,
    "defaultSets" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "sleepQuality" "ReadinessLevel",
    "soreness" "ReadinessLevel",
    "energyLevel" "ReadinessLevel",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outlookEventId" TEXT,

    CONSTRAINT "WorkoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "weightLb" DOUBLE PRECISION NOT NULL,
    "bandLevel" TEXT,
    "reps" INTEGER NOT NULL,
    "targetReps" INTEGER NOT NULL,
    "rpe" DOUBLE PRECISION,
    "hitTarget" BOOLEAN NOT NULL,
    "setOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "suggestedWeightLb" DOUBLE PRECISION NOT NULL,
    "suggestedReps" INTEGER NOT NULL,
    "suggestedSets" INTEGER NOT NULL,
    "restSeconds" INTEGER NOT NULL,
    "reasoning" TEXT NOT NULL,
    "followedAsGiven" BOOLEAN,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionFeedback" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "thumbsUp" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NutritionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calories" INTEGER,
    "proteinG" DOUBLE PRECISION,
    "carbsG" DOUBLE PRECISION,
    "fatG" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NutritionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MicrosoftAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MicrosoftAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannedSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" "SessionType" NOT NULL,
    "movementPattern" "MovementPattern",
    "notes" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estimatedMinutes" INTEGER,
    "actualMinutes" INTEGER,
    "actualSource" "ActualTimeSource",
    "stravaActivityId" TEXT,

    CONSTRAINT "PlannedSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StravaAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StravaAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "overallGoal" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SportPriority" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "sport" "Sport" NOT NULL,
    "priority" "PriorityLevel" NOT NULL,
    "goalNote" TEXT,

    CONSTRAINT "SportPriority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SportApproach" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "sport" "Sport" NOT NULL,
    "approachText" TEXT NOT NULL,
    "weeklySessionTarget" INTEGER NOT NULL,
    "status" "ApproachStatus" NOT NULL DEFAULT 'PROPOSED',

    CONSTRAINT "SportApproach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrameworkVersion" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "amendmentSummary" TEXT,
    "amendmentRequest" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrameworkVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrameworkSlot" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "timeOfDay" "TimeOfDay" NOT NULL,
    "sport" "Sport" NOT NULL,
    "sessionType" "SessionType",
    "movementPattern" "MovementPattern",
    "label" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FrameworkSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleConstraint" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "daysOfWeek" INTEGER[],
    "blockedTimeOfDay" "TimeOfDay"[],
    "parseExplanation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleConstraint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_name_key" ON "Exercise"("name");

-- CreateIndex
CREATE INDEX "WorkoutSession_userId_date_idx" ON "WorkoutSession"("userId", "date");

-- CreateIndex
CREATE INDEX "SetEntry_exerciseId_createdAt_idx" ON "SetEntry"("exerciseId", "createdAt");

-- CreateIndex
CREATE INDEX "SetEntry_sessionId_idx" ON "SetEntry"("sessionId");

-- CreateIndex
CREATE INDEX "Recommendation_userId_exerciseId_generatedAt_idx" ON "Recommendation"("userId", "exerciseId", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SessionFeedback_sessionId_key" ON "SessionFeedback"("sessionId");

-- CreateIndex
CREATE INDEX "NutritionLog_userId_date_idx" ON "NutritionLog"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MicrosoftAccount_userId_key" ON "MicrosoftAccount"("userId");

-- CreateIndex
CREATE INDEX "PlannedSession_userId_date_idx" ON "PlannedSession"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StravaAccount_userId_key" ON "StravaAccount"("userId");

-- CreateIndex
CREATE INDEX "TrainingPlan_userId_status_idx" ON "TrainingPlan"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SportPriority_planId_sport_key" ON "SportPriority"("planId", "sport");

-- CreateIndex
CREATE UNIQUE INDEX "SportApproach_planId_sport_key" ON "SportApproach"("planId", "sport");

-- CreateIndex
CREATE INDEX "FrameworkVersion_planId_effectiveFrom_idx" ON "FrameworkVersion"("planId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "FrameworkSlot_versionId_dayOfWeek_idx" ON "FrameworkSlot"("versionId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "ScheduleConstraint_planId_idx" ON "ScheduleConstraint"("planId");

-- AddForeignKey
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetEntry" ADD CONSTRAINT "SetEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetEntry" ADD CONSTRAINT "SetEntry_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionFeedback" ADD CONSTRAINT "SessionFeedback_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NutritionLog" ADD CONSTRAINT "NutritionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MicrosoftAccount" ADD CONSTRAINT "MicrosoftAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedSession" ADD CONSTRAINT "PlannedSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StravaAccount" ADD CONSTRAINT "StravaAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlan" ADD CONSTRAINT "TrainingPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SportPriority" ADD CONSTRAINT "SportPriority_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SportApproach" ADD CONSTRAINT "SportApproach_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrameworkVersion" ADD CONSTRAINT "FrameworkVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrameworkSlot" ADD CONSTRAINT "FrameworkSlot_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "FrameworkVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleConstraint" ADD CONSTRAINT "ScheduleConstraint_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
