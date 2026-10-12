/*
  Warnings:

  - You are about to drop the `ActiveWorkout` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateTable
CREATE TABLE "DailyWorkout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "plannedSessionId" TEXT,
    "progress" JSONB,
    "savedSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyWorkout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyWorkout_userId_date_key" ON "DailyWorkout"("userId", "date");

-- Carry over any workout in progress from the old table, dated by when it
-- was built (UTC), before that table is dropped below.
INSERT INTO "DailyWorkout" ("id", "userId", "date", "workoutId", "plan", "plannedSessionId", "progress", "createdAt", "updatedAt")
SELECT md5(random()::text || "userId"), "userId", to_char("createdAt", 'YYYY-MM-DD'), "workoutId", "plan", "plannedSessionId", "progress", "createdAt", "updatedAt"
FROM "ActiveWorkout";

-- AddForeignKey
ALTER TABLE "DailyWorkout" ADD CONSTRAINT "DailyWorkout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "ActiveWorkout" DROP CONSTRAINT "ActiveWorkout_userId_fkey";

-- DropTable
DROP TABLE "ActiveWorkout";
