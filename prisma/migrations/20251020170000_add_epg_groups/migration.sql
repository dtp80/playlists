-- CreateTable
CREATE TABLE "epg_groups" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "epg_groups_pkey" PRIMARY KEY ("id")
);

-- Add epgGroupId to epg_files
ALTER TABLE "epg_files" ADD COLUMN "epgGroupId" INTEGER;

-- Add epgGroupId to playlists
ALTER TABLE "playlists" ADD COLUMN "epgGroupId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "epg_groups_userId_name_key" ON "epg_groups"("userId", "name");

-- CreateIndex
CREATE INDEX "epg_groups_userId_idx" ON "epg_groups"("userId");

-- CreateIndex
CREATE INDEX "epg_files_epgGroupId_idx" ON "epg_files"("epgGroupId");

-- CreateIndex
CREATE INDEX "playlists_epgGroupId_idx" ON "playlists"("epgGroupId");

-- AddForeignKey
ALTER TABLE "epg_files" ADD CONSTRAINT "epg_files_epgGroupId_fkey" FOREIGN KEY ("epgGroupId") REFERENCES "epg_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_epgGroupId_fkey" FOREIGN KEY ("epgGroupId") REFERENCES "epg_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "epg_groups" ADD CONSTRAINT "epg_groups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

