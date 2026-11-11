-- CreateTable
CREATE TABLE "PbpRoute" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "points" TEXT NOT NULL,
    "waypoints" TEXT NOT NULL,
    "distanceKm" REAL NOT NULL,
    "elevationGainM" INTEGER,
    "elevationLossM" INTEGER,
    "rawPointCount" INTEGER NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PbpRoute_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PbpRoute_kind_createdAt_idx" ON "PbpRoute"("kind", "createdAt");
