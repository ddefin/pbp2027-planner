/*
  Warnings:

  - You are about to drop the column `precipitation` on the `Parcours` table. All the data in the column will be lost.
  - You are about to drop the column `tempMaxC` on the `Parcours` table. All the data in the column will be lost.
  - You are about to drop the column `tempMinC` on the `Parcours` table. All the data in the column will be lost.
  - You are about to drop the column `windDirection` on the `Parcours` table. All the data in the column will be lost.
  - You are about to drop the column `windGustsKmh` on the `Parcours` table. All the data in the column will be lost.
  - You are about to drop the column `windSpeedKmh` on the `Parcours` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Parcours" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brmEventId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "fileName" TEXT,
    "fileData" BLOB,
    "fileMimeType" TEXT,
    "distanceKm" REAL,
    "elevationGainM" INTEGER,
    "elevationLossM" INTEGER,
    "minAltitudeM" INTEGER,
    "maxAltitudeM" INTEGER,
    "notes" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Parcours_brmEventId_fkey" FOREIGN KEY ("brmEventId") REFERENCES "BrmEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Parcours" ("brmEventId", "createdAt", "distanceKm", "elevationGainM", "elevationLossM", "fileData", "fileMimeType", "fileName", "id", "maxAltitudeM", "minAltitudeM", "notes", "sourceUrl", "updatedAt") SELECT "brmEventId", "createdAt", "distanceKm", "elevationGainM", "elevationLossM", "fileData", "fileMimeType", "fileName", "id", "maxAltitudeM", "minAltitudeM", "notes", "sourceUrl", "updatedAt" FROM "Parcours";
DROP TABLE "Parcours";
ALTER TABLE "new_Parcours" RENAME TO "Parcours";
CREATE UNIQUE INDEX "Parcours_brmEventId_key" ON "Parcours"("brmEventId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
