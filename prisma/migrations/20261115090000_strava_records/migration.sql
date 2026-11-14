-- Strava : records et trophées de segments (ajouts seulement).
ALTER TABLE "StravaAccount" ADD COLUMN "allTimeStats" TEXT;
ALTER TABLE "StravaActivity" ADD COLUMN "maxSpeedMs" REAL;
ALTER TABLE "StravaActivity" ADD COLUMN "elapsedSec" INTEGER;
ALTER TABLE "StravaActivity" ADD COLUMN "achievementCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StravaActivity" ADD COLUMN "prCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StravaActivity" ADD COLUMN "detailFetchedAt" DATETIME;

CREATE TABLE "StravaSegmentEffort" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "segmentName" TEXT NOT NULL,
    "distanceM" REAL NOT NULL,
    "avgGradePct" REAL,
    "climbCategory" INTEGER,
    "city" TEXT,
    "elapsedSec" INTEGER NOT NULL,
    "startLocal" DATETIME NOT NULL,
    "prRank" INTEGER,
    "komRank" INTEGER,
    CONSTRAINT "StravaSegmentEffort_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "StravaActivity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "StravaSegmentEffort_userId_komRank_idx" ON "StravaSegmentEffort"("userId", "komRank");
