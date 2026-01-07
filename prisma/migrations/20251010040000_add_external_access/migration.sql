-- Add external access fields to Playlist table
ALTER TABLE "playlists" ADD COLUMN "externalAccessEnabled" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "playlists" ADD COLUMN "externalAccessToken" TEXT;
ALTER TABLE "playlists" ADD COLUMN "uniqueId" TEXT NOT NULL DEFAULT gen_random_uuid()::text;

-- Add unique constraint and index on uniqueId
CREATE UNIQUE INDEX "playlists_uniqueId_key" ON "playlists"("uniqueId");
CREATE INDEX "playlists_uniqueId_idx" ON "playlists"("uniqueId");

