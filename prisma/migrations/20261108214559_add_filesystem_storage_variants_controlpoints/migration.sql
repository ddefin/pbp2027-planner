-- AlterTable
ALTER TABLE "DirectMessage" ADD COLUMN "filePath" TEXT;

-- AlterTable
ALTER TABLE "GroupMessage" ADD COLUMN "filePath" TEXT;

-- AlterTable
ALTER TABLE "Parcours" ADD COLUMN "filePath" TEXT;

-- CreateTable
CREATE TABLE "CatalogTrackVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogEventId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "points" TEXT NOT NULL,
    "distanceKm" REAL,
    "elevationGainM" INTEGER,
    "elevationLossM" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CatalogTrackVariant_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CatalogControlPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogEventId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "lat" REAL NOT NULL,
    "lon" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CatalogControlPoint_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CatalogTrackVariant_catalogEventId_idx" ON "CatalogTrackVariant"("catalogEventId");

-- CreateIndex
CREATE INDEX "CatalogControlPoint_catalogEventId_idx" ON "CatalogControlPoint"("catalogEventId");
