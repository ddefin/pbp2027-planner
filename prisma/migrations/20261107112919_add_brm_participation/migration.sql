-- CreateTable
CREATE TABLE "BrmParticipation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "catalogEventId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'prevu',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrmParticipation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BrmParticipation_catalogEventId_idx" ON "BrmParticipation"("catalogEventId");

-- CreateIndex
CREATE UNIQUE INDEX "BrmParticipation_userId_catalogEventId_key" ON "BrmParticipation"("userId", "catalogEventId");
