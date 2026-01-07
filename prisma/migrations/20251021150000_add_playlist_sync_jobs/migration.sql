-- CreateTable
CREATE TABLE "playlist_sync_jobs" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "playlistId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "totalChannels" INTEGER NOT NULL DEFAULT 0,
    "totalCategories" INTEGER NOT NULL DEFAULT 0,
    "savedChannels" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "playlist_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "playlist_sync_jobs_userId_idx" ON "playlist_sync_jobs"("userId");

-- CreateIndex
CREATE INDEX "playlist_sync_jobs_playlistId_idx" ON "playlist_sync_jobs"("playlistId");

-- CreateIndex
CREATE INDEX "playlist_sync_jobs_status_idx" ON "playlist_sync_jobs"("status");

-- AddForeignKey
ALTER TABLE "playlist_sync_jobs" ADD CONSTRAINT "playlist_sync_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

