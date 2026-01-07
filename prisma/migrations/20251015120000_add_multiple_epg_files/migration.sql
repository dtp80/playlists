-- Step 1: CreateTable for EPG files
CREATE TABLE "epg_files" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "channelCount" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "epg_files_pkey" PRIMARY KEY ("id")
);

-- Step 2: Add epgFileId columns (nullable initially)
ALTER TABLE "playlists" ADD COLUMN "epgFileId" INTEGER;
ALTER TABLE "channel_lineup" ADD COLUMN "epgFileId" INTEGER;

-- Step 3: Migrate data from old epgUrl system to new EPG files system
-- For each user with an epgUrl, create an EPG file and assign their channels to it
DO $$
DECLARE
    user_record RECORD;
    new_epg_id INTEGER;
    channel_count INTEGER;
BEGIN
    -- Loop through all users that have an epgUrl
    FOR user_record IN 
        SELECT id, email, "epgUrl" 
        FROM users 
        WHERE "epgUrl" IS NOT NULL AND "epgUrl" != ''
    LOOP
        -- Count existing channels for this user
        SELECT COUNT(*) INTO channel_count
        FROM channel_lineup
        WHERE "userId" = user_record.id;

        -- Create an EPG file for this user with their existing epgUrl
        INSERT INTO epg_files ("userId", name, url, "channelCount", "sortOrder", "createdAt", "updatedAt")
        VALUES (
            user_record.id,
            'Default EPG',  -- Default name for migrated EPG
            user_record."epgUrl",
            channel_count,
            0,  -- First EPG is default
            NOW(),
            NOW()
        )
        RETURNING id INTO new_epg_id;

        -- Assign all existing channels for this user to the new EPG file
        UPDATE channel_lineup
        SET "epgFileId" = new_epg_id
        WHERE "userId" = user_record.id;

        RAISE NOTICE 'Migrated EPG for user % (id: %) - Created EPG file % with % channels',
            user_record.email, user_record.id, new_epg_id, channel_count;
    END LOOP;
END $$;

-- Step 4: Drop old unique constraint before creating new one
ALTER TABLE "channel_lineup" DROP CONSTRAINT IF EXISTS "channel_lineup_userId_name_key";

-- Step 5: Remove deprecated epgUrl column from users
ALTER TABLE "users" DROP COLUMN IF EXISTS "epgUrl";

-- Step 6: Create indexes
CREATE UNIQUE INDEX "epg_files_userId_name_key" ON "epg_files"("userId", "name");
CREATE INDEX "epg_files_userId_idx" ON "epg_files"("userId");
CREATE INDEX "epg_files_sortOrder_idx" ON "epg_files"("sortOrder");
CREATE INDEX "playlists_epgFileId_idx" ON "playlists"("epgFileId");
CREATE INDEX "channel_lineup_epgFileId_idx" ON "channel_lineup"("epgFileId");

-- Step 7: Create new unique constraint for channel_lineup (allows null epgFileId for manual channels)
-- Using a partial unique index to allow NULLs
CREATE UNIQUE INDEX "channel_lineup_userId_epgFileId_name_key" 
ON "channel_lineup"("userId", "epgFileId", "name") 
WHERE "epgFileId" IS NOT NULL;

-- Step 8: Add foreign key constraints
ALTER TABLE "playlists" 
ADD CONSTRAINT "playlists_epgFileId_fkey" 
FOREIGN KEY ("epgFileId") REFERENCES "epg_files"("id") 
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "channel_lineup" 
ADD CONSTRAINT "channel_lineup_epgFileId_fkey" 
FOREIGN KEY ("epgFileId") REFERENCES "epg_files"("id") 
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "epg_files" 
ADD CONSTRAINT "epg_files_userId_fkey" 
FOREIGN KEY ("userId") REFERENCES "users"("id") 
ON DELETE CASCADE ON UPDATE CASCADE;

