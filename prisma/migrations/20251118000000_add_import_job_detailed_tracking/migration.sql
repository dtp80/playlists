-- AlterTable
ALTER TABLE "import_jobs" 
ADD COLUMN IF NOT EXISTS "channelsInJsonNotInPlaylist" TEXT,
ADD COLUMN IF NOT EXISTS "channelsInPlaylistNotInJson" TEXT;

