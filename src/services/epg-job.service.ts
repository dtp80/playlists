import prisma from "../database/prisma";
import { EPGService, EPGFileTooLargeError } from "./epg.service";
import fs from "fs";
import os from "os";
import path from "path";
import axios from "axios";

// Track in-flight downloads so we don't block the poll response
const inFlightDownloads: Map<number, Promise<void>> = new Map();
// Track corruption retries per job to avoid infinite loops
const downloadRetries: Map<number, number> = new Map();

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
    // SQLite can transiently lock and raise P1008 under heavy writes.
    // Retry a few times with backoff to avoid crashing the job loop.
    const MAX_ATTEMPTS = 5;
    let attempt = 0;
    while (true) {
      try {
        await prisma.epgImportJob.update({
          where: { id },
          data,
        });
        return;
      } catch (err: any) {
        const isTimeout = err?.code === "P1008";
        attempt += 1;
        if (!isTimeout || attempt >= MAX_ATTEMPTS) {
          throw err;
        }
        const backoff = 100 * attempt; // simple linear backoff
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
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
      const tempDir = path.join(os.tmpdir(), "epg-jobs");
      const xmlPath = path.join(tempDir, `job-${jobId}.xmltv`);
      const channelsPath = path.join(tempDir, `job-${jobId}.channels.json`);
      await fs.promises.mkdir(tempDir, { recursive: true });

      const loadCachedChannels = async (): Promise<any[] | null> => {
        if (fs.existsSync(channelsPath)) {
          const raw = await fs.promises.readFile(channelsPath, "utf-8");
          return JSON.parse(raw);
        }
        return null;
      };

      const cleanTempFiles = async () => {
        await Promise.all([
          fs.promises.rm(xmlPath, { force: true }).catch(() => {}),
          fs.promises.rm(channelsPath, { force: true }).catch(() => {}),
        ]);
      };

      const bufferDownloadFallback = async (): Promise<boolean> => {
        try {
          const resp = await axios.get<ArrayBufferLike>(job.url, {
            responseType: "arraybuffer",
            timeout: 120000,
            maxRedirects: 5,
            headers: {
              "User-Agent": "IPTV-Playlist-Manager/1.0",
              Accept: "application/xml, text/xml, application/octet-stream, */*",
              // Avoid compression issues; we'll handle gzip manually if needed
              "Accept-Encoding": "identity",
            },
          });
          await fs.promises.mkdir(path.dirname(xmlPath), { recursive: true });
          await fs.promises.writeFile(xmlPath, Buffer.from(resp.data));
          return true;
        } catch (e) {
          console.warn(`   ⚠️ Buffer download fallback failed: ${(e as any)?.message || e}`);
          return false;
        }
      };

      const isCorruptGzipError = (err: any) => {
        const msg = (err?.message || "").toLowerCase();
        return err?.code === "Z_BUF_ERROR" || msg.includes("unexpected end of file");
      };

      const parseAndCache = async (): Promise<any[]> => {
        try {
          const channels = await EPGService.parseEPGFromFile(xmlPath, async (read, total) => {
            // Map parse progress softly into 30-40 range if download already complete
            if (total) {
              const progress = 30 + Math.min(10, Math.floor((read / total) * 10));
              await this.updateJob(jobId, {
                progress,
                downloadProgress: 100,
                message: `Parsing EPG... ${((read / (1024 * 1024)) || 0).toFixed(1)}MB`,
              } as any);
            }
          });
          await fs.promises.writeFile(channelsPath, JSON.stringify(channels));
          return channels;
        } catch (err: any) {
          if (isCorruptGzipError(err)) {
            const retry = (downloadRetries.get(jobId) || 0) + 1;
            downloadRetries.set(jobId, retry);
            console.warn(
              `   ⚠️ Corrupted EPG download detected (retry ${retry}). Error: ${err.message}`
            );
            await cleanTempFiles();
            // Try a one-time buffer download fallback before counting a retry
            const fallbackOk = await bufferDownloadFallback();
            if (fallbackOk) {
              try {
                const channels = await parseAndCache();
                downloadRetries.delete(jobId);
                return channels;
              } catch (innerErr: any) {
                if (!isCorruptGzipError(innerErr)) throw innerErr;
              }
            }

            if (retry >= 3) {
              await this.updateJob(jobId, {
                status: "failed",
                progress: 40,
                downloadProgress: 0,
                message: "EPG download corrupted repeatedly. Please retry later.",
                error: err.message,
              });
              return [];
            }
            await this.updateJob(jobId, {
              status: "pending",
              progress: 0,
              downloadProgress: 0,
              message: `EPG download corrupted. Retrying (${retry}/3)...`,
            });
            return [];
          }
          throw err;
        }
      };

      const ensureDownloadOnce = async () => {
        if (fs.existsSync(xmlPath)) return true;

        // If a download is already in-flight, just return and let polling continue
        if (inFlightDownloads.has(jobId)) {
          return false;
        }

        console.log(`   📥 Downloading EPG once to ${xmlPath}`);

        const downloadPromise = (async () => {
          try {
            await this.updateJob(jobId, {
              status: "downloading",
              progress: 5,
              message: "Downloading EPG file...",
            });

            // Download without stepwise progress updates (avoid EOF-trigger loops)
            await EPGService.downloadToTempFile(job.url, xmlPath, undefined);

            await this.updateJob(jobId, {
              downloadProgress: 100,
              progress: 40,
              message: "Download complete. Parsing...",
            } as any);
          } catch (err) {
            await this.updateJob(jobId, {
              status: "failed",
              error: (err as any)?.message || "Download failed",
              message: `Download failed: ${(err as any)?.message || "Unknown error"}`,
            });
          } finally {
            inFlightDownloads.delete(jobId);
          }
        })();

        inFlightDownloads.set(jobId, downloadPromise);
        return false; // indicate that download is in-flight
      };

      const getChannels = async (): Promise<any[]> => {
        const cached = await loadCachedChannels();
        if (cached) return cached;
        const ready = await ensureDownloadOnce();
        if (!ready) {
          // Download still in-flight; let caller return and poll again
          return [];
        }
        if (fs.existsSync(xmlPath)) {
          const channels = await parseAndCache();
          return channels;
        }
        // If download claims done but file missing, fail fast to avoid loops
        await this.updateJob(jobId, {
          status: "failed",
          progress: 0,
          downloadProgress: 0,
          message: "EPG file missing after download. Please retry.",
        });
        return [];
      };

      // PHASE: prepare channels (no re-downloads on resume)
      let channels: any[] | null = null;
      if (job.status === "pending" || job.status === "downloading" || job.status === "parsing") {
        console.log(`   📥 Preparing channels (download+parse once, then cache)...`);
        channels = await getChannels();
        if (!channels || channels.length === 0) {
          console.log(`   ⏳ Download still in progress; will continue next poll`);
          return false;
        }
        await this.updateJob(jobId, {
          status: "importing",
          progress: Math.max(40, job.progress || 0),
          downloadProgress: 100,
          importProgress: 0,
          message: `Parsed ${channels.length.toLocaleString()} channels. Importing...`,
          totalChannels: channels.length,
        } as any);
      } else if (job.status === "importing") {
        console.log(`   📦 Resume import without re-downloading...`);
        channels = await getChannels();
        if (!channels || channels.length === 0) {
          console.log(`   ⏳ Download still in progress; will continue next poll`);
          return false;
        }
        if (!job.totalChannels) {
          await this.updateJob(jobId, {
            totalChannels: channels.length,
          });
        }
      } else {
        console.log(`   ⚠️ Job is in unexpected state: ${job.status}`);
        console.log(`<<< 🔄 processImportChunk END (no action needed) <<<\n`);
        return true;
      }

      // Import phase
      return await this.importChannelsBatch(
        jobId,
        channels,
        job.userId,
        job.name,
        job.url,
        startTime,
        maxDuration,
        { xmlPath, channelsPath }
      );
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
    maxDuration: number,
    tempPaths?: { xmlPath: string; channelsPath: string }
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
    const totalUniqueChannels = deduped.length;
    console.log(
      `   🧹 Deduplicated channels by tvgId/name: ${deduped.length.toLocaleString()} remaining (was ${channels.length.toLocaleString()})`
    );
    channels = deduped;

    const cleanupTemp = async () => {
      if (!tempPaths) return;
      try {
        await fs.promises.rm(tempPaths.channelsPath, { force: true });
        await fs.promises.rm(tempPaths.xmlPath, { force: true });
      } catch (e) {
        // best-effort
      }
    };

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

      const totalPlanned = totalUniqueChannels; // total unique channels seen in this file

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
      // Update EPG file metadata (lastSyncedAt & channelCount = total unique, not just new)
      try {
        await prisma.epgFile.update({
          where: { id: epgFile.id },
          data: {
            lastSyncedAt: new Date(),
            channelCount: totalUniqueChannels,
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
        message: `Successfully imported ${imported.toLocaleString()} new / ${totalUniqueChannels.toLocaleString()} total channels`,
        importedChannels: imported,
      });

      console.log(`✅ Completed job ${jobId} - imported ${imported} channels`);
      await cleanupTemp();
      return true;
    } catch (error: any) {
      console.error(`❌ Job ${jobId} failed:`, error);
      await this.updateJob(jobId, {
        status: "failed",
        error: error.message || "Unknown error",
        message: `Failed: ${error.message || "Unknown error"}`,
      });
      await cleanupTemp();
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
