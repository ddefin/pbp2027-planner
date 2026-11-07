-- CreateTable
CREATE TABLE "Parcours" (
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
    "windDirection" TEXT,
    "windSpeedKmh" INTEGER,
    "windGustsKmh" INTEGER,
    "tempMinC" INTEGER,
    "tempMaxC" INTEGER,
    "precipitation" TEXT,
    "notes" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Parcours_brmEventId_fkey" FOREIGN KEY ("brmEventId") REFERENCES "BrmEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Parcours_brmEventId_key" ON "Parcours"("brmEventId");
