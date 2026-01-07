-- CreateTable
CREATE TABLE "playlists" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "username" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "identifierSource" TEXT,
    "identifierRegex" TEXT,
    "identifierMetadataKey" TEXT,
    "hiddenCategories" TEXT,
    "excludedChannels" TEXT,
    "includeUncategorizedChannels" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "playlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "playlistId" INTEGER NOT NULL,
    "categoryId" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "parentId" INTEGER,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channels" (
    "id" SERIAL NOT NULL,
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
    "xuiId" TEXT,
    "channelMapping" TEXT,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_lineup" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "tvgLogo" TEXT,
    "tvgId" TEXT,
    "extGrp" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_lineup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "twoFactorSecret" TEXT,
    "twoFactorEnabled" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categories_playlistId_idx" ON "categories"("playlistId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_playlistId_categoryId_key" ON "categories"("playlistId", "categoryId");

-- CreateIndex
CREATE INDEX "channels_playlistId_idx" ON "channels"("playlistId");

-- CreateIndex
CREATE INDEX "channels_categoryId_idx" ON "channels"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "channels_playlistId_streamId_key" ON "channels"("playlistId", "streamId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_lineup_name_key" ON "channel_lineup"("name");

-- CreateIndex
CREATE INDEX "channel_lineup_name_idx" ON "channel_lineup"("name");

-- CreateIndex
CREATE INDEX "channel_lineup_extGrp_idx" ON "channel_lineup"("extGrp");

-- CreateIndex
CREATE INDEX "channel_lineup_sortOrder_idx" ON "channel_lineup"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channels" ADD CONSTRAINT "channels_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
