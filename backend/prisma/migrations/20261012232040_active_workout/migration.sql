-- CreateTable
CREATE TABLE "ActiveWorkout" (
    "userId" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "plannedSessionId" TEXT,
    "progress" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActiveWorkout_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "ActiveWorkout" ADD CONSTRAINT "ActiveWorkout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
