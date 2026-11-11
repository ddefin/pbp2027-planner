-- CreateTable
CREATE TABLE "TelegramChat" (
    "chatId" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "botStatus" TEXT,
    "updatedAt" DATETIME NOT NULL
);
