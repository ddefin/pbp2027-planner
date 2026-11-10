-- AlterTable
ALTER TABLE "User" ADD COLUMN "club" TEXT;
ALTER TABLE "User" ADD COLUMN "licenceNumero" TEXT;
ALTER TABLE "User" ADD COLUMN "notebook" TEXT;

-- CreateTable
CREATE TABLE "PersonalEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PersonalEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PersonalEvent_userId_date_idx" ON "PersonalEvent"("userId", "date");
