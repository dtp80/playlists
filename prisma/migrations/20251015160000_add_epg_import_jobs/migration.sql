-- CreateTable
CREATE TABLE "epg_import_jobs" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "epgFileId" INTEGER,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "totalChannels" INTEGER NOT NULL DEFAULT 0,
    "importedChannels" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "epg_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "epg_import_jobs_userId_idx" ON "epg_import_jobs"("userId");

-- CreateIndex
CREATE INDEX "epg_import_jobs_status_idx" ON "epg_import_jobs"("status");

-- AddForeignKey
ALTER TABLE "epg_import_jobs" ADD CONSTRAINT "epg_import_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

