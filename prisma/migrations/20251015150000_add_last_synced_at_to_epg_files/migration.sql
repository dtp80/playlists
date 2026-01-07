-- AlterTable: Add lastSyncedAt column to epg_files
ALTER TABLE "epg_files" ADD COLUMN "lastSyncedAt" TIMESTAMP(3);

-- Set lastSyncedAt to createdAt for existing EPG files
UPDATE "epg_files" SET "lastSyncedAt" = "createdAt" WHERE "lastSyncedAt" IS NULL;

