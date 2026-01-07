-- Add performance indexes for Channel table

-- Index for name search (case-insensitive full-text search)
CREATE INDEX IF NOT EXISTS "channels_name_idx" ON "channels" USING gin (to_tsvector('english', "name"));

-- Index for composite queries (playlistId + name for sorted listing)
CREATE INDEX IF NOT EXISTS "channels_playlistId_name_idx" ON "channels" ("playlistId", "name");

-- Index for composite queries (playlistId + categoryId for filtering)
CREATE INDEX IF NOT EXISTS "channels_playlistId_categoryId_idx" ON "channels" ("playlistId", "categoryId");

-- Index for channelMapping (to quickly find mapped channels)
CREATE INDEX IF NOT EXISTS "channels_channelMapping_idx" ON "channels" ("channelMapping") WHERE "channelMapping" IS NOT NULL;

-- Index for streamId lookups
CREATE INDEX IF NOT EXISTS "channels_streamId_idx" ON "channels" ("streamId");

-- Composite index for export operations (playlistId + channelMapping presence)
CREATE INDEX IF NOT EXISTS "channels_playlistId_mapped_idx" ON "channels" ("playlistId", "channelMapping") WHERE "channelMapping" IS NOT NULL;

-- Index for tvgName searches
CREATE INDEX IF NOT EXISTS "channels_tvgName_idx" ON "channels" ("tvgName") WHERE "tvgName" IS NOT NULL;

