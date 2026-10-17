-- AlterTable
ALTER TABLE "GolfRound" ADD COLUMN "stravaActivityId" TEXT,
ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "GolfRound_userId_stravaActivityId_key" ON "GolfRound"("userId", "stravaActivityId");
