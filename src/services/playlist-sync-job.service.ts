import prisma from "../database/prisma";
import { XtreamService } from "./xtream.service";
import { M3UService } from "./m3u.service";
import { PlaylistRepository } from "../repositories/playlist.repository";
import { Channel, Category } from "@prisma/client";

export class PlaylistSyncJobService {
  /**
   * Create a new playlist sync job
   */
  static async createJob(
    userId: number,
    playlistId: number,
    categoryFilters?: string[]
  ): Promise<number> {
    // Check if there's already a pending/active job for this playlist
    const existingJob = await prisma.playlistSyncJob.findFirst({
      where: {
        playlistId,
        status: { in: ["pending", "syncing", "saving"] },
      },
    });

    if (existingJob) {
      throw new Error(
        "A sync is already in progress for this playlist. Please wait for it to complete."
      );
    }

    const job = await prisma.playlistSyncJob.create({
      data: {
        userId,
        playlistId,
        status: "pending",
        progress: 0,
        categoryFilters: categoryFilters
          ? JSON.stringify(categoryFilters)
          : null,
      },
    });

    return job.id;
  }

  /**
   * Process sync job in chunks to keep each polling request short
   */
  static async processSyncChunk(
    jobId: number,
    maxDuration: number = 8000
  ): Promise<boolean> {
    const startTime = Date.now();
    const job = await prisma.playlistSyncJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new Error("Sync job not found");
    }

    try {
      // Phase 1: Sync with provider (fetch categories and channels)
      if (job.status === "pending" || job.status === "syncing") {
        await prisma.playlistSyncJob.update({
          where: { id: jobId },
          data: {
            status: "syncing",
            progress: 10,
            message: "Syncing with provider...",
            updatedAt: new Date(),
          },
        });

        // Get playlist info
        const playlist = await prisma.playlist.findUnique({
          where: { id: job.playlistId },
        });

        if (!playlist) {
          throw new Error("Playlist not found");
        }

        console.log(
          `[Sync Job ${jobId}] Starting sync for playlist ${playlist.name}`
        );

        // Sync with provider (download phase only)
        let categories: Category[], channels: Channel[];

        if (playlist.type === "xtream") {
          if (!playlist.username || !playlist.password) {
            throw new Error("Missing Xtream credentials");
          }

          // Parse category filters (optional)
          let selectedCategories: string[] | undefined;
          if (job.categoryFilters) {
            try {
              const parsed = JSON.parse(job.categoryFilters);
              if (Array.isArray(parsed) && parsed.length > 0) {
                selectedCategories = parsed;
              }
            } catch (e) {
              // ignore parse errors
            }
          }

          const result = await XtreamService.syncPlaylist(
            job.playlistId,
            {
              url: playlist.url,
              username: playlist.username,
              password: playlist.password,
            },
            selectedCategories
          );

          categories = result.categories;
          channels = result.channels;
        } else if (playlist.type === "m3u") {
          const result = await M3UService.syncPlaylist(
            job.playlistId,
            playlist.url
          );
          categories = result.categories;
          channels = result.channels;
        } else {
          throw new Error("Unknown playlist type");
        }

        console.log(
          `[Sync Job ${jobId}] Fetched ${channels.length} channels, ${categories.length} categories`
        );

        // Update job with totals
        // Persist fetched data so retries do not hit provider again
        await prisma.playlistSyncJob.update({
          where: { id: jobId },
          data: {
            status: "saving",
            progress: 30,
            totalChannels: channels.length,
            totalCategories: categories.length,
            message: `Fetched ${channels.length} channels, now saving...`,
            channelsData: JSON.stringify(channels),
            categoriesData: JSON.stringify(categories),
            updatedAt: new Date(),
          },
        });

        // Save categories (fast). If filters are used, preserve existing categories so others are not removed.
        console.log(`[Sync Job ${jobId}] Saving categories...`);
        const preserveExisting = !!job.categoryFilters;
        await PlaylistRepository.saveCategories(
          job.playlistId,
          categories,
          preserveExisting
        );

        // Start saving channels in batches
        return await this.saveChannelsBatch(
          jobId,
          channels,
          startTime,
          maxDuration
        );
      }

      // Phase 2: Continue saving channels from where we left off
      if (job.status === "saving") {
        console.log(`[Sync Job ${jobId}] Resuming channel save...`);

        // Use cached data from the job to avoid re-fetching provider
        let channels: Channel[] = [];
        if (job.channelsData) {
          try {
            channels = JSON.parse(job.channelsData);
          } catch (e) {
            console.warn(
              `[Sync Job ${jobId}] Failed to parse cached channelsData, falling back to refetch`
            );
          }
        }

        // Fallback to refetch only if cache missing/broken
        if (!channels.length) {
          const playlist = await prisma.playlist.findUnique({
            where: { id: job.playlistId },
          });

          if (!playlist) {
            throw new Error("Playlist not found");
          }

          if (playlist.type === "xtream") {
            const result = await XtreamService.syncPlaylist(job.playlistId, {
              url: playlist.url,
              username: playlist.username!,
              password: playlist.password!,
            });
            channels = result.channels;
          } else {
            const result = await M3UService.syncPlaylist(
              job.playlistId,
              playlist.url
            );
            channels = result.channels;
          }
        }

        return await this.saveChannelsBatch(
          jobId,
          channels,
          startTime,
          maxDuration
        );
      }

      // Job completed or in unexpected state
      console.log(
        `[Sync Job ${jobId}] Job already in final state: ${job.status}`
      );
      return true;
    } catch (error: any) {
      console.error(`[Sync Job ${jobId}] Error:`, error);
      await prisma.playlistSyncJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          error: error.message,
          updatedAt: new Date(),
        },
      });
      throw error;
    }
  }

  /**
   * Save channels in batches with mapping preservation
   */
  private static async saveChannelsBatch(
    jobId: number,
    channels: Channel[],
    startTime: number,
    maxDuration: number
  ): Promise<boolean> {
    const job = await prisma.playlistSyncJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new Error("Sync job not found");
    }

    const BATCH_SIZE = 5000;
    const startIndex = job.savedChannels || 0;

    // CRITICAL: Preserve user mappings before deleting channels
    // Only do this on first batch
    let mappingMap = new Map<string, string>();
    if (startIndex === 0) {
      console.log(
        `[Sync Job ${jobId}] Fetching existing channel mappings...`
      );
      const existingMappings = await prisma.channel.findMany({
        where: {
          playlistId: job.playlistId,
          channelMapping: { not: null },
        },
        select: {
          streamId: true,
          channelMapping: true,
        },
      });

      mappingMap = new Map(
        existingMappings.map((m) => [m.streamId, m.channelMapping!])
      );
      console.log(
        `[Sync Job ${jobId}] Found ${mappingMap.size} existing mappings to preserve`
      );

      // Delete old channels
      console.log(`[Sync Job ${jobId}] Deleting old channels...`);
      await prisma.channel.deleteMany({
        where: { playlistId: job.playlistId },
      });
    }

    // Save channels in batches
    for (let i = startIndex; i < channels.length; i += BATCH_SIZE) {
      // Check if we're running out of time
      const elapsed = Date.now() - startTime;
      if (elapsed > maxDuration - 1500) {
        // Save progress and return false to continue in next poll
        const progress = Math.floor(30 + (i / channels.length) * 70);
        console.log(
          `[Sync Job ${jobId}] Time limit reached, saved ${i}/${channels.length} channels (${progress}%)`
        );
        await prisma.playlistSyncJob.update({
          where: { id: jobId },
          data: {
            savedChannels: i,
            progress,
            message: `Saving channels: ${i}/${channels.length}...`,
            updatedAt: new Date(),
          },
        });
        return false; // Not done yet, continue in next poll
      }

      const batch = channels.slice(i, i + BATCH_SIZE);
      console.log(
        `[Sync Job ${jobId}] Saving batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(channels.length / BATCH_SIZE)} (${batch.length} channels)...`
      );

      await prisma.channel.createMany({
        data: batch.map((ch) => {
          // CRITICAL: Restore user's custom mapping if it exists
          const existingMapping = mappingMap.get(ch.streamId) || null;
          // Preserve provider tvgId; don't overwrite with mapping
          const finalTvgId = ch.tvgId || null;

          return {
            playlistId: ch.playlistId,
            streamId: ch.streamId,
            name: ch.name,
            streamUrl: ch.streamUrl,
            streamIcon: ch.streamIcon || null,
            epgChannelId: ch.epgChannelId || null,
            categoryId: ch.categoryId || null,
            categoryName: ch.categoryName || null,
            added: ch.added || null,
            duration: ch.duration || null,
            tvgId: finalTvgId,
            tvgName: ch.tvgName || null,
            tvgLogo: ch.tvgLogo || null,
            groupTitle: ch.groupTitle || null,
            timeshift: ch.timeshift || null,
            tvgRec: ch.tvgRec || null,
            tvgChno: ch.tvgChno || null,
            catchup: ch.catchup || null,
            catchupDays: ch.catchupDays || null,
            catchupSource: ch.catchupSource || null,
            catchupCorrection: ch.catchupCorrection || null,
            xuiId: ch.xuiId || null,
            channelMapping: existingMapping,
          };
        }),
      });

      // Update progress
      const savedCount = i + batch.length;
      const progress = Math.floor(30 + (savedCount / channels.length) * 70);
      await prisma.playlistSyncJob.update({
        where: { id: jobId },
        data: {
          savedChannels: savedCount,
          progress,
          message: `Saved ${savedCount}/${channels.length} channels...`,
          updatedAt: new Date(),
        },
      });
    }

    // All done!
    console.log(`[Sync Job ${jobId}] All channels saved successfully`);
    
    // CRITICAL: Update database statistics after bulk insert
    // This helps PostgreSQL query planner use indexes efficiently
    console.log(`[Sync Job ${jobId}] Updating database statistics...`);
    await prisma.$executeRawUnsafe('ANALYZE "channels"');
    console.log(`[Sync Job ${jobId}] Database statistics updated`);
    
    await prisma.playlistSyncJob.update({
      where: { id: jobId },
      data: {
        status: "completed",
        progress: 100,
        savedChannels: channels.length,
        message: `Sync completed: ${channels.length} channels saved`,
        channelsData: null,
        categoriesData: null,
        updatedAt: new Date(),
      },
    });

    // Update playlist lastSyncedAt
    await prisma.playlist.update({
      where: { id: job.playlistId },
      data: { lastSyncedAt: new Date(), lastChannelsSyncedAt: new Date() },
    });

    return true; // Done!
  }

  /**
   * Get job status
   */
  static async getJobStatus(jobId: number) {
    return await prisma.playlistSyncJob.findUnique({
      where: { id: jobId },
    });
  }
}
