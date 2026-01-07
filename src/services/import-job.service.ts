import prisma from "../database/prisma";
import { PlaylistRepository } from "../repositories/playlist.repository";

interface ImportChannel {
  channelId: any;
  channelName?: string;
  tvgName?: string;
}

interface UpdateBatchItem {
  streamId: string;
  mapping: string;
}

export class ImportJobService {
  /**
   * Create a new import job and store imported data
   */
  static async createJob(
    userId: number,
    playlistId: number,
    importedChannels: ImportChannel[]
  ): Promise<number> {
    // Check for existing in-progress job
    const existingJob = await prisma.importJob.findFirst({
      where: {
        userId,
        playlistId,
        status: { in: ["pending", "processing"] },
      },
    });

    if (existingJob) {
      throw new Error("An import is already in progress for this playlist.");
    }

    // Store imported channels as JSON
    const importData = JSON.stringify(importedChannels);

    const job = await prisma.importJob.create({
      data: {
        userId,
        playlistId,
        status: "pending",
        progress: 0,
        totalMappings: importedChannels.length,
        importData: importData,
        message: `Preparing to import ${importedChannels.length} channel mappings...`,
      },
    });

    console.log(
      `[Import Job ${job.id}] Created with ${importedChannels.length} channels to import`
    );
    return job.id;
  }

  /**
   * Process import in chunks (safe for serverless 10s timeout)
   */
  static async processImportChunk(
    jobId: number,
    maxDuration: number = 8000
  ): Promise<boolean> {
    const startTime = Date.now();
    let job = await prisma.importJob.findUnique({ where: { id: jobId } });

    if (!job) {
      console.error(`Import job ${jobId} not found.`);
      return true; // Stop processing
    }

    // Retrieve imported channels from job data
    if (!job.importData) {
      throw new Error("Import data not found in job record");
    }

    const importedChannels: ImportChannel[] = JSON.parse(job.importData);

    try {
      // Get playlist and determine which EPG files to use
      const playlist = await prisma.playlist.findUnique({
        where: { id: job.playlistId },
      });

      if (!playlist) {
        throw new Error("Playlist not found");
      }

      // Phase 1: Initial setup - get lineup and playlist channels
      if (job.status === "pending") {
        await prisma.importJob.update({
          where: { id: jobId },
          data: {
            status: "processing",
            progress: 5,
            message: "Loading playlist channels and EPG data...",
            updatedAt: new Date(),
          },
        });

        console.log(
          `[Import Job ${jobId}] Started processing ${importedChannels.length} mappings`
        );
      }

      // Get all channels from the playlist
      const playlistChannels = await PlaylistRepository.getChannels(
        job.playlistId
      );

      // Apply playlist filters: hidden categories and excluded channels
      let hiddenCategoryIds: string[] = [];
      let excludedChannelIds: string[] = [];
      const includeUncategorized =
        playlist.includeUncategorizedChannels !== undefined
          ? playlist.includeUncategorizedChannels !== 0
          : true;

      if (playlist.hiddenCategories) {
        try {
          const parsed = JSON.parse(playlist.hiddenCategories as any);
          if (Array.isArray(parsed)) {
            hiddenCategoryIds = parsed;
          }
        } catch (e) {
          hiddenCategoryIds = [];
        }
      }

      if (playlist.excludedChannels) {
        try {
          const parsed = JSON.parse(playlist.excludedChannels as any);
          if (Array.isArray(parsed)) {
            excludedChannelIds = parsed;
          }
        } catch (e) {
          excludedChannelIds = [];
        }
      }

      const filteredPlaylistChannels = playlistChannels.filter((ch) => {
        // Exclude channels explicitly excluded
        if (excludedChannelIds.includes(ch.streamId)) return false;

        // Exclude hidden categories
        if (hiddenCategoryIds.length > 0) {
          if (ch.categoryId) {
            if (hiddenCategoryIds.includes(ch.categoryId)) return false;
          } else if (!includeUncategorized) {
            // If uncategorized and uncategorized not included, skip
            return false;
          }
        }

        return true;
      });

      // Get EPG file IDs for this playlist
      let epgFileIds: number[] = [];
      if (playlist.epgFileId) {
        epgFileIds = [playlist.epgFileId];
      } else if (playlist.epgGroupId) {
        const groupFiles = await prisma.epgFile.findMany({
          where: { epgGroupId: playlist.epgGroupId },
          select: { id: true },
        });
        epgFileIds = groupFiles.map((f) => f.id);
      } else {
        const defaultEpgFile = await prisma.epgFile.findFirst({
          where: { userId: job.userId, isDefault: true },
          select: { id: true },
        });
        const defaultEpgGroup = await prisma.epgGroup.findFirst({
          where: { userId: job.userId, isDefault: true },
          select: { id: true },
        });
        if (defaultEpgFile) {
          epgFileIds = [defaultEpgFile.id];
        } else if (defaultEpgGroup) {
          const groupFiles = await prisma.epgFile.findMany({
            where: { epgGroupId: defaultEpgGroup.id },
            select: { id: true },
          });
          epgFileIds = groupFiles.map((f) => f.id);
        }
      }

      // Get channel lineup
      const channelLineup = await prisma.channelLineup.findMany({
        where: {
          userId: job.userId,
          ...(epgFileIds.length > 0 && { epgFileId: { in: epgFileIds } }),
        },
        select: {
          name: true,
          tvgLogo: true,
          tvgId: true,
          extGrp: true,
        },
      });

      const lineupMap = new Map(
        channelLineup.map((ch) => [
          ch.name.toLowerCase(),
          { logo: ch.tvgLogo, tvgId: ch.tvgId, extGrp: ch.extGrp },
        ])
      );

      // Extract identifier helper function
      const extractIdentifier = (channel: any): string => {
        const source = playlist.identifierSource || "channel-name";
        const regex = playlist.identifierRegex;
        const metadataKey = playlist.identifierMetadataKey;

        if (source === "stream-url" && regex && channel.streamUrl) {
          const match = channel.streamUrl.match(new RegExp(regex));
          return match ? match[1] || match[0] : channel.streamId;
        } else if (source === "metadata" && metadataKey) {
          const keyMap: Record<string, string> = {
            "tvg-name": "tvgName",
            "tvg-id": "tvgId",
            "tvg-logo": "tvgLogo",
            "group-title": "groupTitle",
            "tvg-rec": "tvgRec",
            "tvg-chno": "tvgChno",
            "catchup-days": "catchupDays",
            "catchup-source": "catchupSource",
            "catchup-correction": "catchupCorrection",
            "xui-id": "xuiId",
          };
          const actualKey = keyMap[metadataKey] || metadataKey;
          return channel[actualKey] || channel.streamId;
        } else if (source === "channel-name" && regex && channel.name) {
          const match = channel.name.match(new RegExp(regex));
          return match ? match[1] || match[0] : channel.streamId;
        }
        return channel.streamId;
      };

      // Phase 2: Match channels and prepare updates
      const updateBatch: UpdateBatchItem[] = [];
      const channelsInJsonNotInPlaylist: Array<{ channelName: string; channelId: any }> = [];
      const channelsInPlaylistNotInJson: Array<{ channelName: string; channelId: string }> = [];
      let notFoundCount = 0;

      // Track which playlist channels were matched
      const matchedPlaylistChannels = new Set<string>();

      for (const importedChannel of importedChannels) {
        if (!importedChannel.channelId) continue;

        // Try to find matching channel
        let matchingChannel = filteredPlaylistChannels.find((ch) => {
          const channelIdentifier = extractIdentifier(ch);
          return channelIdentifier === String(importedChannel.channelId);
        });

        // Fallback strategies
        if (!matchingChannel) {
          matchingChannel = filteredPlaylistChannels.find(
            (ch) => ch.streamId === String(importedChannel.channelId)
          );
        }
        if (!matchingChannel && importedChannel.tvgName) {
          matchingChannel = filteredPlaylistChannels.find(
            (ch) => ch.tvgName === importedChannel.tvgName
          );
        }

        if (!matchingChannel) {
          // Channel from JSON not found in playlist
          notFoundCount++;
          channelsInJsonNotInPlaylist.push({
            channelName: importedChannel.channelName || importedChannel.tvgName || 'Unknown',
            channelId: importedChannel.channelId
          });
          continue;
        }

        if (!importedChannel.channelName) {
          notFoundCount++;
          continue;
        }

        // Look up optional lineup info (best effort)
        const lineupEntry = importedChannel.channelName
          ? lineupMap.get(importedChannel.channelName.toLowerCase())
          : undefined;

        // Create mapping (do not fail if lineup info is missing)
        const mapping = JSON.stringify({
          name: importedChannel.channelName,
          logo: lineupEntry?.logo || "",
          extGrp: lineupEntry?.extGrp || "",
          tvgId: lineupEntry?.tvgId || "",
        });

        updateBatch.push({
          streamId: matchingChannel.streamId,
          mapping: mapping,
        });

        // Mark this playlist channel as matched
        matchedPlaylistChannels.add(matchingChannel.streamId);
      }

      // Find channels in playlist that were not in the JSON import
      // Only include channels that have identifiers matching the import format
      for (const playlistChannel of filteredPlaylistChannels) {
        if (!matchedPlaylistChannels.has(playlistChannel.streamId)) {
          const channelIdentifier = extractIdentifier(playlistChannel);
          // Only add if it has a valid identifier (not just the default streamId)
          if (channelIdentifier && channelIdentifier !== playlistChannel.streamId) {
            channelsInPlaylistNotInJson.push({
              channelName: playlistChannel.name,
              channelId: channelIdentifier
            });
          }
        }
      }

      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          totalMappings: updateBatch.length,
          notFound: notFoundCount,
          channelsInJsonNotInPlaylist: JSON.stringify(channelsInJsonNotInPlaylist),
          channelsInPlaylistNotInJson: JSON.stringify(channelsInPlaylistNotInJson),
          progress: 30,
          message: `Prepared ${updateBatch.length} mappings. Applying in batches...`,
          updatedAt: new Date(),
        },
      });

      console.log(
        `[Import Job ${jobId}] Prepared ${updateBatch.length} mappings, ${notFoundCount} not found`
      );
      console.log(
        `[Import Job ${jobId}] - ${channelsInJsonNotInPlaylist.length} from JSON not in playlist`
      );
      console.log(
        `[Import Job ${jobId}] - ${channelsInPlaylistNotInJson.length} from playlist not in JSON`
      );

      // Phase 3: Apply updates in batches
      // Keep batch size small to avoid connection contention
      const BATCH_SIZE = 10; // Process 10 mappings at a time
      const startIndex = job.processedMappings || 0;

      for (let i = startIndex; i < updateBatch.length; i += BATCH_SIZE) {
        // Check time remaining
        if (Date.now() - startTime > maxDuration) {
          console.log(
            `[Import Job ${jobId}] Time limit reached, processed ${i}/${updateBatch.length}`
          );
          await prisma.importJob.update({
            where: { id: jobId },
            data: {
              processedMappings: i,
              mapped: i,
              progress: Math.floor((i / updateBatch.length) * 70) + 30,
              message: `Processing batch ${
                Math.floor(i / BATCH_SIZE) + 1
              }/${Math.ceil(updateBatch.length / BATCH_SIZE)}...`,
              updatedAt: new Date(),
            },
          });
          return false; // Continue processing in next poll
        }

        const batch = updateBatch.slice(i, i + BATCH_SIZE);

        await Promise.all(
          batch.map((item) =>
            prisma.channel.updateMany({
              where: {
                playlistId: job.playlistId,
                streamId: item.streamId,
              },
              data: {
                channelMapping: item.mapping,
              },
            })
          )
        );

        const processed = i + batch.length;
        await prisma.importJob.update({
          where: { id: jobId },
          data: {
            processedMappings: processed,
            mapped: processed,
            progress: Math.floor((processed / updateBatch.length) * 70) + 30,
            message: `Updated batch ${
              Math.floor(i / BATCH_SIZE) + 1
            }/${Math.ceil(updateBatch.length / BATCH_SIZE)}...`,
            updatedAt: new Date(),
          },
        });

        console.log(
          `[Import Job ${jobId}] Batch ${
            Math.floor(i / BATCH_SIZE) + 1
          }/${Math.ceil(
            updateBatch.length / BATCH_SIZE
          )} complete (${processed}/${updateBatch.length})`
        );
      }

      // CRITICAL: Update database statistics after bulk update
      // This helps PostgreSQL query planner use indexes efficiently
      console.log(`[Import Job ${jobId}] Updating database statistics...`);
      await prisma.$executeRawUnsafe('ANALYZE "channels"');
      console.log(`[Import Job ${jobId}] Database statistics updated`);
      
      // Mark as completed
      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: "completed",
          progress: 100,
          processedMappings: updateBatch.length,
          mapped: updateBatch.length,
          message: `Import complete: ${updateBatch.length} channels mapped, ${notFoundCount} not found`,
          updatedAt: new Date(),
        },
      });

      console.log(
        `[Import Job ${jobId}] Completed: ${updateBatch.length} mapped, ${notFoundCount} not found`
      );
      return true; // Done!
    } catch (error: any) {
      console.error(`[Import Job ${jobId}] Error:`, error);
      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          error: error.message,
          message: `Import failed: ${error.message}`,
          updatedAt: new Date(),
        },
      });
      throw error;
    }
  }

  /**
   * Get job status
   */
  static async getJobStatus(jobId: number) {
    return await prisma.importJob.findUnique({
      where: { id: jobId },
    });
  }
}
