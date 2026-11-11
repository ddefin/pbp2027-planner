-- CreateTable
CREATE TABLE "Roadbook" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Roadbook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RoadbookCheckin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roadbookId" TEXT NOT NULL,
    "km" REAL NOT NULL,
    "lat" REAL,
    "lon" REAL,
    "source" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoadbookCheckin_roadbookId_fkey" FOREIGN KEY ("roadbookId") REFERENCES "Roadbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Roadbook_shareToken_key" ON "Roadbook"("shareToken");

-- CreateIndex
CREATE INDEX "Roadbook_userId_createdAt_idx" ON "Roadbook"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RoadbookCheckin_roadbookId_at_idx" ON "RoadbookCheckin"("roadbookId", "at");
