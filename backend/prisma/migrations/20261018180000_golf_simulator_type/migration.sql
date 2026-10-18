-- AlterEnum
ALTER TYPE "SessionType" ADD VALUE 'GOLF_SIMULATOR';

-- AlterTable
ALTER TABLE "GolfProfile" ADD COLUMN "simulatorLongestClub" TEXT;
