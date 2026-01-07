-- Add Prisma-managed indexes for Channel table performance optimization
-- These indexes are now defined in schema.prisma and will be maintained by Prisma

-- Note: Using IF NOT EXISTS to handle cases where indexes were created by previous migrations

-- 1. Composite index for sorted channel listings (playlistId + name)
-- Used when: Loading channels sorted by name for a specific playlist
-- Already exists from previous migration, but adding for completeness
CREATE INDEX IF NOT EXISTS "channels_playlistId_name_idx" ON "channels" ("playlistId", "name");

-- 2. Index for name search queries
-- Used when: Searching channels by name (case-insensitive search)
CREATE INDEX IF NOT EXISTS "channels_name_idx" ON "channels" ("name");

-- 3. Index for streamId lookups
-- Used when: Updating individual channels, import operations, mapping lookups
-- Already exists from previous migration, but adding for completeness
CREATE INDEX IF NOT EXISTS "channels_streamId_idx" ON "channels" ("streamId");

-- Update table statistics for PostgreSQL query planner
-- This helps PostgreSQL choose the best execution plan with the new indexes
ANALYZE "channels";

