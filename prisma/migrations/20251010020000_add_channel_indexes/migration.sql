-- Performance Optimization Indexes for Channels Table
-- These indexes are automatically maintained by PostgreSQL

-- 1. Composite index for sorted channel listings (playlistId + name)
-- Used when: Loading channels sorted by name for a specific playlist
CREATE INDEX IF NOT EXISTS "channels_playlistId_name_idx" ON "channels" ("playlistId", "name");

-- 2. Composite index for category filtering (playlistId + categoryId)
-- Used when: Filtering channels by category within a playlist
CREATE INDEX IF NOT EXISTS "channels_playlistId_categoryId_idx" ON "channels" ("playlistId", "categoryId");

-- 3. Partial index for mapped channels only (smaller and faster)
-- Used when: Sorting channels by mapping status, export operations
-- Only indexes rows where channelMapping IS NOT NULL
CREATE INDEX IF NOT EXISTS "channels_channelMapping_partial_idx" ON "channels" ("playlistId", "channelMapping") WHERE "channelMapping" IS NOT NULL;

-- 4. Index for streamId lookups
-- Used when: Updating individual channels, import operations
CREATE INDEX IF NOT EXISTS "channels_streamId_idx" ON "channels" ("streamId");

-- 5. Index for tvgName searches (partial index)
-- Used when: Matching channels during import operations
-- Only indexes rows where tvgName IS NOT NULL
CREATE INDEX IF NOT EXISTS "channels_tvgName_idx" ON "channels" ("tvgName") WHERE "tvgName" IS NOT NULL;

-- Update table statistics for the PostgreSQL query planner
-- This helps PostgreSQL choose the best execution plan
ANALYZE "channels";

