-- Avatars, rappels avant un BRM, carte du groupe : ajouts uniquement (aucune table recréée).
ALTER TABLE "User" ADD COLUMN "avatar" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarKey" TEXT;
CREATE UNIQUE INDEX "User_avatarKey_key" ON "User"("avatarKey");

ALTER TABLE "Roadbook" ADD COLUMN "groupShare" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "BrmReminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "catalogEventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrmReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BrmReminder_userId_catalogEventId_kind_key" ON "BrmReminder"("userId", "catalogEventId", "kind");
