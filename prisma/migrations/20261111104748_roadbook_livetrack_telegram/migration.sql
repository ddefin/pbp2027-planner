-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Roadbook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "classKm" INTEGER NOT NULL,
    "limitMinutes" INTEGER NOT NULL,
    "startAt" DATETIME,
    "movingSpeedKmh" REAL NOT NULL DEFAULT 22,
    "climbPenaltyMinPer100m" REAL NOT NULL DEFAULT 0,
    "controls" TEXT NOT NULL,
    "pois" TEXT NOT NULL,
    "points" TEXT NOT NULL,
    "distanceKm" REAL NOT NULL,
    "elevationGainM" INTEGER,
    "elevationLossM" INTEGER,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "shareToken" TEXT,
    "liveTrackUrl" TEXT,
    "telegramAnnounce" BOOLEAN NOT NULL DEFAULT true,
    "lastAnnouncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Roadbook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Roadbook" ("classKm", "climbPenaltyMinPer100m", "controls", "createdAt", "distanceKm", "elevationGainM", "elevationLossM", "fileName", "filePath", "id", "limitMinutes", "movingSpeedKmh", "points", "pois", "shareToken", "startAt", "title", "updatedAt", "userId") SELECT "classKm", "climbPenaltyMinPer100m", "controls", "createdAt", "distanceKm", "elevationGainM", "elevationLossM", "fileName", "filePath", "id", "limitMinutes", "movingSpeedKmh", "points", "pois", "shareToken", "startAt", "title", "updatedAt", "userId" FROM "Roadbook";
DROP TABLE "Roadbook";
ALTER TABLE "new_Roadbook" RENAME TO "Roadbook";
CREATE UNIQUE INDEX "Roadbook_shareToken_key" ON "Roadbook"("shareToken");
CREATE INDEX "Roadbook_userId_createdAt_idx" ON "Roadbook"("userId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
