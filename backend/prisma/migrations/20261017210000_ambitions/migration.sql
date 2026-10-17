-- AlterTable
ALTER TABLE "User" ADD COLUMN "ambitions" TEXT,
ADD COLUMN "ambitionsUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SportAmbition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sport" "Sport" NOT NULL,
    "statement" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SportAmbition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SportAmbition_userId_sport_key" ON "SportAmbition"("userId", "sport");

-- AddForeignKey
ALTER TABLE "SportAmbition" ADD CONSTRAINT "SportAmbition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
