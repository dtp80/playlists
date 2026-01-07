import prisma from "../database/prisma";
import { EPGService, EPGFileTooLargeError } from "./epg.service";

export interface EpgImportJob {
  id: number;
  userId: number;
  epgFileId: number | null;
  name: string;
  url: string;
  status: string;
  progress: number;
  message: string | null;
  totalChannels: number;
  importedChannels: number;
  downloadProgress?: number;
  importProgress?: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class EpgJobService {
  /**
   * Create a new EPG import job
   */
  static async createJob(
    userId: number,
    name: string,
    url: string,
    epgFileId: number | null = null
  ): Promise<EpgImportJob> {
    const job = await prisma.epgImportJob.create({
      data: {
        userId,
        name,
        url,
        epgFileId,
        status: "pending",
        progress: 0,
        downloadProgress: 0,
        importProgress: 0,
      },
    });

    return job as EpgImportJob;
  }

  /**
   * Get job by ID
   */
  static async getJob(
    id: number,
    userId: number
  ): Promise<EpgImportJob | null> {
    const job = await prisma.epgImportJob.findFirst({
      where: { id, userId },
    });

    return job as EpgImportJob | null;
  }

  /**
   * Get pending job for user (if any)
   * Only returns jobs updated in the last 5 minutes (not abandoned)
   */
  static async getPendingJob(userId: number): Promise<EpgImportJob | null> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const job = await prisma.epgImportJob.findFirst({
      where: {
        userId,
        status: { in: ["pending", "downloading", "parsing", "importing"] },
        updatedAt: { gte: fiveMinutesAgo }, // Only active jobs (updated within 5 min)
      },
      orderBy: { createdAt: "desc" },
    });

    // If we found an old stuck job, mark it as failed
    if (!job) {
      const stuckJob = await prisma.epgImportJob.findFirst({
        where: {
          userId,
          status: { in: ["pending", "downloading", "parsing", "importing"] },
          updatedAt: { lt: fiveMinutesAgo }, // Older than 5 minutes
        },
        orderBy: { createdAt: "desc" },
      });

      if (stuckJob) {
        await this.updateJob(stuckJob.id, {
          status: "failed",
          error: "Job timed out - no activity for 5 minutes",
          message: "Import abandoned or timed out",
        });
        console.log(`⚠️ Marked abandoned job ${stuckJob.id} as failed`);

        // Clean up any orphaned EPG file from this failed job
        if (stuckJob.epgFileId) {
          await this.cleanupOrphanedEpgFile(stuckJob.epgFileId, userId);
        }
      }

      // Also clean up any orphaned EPG files (no channels, from failed jobs)
      await this.cleanupOrphanedEpgFiles(userId);
    }

    return job as EpgImportJob | null;
  }

  /**
   * Update job status
   */
  static async updateJob(
    id: number,
    data: Partial<Omit<EpgImportJob, "id" | "userId" | "createdAt">>
  ): Promise<void> {
    await prisma.epgImportJob.update({
      where: { id },
      data,
    });
  }

  /**
   * Process EPG import in chunks (safe for serverless 10s timeout)
   */
  static async processImportChunk(
    jobId: number,
    maxDuration: number = 8000 // 8 seconds max to stay under 10s limit
  ): Promise<boolean> {
    const startTime = Date.now();
    console.log(
      `\n>>> 🔄 processImportChunk START (job ${jobId}, maxDuration ${maxDuration}ms) <<<`
    );

    // Get job
    console.log(`   📊 Fetching job ${jobId} from DB...`);
    const job = await prisma.epgImportJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      console.error(`   ❌ Job ${jobId} not found in database`);
      return false;
    }

    console.log(
      `   ✅ Job found: status="${job.status}", progress=${job.progress}%`
    );
    console.log(`   URL: ${job.url}`);
    console.log(`   Name: ${job.name}`);

    try {
      // Step 1: Download and stream-parse in one go to avoid huge strings
      if (job.status === "pending") {
        console.log(`   📥 PHASE 1: DOWNLOAD`);
        console.log(`   Starting download for job ${jobId}...`);

        const updateStart = Date.now();
        await this.updateJob(jobId, {
          status: "downloading",
          progress: 5,
          message: "Downloading EPG file...",
        });
        console.log(
          `   ✅ Status updated to "downloading" in ${
            Date.now() - updateStart
          }ms`
        );

        const downloadStart = Date.now();
        let lastUpdate = 0;
        let firstProgressSent = false;
        const channels = await EPGService.importEPGStream(job.url, async (read, total) => {
          const now = Date.now();
          if (!firstProgressSent || now - lastUpdate >= 500) {
            lastUpdate = now;
            firstProgressSent = true;
          } else {
            return; // throttle updates
          }

          // Map progress from 5 -> 40 during download/parse
          let progress = 5;
          if (total && total > 0) {
            progress = 5 + Math.min(35, Math.floor((read / total) * 35));
          } else {
            // Fallback: estimate with 600MB cap
            const readMB = read / (1024 * 1024);
            progress = 5 + Math.min(35, Math.floor((readMB / 600) * 35));
          }

          await this.updateJob(jobId, {
            progress,
            downloadProgress: Math.min(progress, 40),
            message: `Downloading EPG... ${((read / (1024 * 1024)) || 0).toFixed(1)}MB`,
          } as any);
        });
        const downloadDuration = Date.now() - downloadStart;

        console.log(
          `   ✅ Downloaded & parsed EPG in ${downloadDuration}ms, channels: ${channels.length}`
        );

        // Move directly to importing
        const updateStart2 = Date.now();
        await this.updateJob(jobId, {
          status: "importing",
          progress: 40,
          downloadProgress: 100,
          importProgress: 0,
          message: `Parsed ${channels.length.toLocaleString()} channels. Importing...`,
          totalChannels: channels.length,
        } as any);
        console.log(
          `   ✅ Status updated to "importing" in ${
            Date.now() - updateStart2
          }ms`
        );

        // Proceed to import within the same chunk
        return await this.importChannelsBatch(
          jobId,
          channels,
          job.userId,
          job.name,
          job.url,
          startTime,
          maxDuration
        );
      }

      // Step 2: Parse only (legacy path; now also uses streaming)
      if (job.status === "parsing") {
        console.log(`   📝 PHASE 2: PARSE`);
        console.log(`   Starting parse for job ${jobId}...`);

        const updateStart = Date.now();
        await this.updateJob(jobId, {
          progress: 35,
          message: "Parsing EPG file...",
        });
        console.log(`   ✅ Status updated in ${Date.now() - updateStart}ms`);

        // Re-stream to parse
        console.log(`   📥 Re-downloading EPG for parsing (stream)...`);
        const downloadStart = Date.now();
        const channels = await EPGService.importEPGStream(job.url);
        const parseDuration = Date.now() - downloadStart;

        console.log(
          `   ✅ Parsed ${channels.length.toLocaleString()} channels in ${parseDuration}ms`
        );

        // Move to importing state
        const updateStart2 = Date.now();
        await this.updateJob(jobId, {
          status: "importing",
          progress: 60,
          message: `Ready to import ${channels.length.toLocaleString()} channels...`,
          totalChannels: channels.length,
        });
        console.log(
          `   ✅ Status updated to "importing" in ${
            Date.now() - updateStart2
          }ms`
        );

        // Check if we have time to start importing
        const elapsed = Date.now() - startTime;
        console.log(
          `   ⏱️ Elapsed time so far: ${elapsed}ms / ${maxDuration}ms`
        );

        if (elapsed > maxDuration - 3000) {
          console.log(
            `   ⚠️ Not enough time to start import (only ${
              maxDuration - elapsed
            }ms left)`
          );
          console.log(`   Will continue in next poll`);
          console.log(
            `<<< 🔄 processImportChunk END (continue in next poll) <<<\n`
          );
          return false;
        }

        // Start importing
        console.log(`   ✅ Enough time remaining, starting import...`);
        return await this.importChannelsBatch(
          jobId,
          channels,
          job.userId,
          job.name,
          job.url,
          startTime,
          maxDuration
        );
      }

      // Step 3: Import (needs to re-download+parse to get channels)
      if (job.status === "importing") {
        console.log(`   📦 PHASE 3: IMPORT (CONTINUE - streaming)`);
        console.log(`   Continuing import for job ${jobId}...`);
        console.log(
          `   Currently imported: ${job.importedChannels} / ${job.totalChannels}`
        );

        // Re-download and parse to get channels (streaming)
        console.log(`   📥 Re-downloading EPG for import (streaming)...`);
        const downloadStart = Date.now();
        let lastUpdate = Date.now();
        const channels = await EPGService.importEPGStream(job.url, async (read, total) => {
          const now = Date.now();
          if (now - lastUpdate < 1000) return;
          lastUpdate = now;
          let progress = 5;
          if (total && total > 0) {
            progress = 5 + Math.min(35, Math.floor((read / total) * 35));
          } else {
            const readMB = read / (1024 * 1024);
            progress = 5 + Math.min(35, Math.floor((readMB / 600) * 35));
          }
          await this.updateJob(jobId, {
            progress,
            downloadProgress: Math.min(progress, 40),
            message: `Downloading EPG... ${((read / (1024 * 1024)) || 0).toFixed(1)}MB`,
          } as any);
        });
        console.log(
          `   ✅ Streamed and parsed ${channels.length.toLocaleString()} channels in ${
            Date.now() - downloadStart
          }ms`
        );

        // Update job to reflect download completion if not already
        await this.updateJob(jobId, {
          downloadProgress: 100,
          message: `Parsed ${channels.length.toLocaleString()} channels. Importing...`,
          totalChannels: channels.length,
        } as any);

        return await this.importChannelsBatch(
          jobId,
          channels,
          job.userId,
          job.name,
          job.url,
          startTime,
          maxDuration
        );
      }

      // Job is done or in an unexpected state
      console.log(`   ⚠️ Job is in unexpected state: ${job.status}`);
      console.log(`<<< 🔄 processImportChunk END (no action needed) <<<\n`);
      return true;
    } catch (error: any) {
      console.error(
        `\n❌❌❌ CRITICAL ERROR in processImportChunk (job ${jobId}) ❌❌❌`
      );
      console.error(`   Error name: ${error.name}`);
      console.error(`   Error message: ${error.message}`);
      console.error(`   Error code: ${error.code}`);
      console.error(`   Error stack:`, error.stack);

      // Provide user-friendly error message for file size issues
      let userMessage = error.message || "Unknown error";
      if (error instanceof EPGFileTooLargeError) {
        userMessage =
          `⚠️ EPG file is too large for this environment.\n\n` +
          `File size: ${error.compressedSizeMB}MB compressed${
            error.decompressedSizeMB
              ? ` (${error.decompressedSizeMB}MB uncompressed)`
              : ""
          }\n\n` +
          `📝 Recommended: Use EPG files under ~2GB uncompressed. For best performance, use regional/filtered sources.\n\n` +
          `💡 Suggestions:\n` +
          `• Use a regional EPG file instead of a global one\n` +
          `• Look for filtered/curated EPG sources\n` +
          `• Contact your IPTV provider for a smaller EPG option`;
      }

      try {
        await this.updateJob(jobId, {
          status: "failed",
          error: error.message || "Unknown error",
          message: userMessage,
        });
        console.log(`   ✅ Job marked as failed in database`);
      } catch (updateError: any) {
        console.error(`   ❌ Failed to update job status:`, updateError);
      }

      console.log(`<<< 🔄 processImportChunk END (FAILED) <<<\n`);
      return false;
    }
  }

  /**
   * Import channels in batches (all at once since we have the data in memory)
   */
  private static async importChannelsBatch(
    jobId: number,
    channels: any[],
    userId: number,
    name: string,
    url: string,
    startTime: number,
    maxDuration: number
  ): Promise<boolean> {
    console.log(`   >>> 📦 importChannelsBatch START <<<`);
    console.log(`   Job ID: ${jobId}`);
    console.log(`   User ID: ${userId}`);
    console.log(`   Channels to import (raw): ${channels.length.toLocaleString()}`);
    console.log(`   Time budget: ${maxDuration}ms`);
    console.log(`   Time used so far: ${Date.now() - startTime}ms`);

    // Deduplicate by tvgId first, then by name to avoid unique constraint (userId, epgFileId, name)
    const unique = new Map<string, any>();
    for (const ch of channels) {
      const key = ch.tvgId || ch.name;
      if (!unique.has(key)) {
        unique.set(key, ch);
      }
    }
    const deduped = Array.from(unique.values());
    console.log(
      `   🧹 Deduplicated channels by tvgId/name: ${deduped.length.toLocaleString()} remaining (was ${channels.length.toLocaleString()})`
    );
    channels = deduped;

    try {
      // Get the current job to check if we're continuing an existing import
      const currentJob = await prisma.epgImportJob.findUnique({
        where: { id: jobId },
      });

      let epgFile;
      let startFromChannel = 0;

      // If job already has an epgFileId, we're continuing an existing import
      if (currentJob?.epgFileId) {
        console.log(`   🔄 Continuing existing import (EPG file ID: ${currentJob.epgFileId})`);
        epgFile = await prisma.epgFile.findUnique({
          where: { id: currentJob.epgFileId },
        });

        if (!epgFile) {
          throw new Error(`EPG file ${currentJob.epgFileId} not found`);
        }

        // Start from where we left off
        startFromChannel = currentJob.importedChannels || 0;
        console.log(
          `   ⏩ Resuming from channel ${startFromChannel}/${channels.length} after dedupe`
        );
      } else {
        // This is a new import - create or update EPG file
        console.log(`   📝 Checking if EPG file "${name}" already exists...`);
        const existingEpgFile = await prisma.epgFile.findFirst({
          where: {
            userId: userId,
            name: name,
          },
        });

        const createStart = Date.now();

        if (existingEpgFile) {
          console.log(
            `   ⚠️ EPG file "${name}" already exists (ID: ${existingEpgFile.id}), deleting old channels...`
          );

          // Delete old channels
          await prisma.channelLineup.deleteMany({
            where: {
              userId: userId,
              epgFileId: existingEpgFile.id,
            },
          });
          console.log(`   ✅ Deleted old channels`);

          // Update existing EPG file
          epgFile = await prisma.epgFile.update({
            where: { id: existingEpgFile.id },
            data: {
              url: url,
              channelCount: channels.length,
              lastSyncedAt: new Date(),
            },
          });
          console.log(
            `   ✅ Updated existing EPG file ${epgFile.id} in ${
              Date.now() - createStart
            }ms`
          );
        } else {
          // Create new EPG file
          console.log(`   📝 Creating new EPG file in database...`);
          // Check if this is the first EPG file for the user
          const existingCount = await prisma.epgFile.count({
            where: { userId: userId },
          });

          epgFile = await prisma.epgFile.create({
            data: {
              userId: userId,
              name: name,
              url: url,
              channelCount: channels.length,
              isDefault: existingCount === 0, // First EPG is default
              lastSyncedAt: new Date(),
            },
          });
          console.log(
            `   ✅ Created EPG file ${epgFile.id} in ${
              Date.now() - createStart
            }ms`
          );
        }

        const updateStart = Date.now();
        await this.updateJob(jobId, {
          epgFileId: epgFile.id,
          progress: 65,
          message: `Created EPG file. Importing ${channels.length.toLocaleString()} channels...`,
        });
        console.log(`   ✅ Job updated in ${Date.now() - updateStart}ms`);
      }

      console.log(`   ✅ EPG file ready: ID=${epgFile.id}, Name="${name}"`);

      // Filter out channels that already exist for this EPG (prevent P2002) and prepare updates
      const existingChannels = await prisma.channelLineup.findMany({
        where: { userId, epgFileId: epgFile.id },
        select: { id: true, name: true, tvgId: true }, // preserve user-updated name/logo/category; only compare id fields
      });
      const existingByTvgId = new Map(
        existingChannels
          .filter((ch) => ch.tvgId)
          .map((ch) => [ch.tvgId as string, ch])
      );
      const existingByName = new Map(
        existingChannels
          .filter((ch) => !ch.tvgId)
          .map((ch) => [ch.name, ch])
      );
      const channelsToInsert: any[] = [];
      const channelsToUpdate: { id: number; tvgId: string | null }[] = [];
      const matchedIds = new Set<number>();

      for (const ch of channels) {
        // Skip channels without tvgId (mandatory per requirement)
        if (!ch.tvgId) continue;
        const existing =
          (ch.tvgId && existingByTvgId.get(ch.tvgId)) ||
          (!ch.tvgId && existingByName.get(ch.name));

        if (existing) {
          matchedIds.add(existing.id);
          const newTvgId = ch.tvgId || null;
          if (existing.tvgId !== newTvgId) {
            channelsToUpdate.push({
              id: existing.id,
              tvgId: newTvgId,
            });
          }
          continue; // Already have it; preserve user-edited fields
        }

        channelsToInsert.push(ch);
      }

      if (channelsToUpdate.length > 0) {
        const UPDATE_BATCH = 200;
        for (let i = 0; i < channelsToUpdate.length; i += UPDATE_BATCH) {
          const batch = channelsToUpdate.slice(i, i + UPDATE_BATCH);
          await Promise.all(
            batch.map((ch) =>
              prisma.channelLineup.update({
                where: { id: ch.id },
                data: { tvgId: ch.tvgId }, // do not override name/logo/category
              })
            )
          );
        }
        console.log(
          `   🔄 Updated ${channelsToUpdate.length.toLocaleString()} existing channels`
        );
      }

      console.log(
        `   🧹 Filtered existing channels: ${channelsToInsert.length.toLocaleString()} to insert (skipped ${channels.length - channelsToInsert.length
        })`
      );
      channels = channelsToInsert;

      // Remove channels that were not matched to incoming data
      const missingIds = existingChannels
        .filter((ch) => !matchedIds.has(ch.id))
        .map((ch) => ch.id);
      if (missingIds.length > 0) {
        const DELETE_BATCH = 500;
        for (let i = 0; i < missingIds.length; i += DELETE_BATCH) {
          const chunk = missingIds.slice(i, i + DELETE_BATCH);
          await prisma.channelLineup.deleteMany({
            where: { id: { in: chunk } },
          });
        }
        console.log(
          `   🗑️ Removed ${missingIds.length.toLocaleString()} channels no longer present in EPG`
        );
      }

      // Import all channels in batches
      const BATCH_SIZE = 200; // Reduced to minimize connection usage
      // Resume safely: we've removed any rows that already exist, so start from 0
      const alreadyImported = currentJob?.importedChannels || 0;
      startFromChannel = 0;
      if (alreadyImported > 0) {
        console.log(
          `   ⚠️ Resume: ${alreadyImported} channels were previously imported. Starting fresh insert with remaining ${channels.length.toLocaleString()} new channels.`
        );
      }
      let imported = alreadyImported;
      let progressUpdateCounter = 0;

      const totalPlanned = imported + channels.length; // alreadyImported + remaining inserts

      for (let i = startFromChannel; i < channels.length; i += BATCH_SIZE) {
        const batch = channels.slice(
          i,
          Math.min(i + BATCH_SIZE, channels.length)
        );

        // Defensive: re-check DB for this batch to avoid unique constraint
        const batchNames = batch.map((ch: any) => ch.name);
        const existingBatch = await prisma.channelLineup.findMany({
          where: { userId, epgFileId: epgFile.id, name: { in: batchNames } },
          select: { name: true },
        });
        const existingSet = new Set(existingBatch.map((e) => e.name));
        const batchToInsert = batch.filter((ch: any) => !existingSet.has(ch.name));

        if (batchToInsert.length === 0) {
          console.log(
            `   ⏭️ Batch ${Math.floor(i / BATCH_SIZE) + 1} skipped (all ${batch.length} already exist)`
          );
          continue;
        }

        // Import batch with fallback to per-row upsert on duplicate
        try {
          await prisma.channelLineup.createMany({
            data: batchToInsert.map((ch: any, idx: number) => ({
              userId: userId,
              epgFileId: epgFile.id,
              name: ch.name,
              tvgId: ch.tvgId,
              tvgLogo: ch.tvgLogo || null,
              extGrp: "Imported channels",
              sortOrder: i + idx,
            })),
          });
        } catch (err: any) {
          console.warn(
            `   ⚠️ createMany failed for batch ${Math.floor(i / BATCH_SIZE) + 1} (${batchToInsert.length} rows). Falling back to per-row upsert. Error: ${err?.message}`
          );
          // Fallback: per-row upsert to avoid unique conflicts
          for (const ch of batchToInsert) {
            try {
              await prisma.channelLineup.upsert({
                where: {
                  userId_epgFileId_name: {
                    userId,
                    epgFileId: epgFile.id,
                    name: ch.name,
                  },
                },
                update: {
                  tvgId: ch.tvgId, // do not override name/logo/category
                },
                create: {
                  userId,
                  epgFileId: epgFile.id,
                  name: ch.name,
                  tvgId: ch.tvgId,
                  tvgLogo: ch.tvgLogo || null,
                  extGrp: "Imported channels",
                  sortOrder: i, // approximate order; not critical
                },
              });
            } catch (innerErr: any) {
              console.error(
                `   ❌ Upsert failed for name="${ch.name}": ${innerErr?.message}`
              );
            }
          }
        }

        imported += batchToInsert.length;
        progressUpdateCounter++;

        // Update progress every 5 batches to reduce DB calls
        if (progressUpdateCounter >= 5 || imported >= totalPlanned) {
          const progress = Math.min(
            65 + Math.floor((imported / totalPlanned) * 30),
            99
          );
          await this.updateJob(jobId, {
            importedChannels: imported,
            progress,
            importProgress: Math.min(
              100,
              Math.floor((imported / totalPlanned) * 100)
            ),
            message: `Imported ${imported.toLocaleString()}/${totalPlanned.toLocaleString()} channels...`,
          } as any);
          progressUpdateCounter = 0;

          console.log(
            `✅ Imported ${imported}/${totalPlanned} channels for job ${jobId}`
          );
        }

        // Check if we're running out of time (leave 2s buffer)
        const elapsed = Date.now() - startTime;
        if (elapsed > maxDuration - 2000) {
          // Final progress update before timeout
          const progress = Math.min(
            65 + Math.floor((imported / totalPlanned) * 30),
            99
          );
          await this.updateJob(jobId, {
            importedChannels: imported,
            progress,
            importProgress: Math.min(
              100,
              Math.floor((imported / totalPlanned) * 100)
            ),
            message: `Imported ${imported.toLocaleString()}/${totalPlanned.toLocaleString()} channels... (continuing)`,
          } as any);
          console.log(
            `⏱️ Time limit approaching (${elapsed}ms), saved progress at ${imported}/${channels.length} channels`
          );
          return false; // Continue in next invocation
        }
      }

      // CRITICAL: Update database statistics after bulk insert
      // This helps PostgreSQL query planner use indexes efficiently
      console.log(`[EPG Job ${jobId}] Updating database statistics...`);
      await prisma.$executeRawUnsafe('ANALYZE "channel_lineup"');
      console.log(`[EPG Job ${jobId}] Database statistics updated`);
      
      // Mark as complete
      // Update EPG file metadata (lastSyncedAt & channelCount)
      try {
        await prisma.epgFile.update({
          where: { id: epgFile.id },
          data: {
            lastSyncedAt: new Date(),
            channelCount: imported,
          },
        });
      } catch (metaErr) {
        console.warn(
          `[EPG Job ${jobId}] Warning: failed to update epgFile metadata`,
          metaErr
        );
      }

      await this.updateJob(jobId, {
        status: "completed",
        progress: 100,
        downloadProgress: 100,
        importProgress: 100,
        message: `Successfully imported ${imported.toLocaleString()} channels`,
        importedChannels: imported,
      });

      console.log(`✅ Completed job ${jobId} - imported ${imported} channels`);
      return true;
    } catch (error: any) {
      console.error(`❌ Job ${jobId} failed:`, error);
      await this.updateJob(jobId, {
        status: "failed",
        error: error.message || "Unknown error",
        message: `Failed: ${error.message || "Unknown error"}`,
      });
      return true; // Job finished (with error)
    }
  }

  /**
   * Clean up old completed/failed jobs (older than 24 hours)
   */
  static async cleanupOldJobs(): Promise<void> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    await prisma.epgImportJob.deleteMany({
      where: {
        status: { in: ["completed", "failed"] },
        updatedAt: { lt: oneDayAgo },
      },
    });
  }

  /**
   * Kill all stuck/orphaned import jobs on startup
   * This runs when the server starts to clean up any jobs that were in progress
   * when the server was last shut down or restarted
   */
  static async killStuckJobsOnStartup(): Promise<void> {
    try {
      console.log("🧹 Checking for stuck EPG import jobs...");

      // Find all jobs that are in progress
      const stuckJobs = await prisma.epgImportJob.findMany({
        where: {
          status: { in: ["pending", "downloading", "parsing", "importing"] },
        },
      });

      if (stuckJobs.length === 0) {
        console.log("✅ No stuck EPG import jobs found");
        return;
      }

      console.log(`⚠️ Found ${stuckJobs.length} stuck EPG import job(s), cleaning up...`);

      // Mark all as failed
      for (const job of stuckJobs) {
        await this.updateJob(job.id, {
          status: "failed",
          error: "Server restarted",
          message: "Import was interrupted by server restart. Please try again.",
        });

        // Clean up any orphaned EPG file from this job
        if (job.epgFileId) {
          await this.cleanupOrphanedEpgFile(job.epgFileId, job.userId);
        }

        console.log(`   ✅ Cleaned up stuck job ${job.id} (${job.name})`);
      }

      console.log(`✅ Cleaned up ${stuckJobs.length} stuck EPG import job(s)`);
    } catch (error) {
      console.error("⚠️ Failed to cleanup stuck EPG import jobs:", error);
    }
  }

  /**
   * Clean up a specific orphaned EPG file (if it has no channels)
   */
  private static async cleanupOrphanedEpgFile(
    epgFileId: number,
    userId: number
  ): Promise<void> {
    try {
      // Check if this EPG file has any channels
      const channelCount = await prisma.channelLineup.count({
        where: {
          userId,
          epgFileId,
        },
      });

      if (channelCount === 0) {
        // No channels, safe to delete
        await prisma.epgFile.delete({
          where: { id: epgFileId },
        });
        console.log(
          `🧹 Cleaned up orphaned EPG file ${epgFileId} (0 channels)`
        );
      }
    } catch (error) {
      console.error(
        `⚠️ Failed to cleanup orphaned EPG file ${epgFileId}:`,
        error
      );
    }
  }

  /**
   * Clean up all orphaned EPG files for a user
   * (EPG files with 0 channels or associated with old failed jobs)
   */
  private static async cleanupOrphanedEpgFiles(userId: number): Promise<void> {
    try {
      // Find all EPG files for this user
      const epgFiles = await prisma.epgFile.findMany({
        where: { userId },
        select: { id: true, name: true },
      });

      for (const epgFile of epgFiles) {
        // Check if this EPG file has any channels
        const channelCount = await prisma.channelLineup.count({
          where: {
            userId,
            epgFileId: epgFile.id,
          },
        });

        if (channelCount === 0) {
          // Check if there's any successful or in-progress job for this EPG
          const activeOrCompletedJob = await prisma.epgImportJob.findFirst({
            where: {
              userId,
              epgFileId: epgFile.id,
              status: {
                in: [
                  "completed",
                  "pending",
                  "downloading",
                  "parsing",
                  "importing",
                ],
              },
            },
          });

          // If no active/completed job and no channels, it's orphaned
          if (!activeOrCompletedJob) {
            await prisma.epgFile.delete({
              where: { id: epgFile.id },
            });
            console.log(
              `🧹 Cleaned up orphaned EPG file "${epgFile.name}" (ID: ${epgFile.id})`
            );
          }
        }
      }
    } catch (error) {
      console.error(
        `⚠️ Failed to cleanup orphaned EPG files for user ${userId}:`,
        error
      );
    }
  }
}
