-- AlterTable
ALTER TABLE "User" ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);

-- Everyone who already has an account has been through setup in effect, so
-- only accounts created from now on are taken through the welcome journey.
UPDATE "User" SET "onboardingCompletedAt" = CURRENT_TIMESTAMP;
