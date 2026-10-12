-- Strength-first refocus: profile + consent, body composition and goals,
-- daily steps, per-muscle exercise tagging, block-based variation, and
-- auto-planned calendar entries.

-- AlterEnum
ALTER TYPE "MovementPattern" ADD VALUE 'UPPER';
ALTER TYPE "MovementPattern" ADD VALUE 'LOWER';
ALTER TYPE "MovementPattern" ADD VALUE 'FULL_BODY';

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE');
CREATE TYPE "Muscle" AS ENUM ('CHEST', 'SHOULDERS', 'TRICEPS', 'BACK', 'BICEPS', 'QUADS', 'HAMSTRINGS', 'GLUTES', 'CORE');
CREATE TYPE "ConsentPurpose" AS ENUM ('PROFILE', 'BODY_DATA', 'BENCHMARKING', 'PRODUCT_ANALYTICS');
CREATE TYPE "MeasurementSource" AS ENUM ('MANUAL', 'RENPHO', 'APPLE_HEALTH');
CREATE TYPE "BodyMetric" AS ENUM ('BODY_FAT_PCT', 'MUSCLE_MASS_KG', 'BODY_WEIGHT_KG');
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'CLOSED');
CREATE TYPE "RevisionReason" AS ENUM ('INJURY_OR_ILLNESS', 'LIFE_EVENT', 'TOO_AMBITIOUS', 'TOO_EASY', 'CHANGED_PRIORITIES', 'OTHER');
CREATE TYPE "StepSource" AS ENUM ('MANUAL', 'APPLE_HEALTH');

-- AlterTable: User
ALTER TABLE "User" ALTER COLUMN "visibleSessionTypes" SET DEFAULT ARRAY['STRENGTH']::"SessionType"[];
ALTER TABLE "User" ADD COLUMN "birthYear" INTEGER,
ADD COLUMN "sex" "Sex",
ADD COLUMN "heightCm" DOUBLE PRECISION,
ADD COLUMN "trainingDaysPerWeek" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN "dailyStepGoal" INTEGER,
ADD COLUMN "consentReviewedAt" TIMESTAMP(3),
ADD COLUMN "ingestTokenHash" TEXT;

-- Strength-only first release: switch every existing account to showing
-- Strength only. Other types stay in the database and can be ticked back
-- on in Settings at any time — nothing scheduled is deleted.
UPDATE "User" SET "visibleSessionTypes" = ARRAY['STRENGTH']::"SessionType"[];

-- AlterTable: Exercise
ALTER TABLE "Exercise" ADD COLUMN "primaryMuscle" "Muscle",
ADD COLUMN "secondaryMuscles" "Muscle"[] DEFAULT ARRAY[]::"Muscle"[],
ADD COLUMN "variationTag" TEXT;

-- AlterTable: WorkoutSession
ALTER TABLE "WorkoutSession" ADD COLUMN "focus" "MovementPattern";

-- AlterTable: PlannedSession
ALTER TABLE "PlannedSession" ADD COLUMN "autoPlanned" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "textVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyMeasurement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "weightKg" DOUBLE PRECISION,
    "bodyFatPct" DOUBLE PRECISION,
    "muscleMassKg" DOUBLE PRECISION,
    "source" "MeasurementSource" NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BodyMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BodyGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "metric" "BodyMetric" NOT NULL,
    "startValue" DOUBLE PRECISION NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BodyGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalTarget" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "anchorDate" TIMESTAMP(3) NOT NULL,
    "anchorValue" DOUBLE PRECISION NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "reason" "RevisionReason",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoalTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "steps" INTEGER NOT NULL,
    "source" "StepSource" NOT NULL DEFAULT 'APPLE_HEALTH',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StepDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingBlock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "focus" "MovementPattern" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "exerciseIds" TEXT[],
    "closedAt" TIMESTAMP(3),
    "swapLog" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "TrainingBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_ingestTokenHash_key" ON "User"("ingestTokenHash");
CREATE INDEX "ConsentRecord_userId_purpose_createdAt_idx" ON "ConsentRecord"("userId", "purpose", "createdAt");
CREATE INDEX "BodyMeasurement_userId_measuredAt_idx" ON "BodyMeasurement"("userId", "measuredAt");
CREATE UNIQUE INDEX "BodyMeasurement_userId_source_externalId_key" ON "BodyMeasurement"("userId", "source", "externalId");
CREATE INDEX "BodyGoal_userId_status_idx" ON "BodyGoal"("userId", "status");
CREATE INDEX "GoalTarget_goalId_createdAt_idx" ON "GoalTarget"("goalId", "createdAt");
CREATE UNIQUE INDEX "StepDay_userId_date_key" ON "StepDay"("userId", "date");
CREATE INDEX "TrainingBlock_userId_focus_closedAt_idx" ON "TrainingBlock"("userId", "focus", "closedAt");

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BodyMeasurement" ADD CONSTRAINT "BodyMeasurement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BodyGoal" ADD CONSTRAINT "BodyGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoalTarget" ADD CONSTRAINT "GoalTarget_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "BodyGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StepDay" ADD CONSTRAINT "StepDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingBlock" ADD CONSTRAINT "TrainingBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
