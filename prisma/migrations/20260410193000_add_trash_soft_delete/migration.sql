-- AlterTable
ALTER TABLE "DriveItem" ADD COLUMN "deletedAt" DATETIME;
ALTER TABLE "DriveItem" ADD COLUMN "purgeAt" DATETIME;

-- CreateIndex
CREATE INDEX "DriveItem_userId_deletedAt_purgeAt_idx" ON "DriveItem"("userId", "deletedAt", "purgeAt");
