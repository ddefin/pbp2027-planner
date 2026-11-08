-- CreateTable
CREATE TABLE "WindAlertSent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogEventId" TEXT NOT NULL,
    "forecastDate" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "WindAlertSent_catalogEventId_forecastDate_key" ON "WindAlertSent"("catalogEventId", "forecastDate");
