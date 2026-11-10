/*
  Warnings:

  - You are about to drop the `MfaChallenge` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RecoveryCode` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `mfaEnabled` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `mfaPendingEncrypted` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `mfaSecretEncrypted` on the `User` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "MfaChallenge_tokenHash_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MfaChallenge";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "RecoveryCode";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT NOT NULL,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "email", "failedLoginAttempts", "id", "isAdmin", "lockedUntil", "passwordHash", "prenom") SELECT "createdAt", "email", "failedLoginAttempts", "id", "isAdmin", "lockedUntil", "passwordHash", "prenom" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
