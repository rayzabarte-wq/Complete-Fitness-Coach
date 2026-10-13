-- AlterTable
ALTER TABLE "SportApproach" ADD COLUMN     "milestones" JSONB;

-- CreateTable
CREATE TABLE "UserEquipment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "equipment" "Equipment" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minLb" DOUBLE PRECISION,
    "maxLb" DOUBLE PRECISION,
    "stepLb" DOUBLE PRECISION,
    "customWeightsLb" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "bandLevels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserEquipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserEquipment_userId_equipment_key" ON "UserEquipment"("userId", "equipment");

-- AddForeignKey
ALTER TABLE "UserEquipment" ADD CONSTRAINT "UserEquipment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
