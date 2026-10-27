-- AlterTable
ALTER TABLE "PlannedSession" ADD COLUMN "title" TEXT,
ADD COLUMN "adHoc" BOOLEAN NOT NULL DEFAULT false;
