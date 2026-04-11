-- AlterTable
ALTER TABLE "DriveItem" ADD COLUMN "sectionKey" TEXT;

-- Backfill section roots (legacy internal names)
UPDATE "DriveItem"
SET "sectionKey" = 'DOCS_ROOT'
WHERE "name" = '__MYDRIVE_DOCS_ROOT__' AND "type" = 'FOLDER' AND "parentId" IS NULL;

UPDATE "DriveItem"
SET "sectionKey" = 'IMAGES_ROOT'
WHERE "name" = '__MYDRIVE_IMAGES_ROOT__' AND "type" = 'FOLDER' AND "parentId" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "DriveItem_userId_sectionKey_key" ON "DriveItem"("userId", "sectionKey");
