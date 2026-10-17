-- CreateTable
CREATE TABLE "GolfRound" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "course" TEXT NOT NULL,
    "holes" INTEGER NOT NULL,
    "score" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GolfRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GolfRoundGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "target" INTEGER NOT NULL,

    CONSTRAINT "GolfRoundGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GolfRound_userId_date_idx" ON "GolfRound"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "GolfRoundGoal_userId_quarter_key" ON "GolfRoundGoal"("userId", "quarter");

-- AddForeignKey
ALTER TABLE "GolfRound" ADD CONSTRAINT "GolfRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GolfRoundGoal" ADD CONSTRAINT "GolfRoundGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
