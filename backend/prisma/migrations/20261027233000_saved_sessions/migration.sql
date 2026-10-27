-- CreateTable
CREATE TABLE "SavedSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "estimatedMinutes" INTEGER,
    "notes" TEXT,
    "exercises" JSONB NOT NULL,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedSession_userId_idx" ON "SavedSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedSession_userId_name_key" ON "SavedSession"("userId", "name");

-- AddForeignKey
ALTER TABLE "SavedSession" ADD CONSTRAINT "SavedSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
