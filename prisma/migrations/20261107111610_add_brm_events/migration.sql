-- CreateTable
CREATE TABLE "BrmEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "distance" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "lieu" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'a-venir',
    "limiteMinutes" INTEGER NOT NULL,
    "tempsRealiseMinutes" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrmEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BrmEvent_userId_idx" ON "BrmEvent"("userId");
