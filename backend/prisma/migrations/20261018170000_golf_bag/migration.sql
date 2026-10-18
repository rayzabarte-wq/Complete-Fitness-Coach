-- CreateEnum
CREATE TYPE "GolfClubType" AS ENUM ('DRIVER', 'WOOD', 'HYBRID', 'IRON', 'WEDGE', 'SAND_WEDGE', 'PUTTER');

-- CreateTable
CREATE TABLE "GolfProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "handicap" DOUBLE PRECISION,
    "canShapeShots" BOOLEAN,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GolfProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GolfHandicapEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "handicap" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GolfHandicapEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GolfClub" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GolfClubType" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GolfClub_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GolfProfile_userId_key" ON "GolfProfile"("userId");

-- CreateIndex
CREATE INDEX "GolfHandicapEntry_userId_date_idx" ON "GolfHandicapEntry"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "GolfClub_userId_name_key" ON "GolfClub"("userId", "name");

-- AddForeignKey
ALTER TABLE "GolfProfile" ADD CONSTRAINT "GolfProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GolfHandicapEntry" ADD CONSTRAINT "GolfHandicapEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GolfClub" ADD CONSTRAINT "GolfClub_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
