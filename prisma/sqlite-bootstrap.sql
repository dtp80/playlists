-- CreateTable
CREATE TABLE "playlists" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "username" TEXT,
    "password" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" DATETIME,
    "lastCategoriesSyncedAt" DATETIME,
    "lastChannelsSyncedAt" DATETIME,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "identifierSource" TEXT,
    "identifierRegex" TEXT,
    "identifierMetadataKey" TEXT,
    "hiddenCategories" TEXT,
    "excludedChannels" TEXT,
    "includeUncategorizedChannels" INTEGER NOT NULL DEFAULT 1,
    "externalAccessEnabled" INTEGER NOT NULL DEFAULT 0,
    "externalAccessToken" TEXT,
    "uniqueId" TEXT NOT NULL,
    "epgFileId" INTEGER,
    "epgGroupId" INTEGER,
    CONSTRAINT "playlists_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "playlists_epgFileId_fkey" FOREIGN KEY ("epgFileId") REFERENCES "epg_files" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "playlists_epgGroupId_fkey" FOREIGN KEY ("epgGroupId") REFERENCES "epg_groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "categories" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "playlistId" INTEGER NOT NULL,
    "categoryId" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "parentId" INTEGER,
    "isSelected" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "categories_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "playlists" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "channels" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "playlistId" INTEGER NOT NULL,
    "streamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "streamUrl" TEXT NOT NULL,
    "streamIcon" TEXT,
    "epgChannelId" TEXT,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "added" TEXT,
    "duration" TEXT,
    "tvgId" TEXT,
    "tvgName" TEXT,
    "tvgLogo" TEXT,
    "groupTitle" TEXT,
    "timeshift" TEXT,
    "tvgRec" TEXT,
    "tvgChno" TEXT,
    "catchup" TEXT,
    "catchupDays" TEXT,
    "catchupSource" TEXT,
    "catchupCorrection" TEXT,
    "cuid" TEXT,
    "xuiId" TEXT,
    "channelMapping" TEXT,
    "isOperational" BOOLEAN NOT NULL DEFAULT true,
    "isOperationalManual" BOOLEAN NOT NULL DEFAULT false,
    "hasArchive" BOOLEAN NOT NULL DEFAULT false,
    "hasArchiveManual" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "channels_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "playlists" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "channel_lineup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "epgFileId" INTEGER,
    "name" TEXT NOT NULL,
    "tvgLogo" TEXT,
    "tvgId" TEXT,
    "extGrp" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "channel_lineup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "channel_lineup_epgFileId_fkey" FOREIGN KEY ("epgFileId") REFERENCES "epg_files" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "epg_files" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "epgGroupId" INTEGER,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "channelCount" INTEGER NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "epg_files_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "epg_files_epgGroupId_fkey" FOREIGN KEY ("epgGroupId") REFERENCES "epg_groups" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "epg_groups" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "epg_groups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "twoFactorSecret" TEXT,
    "twoFactorEnabled" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sid" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "epg_import_jobs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "epgFileId" INTEGER,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "totalChannels" INTEGER NOT NULL DEFAULT 0,
    "importedChannels" INTEGER NOT NULL DEFAULT 0,
    "downloadProgress" INTEGER NOT NULL DEFAULT 0,
    "importProgress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "epg_import_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "playlist_sync_jobs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "playlistId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "totalChannels" INTEGER NOT NULL DEFAULT 0,
    "totalCategories" INTEGER NOT NULL DEFAULT 0,
    "savedChannels" INTEGER NOT NULL DEFAULT 0,
    "channelsData" TEXT,
    "categoriesData" TEXT,
    "addedChannels" TEXT,
    "removedChannels" TEXT,
    "categoryFilters" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "playlist_sync_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "playlistId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "totalMappings" INTEGER NOT NULL DEFAULT 0,
    "processedMappings" INTEGER NOT NULL DEFAULT 0,
    "mapped" INTEGER NOT NULL DEFAULT 0,
    "notFound" INTEGER NOT NULL DEFAULT 0,
    "importData" TEXT,
    "channelsInJsonNotInPlaylist" TEXT,
    "channelsInPlaylistNotInJson" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "import_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "playlists_uniqueId_key" ON "playlists"("uniqueId");

-- CreateIndex
CREATE INDEX "playlists_userId_idx" ON "playlists"("userId");

-- CreateIndex
CREATE INDEX "playlists_uniqueId_idx" ON "playlists"("uniqueId");

-- CreateIndex
CREATE INDEX "playlists_epgFileId_idx" ON "playlists"("epgFileId");

-- CreateIndex
CREATE INDEX "playlists_epgGroupId_idx" ON "playlists"("epgGroupId");

-- CreateIndex
CREATE INDEX "categories_playlistId_idx" ON "categories"("playlistId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_playlistId_categoryId_key" ON "categories"("playlistId", "categoryId");

-- CreateIndex
CREATE INDEX "channels_playlistId_idx" ON "channels"("playlistId");

-- CreateIndex
CREATE INDEX "channels_categoryId_idx" ON "channels"("categoryId");

-- CreateIndex
CREATE INDEX "channels_playlistId_name_idx" ON "channels"("playlistId", "name");

-- CreateIndex
CREATE INDEX "channels_playlistId_categoryId_idx" ON "channels"("playlistId", "categoryId");

-- CreateIndex
CREATE INDEX "channels_streamId_idx" ON "channels"("streamId");

-- CreateIndex
CREATE INDEX "channels_name_idx" ON "channels"("name");

-- CreateIndex
CREATE UNIQUE INDEX "channels_playlistId_streamId_key" ON "channels"("playlistId", "streamId");

-- CreateIndex
CREATE INDEX "channel_lineup_userId_idx" ON "channel_lineup"("userId");

-- CreateIndex
CREATE INDEX "channel_lineup_epgFileId_idx" ON "channel_lineup"("epgFileId");

-- CreateIndex
CREATE INDEX "channel_lineup_name_idx" ON "channel_lineup"("name");

-- CreateIndex
CREATE INDEX "channel_lineup_extGrp_idx" ON "channel_lineup"("extGrp");

-- CreateIndex
CREATE INDEX "channel_lineup_sortOrder_idx" ON "channel_lineup"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "channel_lineup_userId_epgFileId_name_key" ON "channel_lineup"("userId", "epgFileId", "name");

-- CreateIndex
CREATE INDEX "epg_files_userId_idx" ON "epg_files"("userId");

-- CreateIndex
CREATE INDEX "epg_files_epgGroupId_idx" ON "epg_files"("epgGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "epg_files_userId_name_key" ON "epg_files"("userId", "name");

-- CreateIndex
CREATE INDEX "epg_groups_userId_idx" ON "epg_groups"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "epg_groups_userId_name_key" ON "epg_groups"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_sid_key" ON "session"("sid");

-- CreateIndex
CREATE INDEX "session_expiresAt_idx" ON "session"("expiresAt");

-- CreateIndex
CREATE INDEX "epg_import_jobs_userId_idx" ON "epg_import_jobs"("userId");

-- CreateIndex
CREATE INDEX "epg_import_jobs_status_idx" ON "epg_import_jobs"("status");

-- CreateIndex
CREATE INDEX "playlist_sync_jobs_userId_idx" ON "playlist_sync_jobs"("userId");

-- CreateIndex
CREATE INDEX "playlist_sync_jobs_playlistId_idx" ON "playlist_sync_jobs"("playlistId");

-- CreateIndex
CREATE INDEX "playlist_sync_jobs_status_idx" ON "playlist_sync_jobs"("status");

-- CreateIndex
CREATE INDEX "import_jobs_userId_idx" ON "import_jobs"("userId");

-- CreateIndex
CREATE INDEX "import_jobs_playlistId_idx" ON "import_jobs"("playlistId");

-- CreateIndex
CREATE INDEX "import_jobs_status_idx" ON "import_jobs"("status");
