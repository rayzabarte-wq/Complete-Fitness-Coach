-- CreateTable
CREATE TABLE "StravaImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stravaActivityId" TEXT NOT NULL,
    "plannedSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StravaImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StravaImport_userId_stravaActivityId_key" ON "StravaImport"("userId", "stravaActivityId");

-- AddForeignKey
ALTER TABLE "StravaImport" ADD CONSTRAINT "StravaImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
