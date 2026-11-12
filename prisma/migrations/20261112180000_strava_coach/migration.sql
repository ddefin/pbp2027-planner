-- CreateTable
CREATE TABLE "StravaAccount" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "athleteId" TEXT NOT NULL,
    "athleteName" TEXT NOT NULL,
    "profilePhoto" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "scope" TEXT NOT NULL,
    "ftp" INTEGER,
    "maxHr" INTEGER,
    "hrZones" TEXT,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" DATETIME,
    "lastSyncError" TEXT,
    CONSTRAINT "StravaAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StravaActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sportType" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "startLocal" DATETIME NOT NULL,
    "distanceM" REAL NOT NULL,
    "movingSec" INTEGER NOT NULL,
    "elevationM" REAL NOT NULL,
    "avgHr" REAL,
    "maxHr" REAL,
    "avgWatts" REAL,
    "weightedWatts" REAL,
    "avgSpeedMs" REAL,
    "load" REAL NOT NULL,
    "zone" INTEGER,
    CONSTRAINT "StravaActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CoachPrefs" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "profile" TEXT NOT NULL DEFAULT 'endurance',
    "tone" TEXT NOT NULL DEFAULT 'bienveillant',
    "frequency" TEXT NOT NULL DEFAULT 'hebdo',
    "metrics" TEXT NOT NULL DEFAULT '["hr","elevation"]',
    "goal" TEXT,
    "lastReportKey" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CoachPrefs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StravaAccount_athleteId_key" ON "StravaAccount"("athleteId");

-- CreateIndex
CREATE INDEX "StravaActivity_userId_startLocal_idx" ON "StravaActivity"("userId", "startLocal");

