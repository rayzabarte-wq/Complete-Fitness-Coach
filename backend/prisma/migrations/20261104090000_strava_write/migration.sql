-- Writing workout details to the matching Strava activity.
ALTER TABLE "StravaAccount" ADD COLUMN "canWrite" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StravaAccount" ADD COLUMN "canReadUnits" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StravaAccount" ADD COLUMN "autoUpdate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkoutSession" ADD COLUMN "stravaActivityId" TEXT;
ALTER TABLE "WorkoutSession" ADD COLUMN "stravaPushedAt" TIMESTAMP(3);
