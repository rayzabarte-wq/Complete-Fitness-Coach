-- AlterTable
ALTER TABLE "FrameworkSlot" ADD COLUMN     "estimatedMinutes" INTEGER;

-- AlterTable
ALTER TABLE "SportApproach" ADD COLUMN     "sessionMinutes" INTEGER NOT NULL DEFAULT 45;

-- AlterTable
ALTER TABLE "SportPriority" ADD COLUMN     "weeklyMinutesAvailable" INTEGER;
