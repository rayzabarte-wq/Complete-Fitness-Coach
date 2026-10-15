-- CreateEnum
CREATE TYPE "GymKind" AS ENUM ('HOME', 'PUBLIC_GYM', 'VISITING');
CREATE TYPE "Accessory" AS ENUM ('BENCH', 'PULL_UP_BAR', 'RINGS');

-- CreateTable
CREATE TABLE "GymProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "GymKind" NOT NULL,
    "name" TEXT NOT NULL,
    "accessories" "Accessory"[] DEFAULT ARRAY[]::"Accessory"[],
    "customEquipmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GymProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GymEquipment" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "equipment" "Equipment" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minLb" DOUBLE PRECISION,
    "maxLb" DOUBLE PRECISION,
    "stepLb" DOUBLE PRECISION,
    "customWeightsLb" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "bandLevels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GymEquipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomEquipment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomEquipment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GymProfile_userId_kind_key" ON "GymProfile"("userId", "kind");
CREATE UNIQUE INDEX "GymEquipment_gymId_equipment_key" ON "GymEquipment"("gymId", "equipment");
CREATE UNIQUE INDEX "CustomEquipment_userId_name_key" ON "CustomEquipment"("userId", "name");

ALTER TABLE "GymProfile" ADD CONSTRAINT "GymProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GymEquipment" ADD CONSTRAINT "GymEquipment_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "GymProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomEquipment" ADD CONSTRAINT "CustomEquipment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry last migration's per-user equipment over to each user's HOME gym.
INSERT INTO "GymProfile" ("id", "userId", "kind", "name", "accessories", "updatedAt")
SELECT 'home_' || ue."userId", ue."userId", 'HOME', 'Home gym', ARRAY['BENCH','PULL_UP_BAR','RINGS']::"Accessory"[], CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "userId" FROM "UserEquipment") ue;

INSERT INTO "GymEquipment" ("id", "gymId", "equipment", "enabled", "minLb", "maxLb", "stepLb", "customWeightsLb", "bandLevels", "updatedAt")
SELECT 'ge_' || "id", 'home_' || "userId", "equipment", "enabled", "minLb", "maxLb", "stepLb", "customWeightsLb", "bandLevels", CURRENT_TIMESTAMP
FROM "UserEquipment";

DROP TABLE "UserEquipment";

-- Exercise: names are now unique per owner; shared catalog rows have no owner.
DROP INDEX "Exercise_name_key";
ALTER TABLE "Exercise" ADD COLUMN "userId" TEXT,
ADD COLUMN "requires" "Accessory"[] DEFAULT ARRAY[]::"Accessory"[],
ADD COLUMN "customEquipmentId" TEXT,
ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Exercise_userId_name_key" ON "Exercise"("userId", "name");
-- Postgres treats NULL owners as distinct, so keep catalog names unique separately.
CREATE UNIQUE INDEX "Exercise_catalog_name_key" ON "Exercise"("name") WHERE "userId" IS NULL;

-- Which accessories the shared catalog needs (re-applied by the seed).
UPDATE "Exercise" SET "requires" = ARRAY['RINGS']::"Accessory"[] WHERE "userId" IS NULL AND "name" LIKE 'Ring %';
UPDATE "Exercise" SET "requires" = ARRAY['BENCH']::"Accessory"[] WHERE "userId" IS NULL AND "name" IN
  ('Barbell Bench Press','Dumbbell Bench Press','Dumbbell Incline Press','Dumbbell Fly','EZ Bar Skull Crusher','EZ Bar Close-Grip Bench Press','Incline Dumbbell Curl','Dumbbell Pullover','Dumbbell Hip Thrust','Dumbbell Bulgarian Split Squat');
UPDATE "Exercise" SET "requires" = ARRAY['PULL_UP_BAR']::"Accessory"[] WHERE "userId" IS NULL AND "name" IN ('Weighted Pull-Up','Chin-Up','Hanging Leg Raise');

-- User / WorkoutSession
ALTER TABLE "User" ADD COLUMN "activeGymId" TEXT;
ALTER TABLE "WorkoutSession" ADD COLUMN "gymId" TEXT;
