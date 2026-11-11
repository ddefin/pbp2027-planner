-- AlterTable
ALTER TABLE "RoadbookCheckin" ADD COLUMN "clientId" TEXT;

-- CreateTable
CREATE TABLE "RoadbookAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roadbookId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoadbookAlert_roadbookId_fkey" FOREIGN KEY ("roadbookId") REFERENCES "Roadbook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WatchedPage" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "contentHash" TEXT NOT NULL,
    "routePending" BOOLEAN NOT NULL,
    "routeLinks" TEXT NOT NULL,
    "checkedAt" DATETIME NOT NULL,
    "changedAt" DATETIME,
    "lastNotifiedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "RoadbookAlert_roadbookId_key_key" ON "RoadbookAlert"("roadbookId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "RoadbookCheckin_roadbookId_clientId_key" ON "RoadbookCheckin"("roadbookId", "clientId");

