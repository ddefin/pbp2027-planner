-- CreateTable
CREATE TABLE "CatalogTrack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogEventId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "points" TEXT NOT NULL,
    "distanceKm" REAL,
    "elevationGainM" INTEGER,
    "elevationLossM" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CatalogTrack_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogTrack_catalogEventId_key" ON "CatalogTrack"("catalogEventId");
