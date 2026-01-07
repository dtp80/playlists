import prisma, { getSyncTimeout } from "../database/prisma";
import { Playlist, Channel, Category } from "@prisma/client";

export class PlaylistRepository {
  /**
   * Create a new playlist
   */
  static async create(playlist: Playlist, userId: number): Promise<Playlist> {
    const created = await prisma.playlist.create({
      data: {
        userId,
        name: playlist.name,
        type: playlist.type,
        url: playlist.url,
        username: playlist.username || null,
        password: playlist.password || null,
      },
    });

    return (await this.findById(created.id, userId))!;
  }

  /**
   * Find playlist by ID (filtered by userId)
   */
  static async findById(
    id: number,
    userId: number
  ): Promise<Playlist | undefined> {
    const playlist = await prisma.playlist.findFirst({
      where: { id, userId },
    });

    if (!playlist) return undefined;

    return playlist as any;
  }

  /**
   * Get all playlists for a user
   */
  static async findAll(userId: number): Promise<Playlist[]> {
    const playlists = await prisma.playlist.findMany({
      where: { userId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });

    return playlists as any;
  }

  /**
   * Update playlist (filtered by userId)
   */
  static async update(
    id: number,
    playlist: Partial<Playlist>,
    userId: number
  ): Promise<boolean> {
    const updateData: any = {};

    if (playlist.name !== undefined) updateData.name = playlist.name;
    if (playlist.url !== undefined) updateData.url = playlist.url;
    if (playlist.username !== undefined)
      updateData.username = playlist.username;
    if (playlist.password !== undefined)
      updateData.password = playlist.password;
    if (playlist.identifierSource !== undefined)
      updateData.identifierSource = playlist.identifierSource || null;
    if (playlist.identifierRegex !== undefined)
      updateData.identifierRegex = playlist.identifierRegex || null;
    if (playlist.identifierMetadataKey !== undefined)
      updateData.identifierMetadataKey = playlist.identifierMetadataKey || null;
    if (playlist.hiddenCategories !== undefined)
      updateData.hiddenCategories = playlist.hiddenCategories || null;
    if (playlist.excludedChannels !== undefined)
      updateData.excludedChannels = playlist.excludedChannels || null;
    if (playlist.includeUncategorizedChannels !== undefined)
      updateData.includeUncategorizedChannels =
        playlist.includeUncategorizedChannels;
    if (playlist.externalAccessEnabled !== undefined)
      updateData.externalAccessEnabled = playlist.externalAccessEnabled;
    if (playlist.externalAccessToken !== undefined)
      updateData.externalAccessToken = playlist.externalAccessToken || null;

    if (Object.keys(updateData).length === 0) return false;

    updateData.updatedAt = new Date();

    try {
      // Use updateMany with where clause to ensure userId match
      const result = await prisma.playlist.updateMany({
        where: { id, userId },
        data: updateData,
      });
      return result.count > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Delete playlist (filtered by userId)
   */
  static async delete(id: number, userId: number): Promise<boolean> {
    try {
      // Use deleteMany with where clause to ensure userId match
      const result = await prisma.playlist.deleteMany({
        where: { id, userId },
      });
      return result.count > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Save categories for a playlist
   */
  static async saveCategories(
    playlistId: number,
    categories: Category[]
  ): Promise<void> {
    const timeout = await getSyncTimeout();

    // Preserve previous selection state
    const existing = await prisma.category.findMany({
      where: { playlistId },
      select: { categoryId: true, isSelected: true },
    });
    const selectionMap = new Map(
      existing.map((c) => [c.categoryId, c.isSelected || 0])
    );

    await prisma.$transaction(
      async (tx) => {
        // Delete existing categories
        await tx.category.deleteMany({
          where: { playlistId },
        });

        // Insert new categories
        if (categories.length > 0) {
          await tx.category.createMany({
            data: categories.map((cat) => ({
              playlistId: cat.playlistId,
              categoryId: cat.categoryId,
              categoryName: cat.categoryName,
              parentId: cat.parentId || null,
              isSelected: selectionMap.get(cat.categoryId) ?? 0, // new categories default to unselected
            })),
          });
        }
      },
      {
        timeout,
      }
    );
  }

  /**
   * Get categories for a playlist
   */
  static async getCategories(playlistId: number): Promise<Category[]> {
    const categories = await prisma.category.findMany({
      where: { playlistId },
      orderBy: { categoryName: "asc" },
      select: {
        id: true,
        playlistId: true,
        categoryId: true,
        categoryName: true,
        parentId: true,
        isSelected: true,
      },
    });

    return categories as Category[];
  }

  static async setCategorySelection(
    playlistId: number,
    selectedCategoryIds: string[]
  ) {
    // Reset all to 0, then set selected to 1
    await prisma.$transaction([
      prisma.category.updateMany({
        where: { playlistId },
        data: { isSelected: 0 },
      }),
      prisma.category.updateMany({
        where: { playlistId, categoryId: { in: selectedCategoryIds } },
        data: { isSelected: 1 },
      }),
    ]);
  }

  static async getSelectedCategoryIds(playlistId: number): Promise<string[]> {
    const rows = await prisma.category.findMany({
      where: { playlistId, isSelected: 1 },
      select: { categoryId: true },
    });
    return rows.map((r) => r.categoryId);
  }

  /**
   * Save channels for a playlist
   * Optimized for short-running requests
   * CRITICAL: Preserves user channel mappings during sync
   */
  static async saveChannels(
    playlistId: number,
    channels: Channel[]
  ): Promise<void> {
    const startTime = Date.now();

    // Step 1: Fetch ONLY channels with custom mappings (CRITICAL for preservation)
    const existingMappings = await prisma.channel.findMany({
      where: {
        playlistId,
        channelMapping: { not: null },
      },
      select: {
        streamId: true,
        channelMapping: true,
      },
    });

    // Build a fast lookup map: streamId -> channelMapping JSON
    const mappingMap = new Map(
      existingMappings.map((m) => [m.streamId, m.channelMapping!])
    );

    // Step 2: Delete existing channels (FAST, outside transaction)
    await prisma.channel.deleteMany({
      where: { playlistId },
    });

    // Step 3: Insert in VERY LARGE batches for maximum speed
    // For 26k channels: 5 batches of 5000 = ~2.5s total
    const BATCH_SIZE = 5000; // Maximum batch size for speed
    let restoredMappingsCount = 0;

    for (let i = 0; i < channels.length; i += BATCH_SIZE) {
      const batch = channels.slice(i, i + BATCH_SIZE);

      const data = batch.map((ch) => {
        // CRITICAL: Restore user's custom mapping if it exists for this channel
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
          channelMapping: existingMapping, // ← CRITICAL: Restore full mapping
        };
      });

      // Insert this batch (no transaction wrapper = faster)
      await prisma.channel.createMany({
        data,
      });
    }
  }

  /**
   * Get channels for a playlist (with optional pagination)
   */
  static async getChannels(
    playlistId: number,
    categoryId?: string,
    options?: {
      skip?: number;
      take?: number;
      search?: string;
    }
  ): Promise<Channel[]> {
    const where: any = { playlistId };

    if (categoryId) {
      // Get playlist settings to check includeUncategorizedChannels
      // Internal call - playlistId already verified at route level
      const playlist = await prisma.playlist.findUnique({
        where: { id: playlistId },
      });
      const includeUncategorized = playlist?.includeUncategorizedChannels !== 0;

      if (includeUncategorized) {
        // Include channels with matching category OR no category
        where.OR = [{ categoryId }, { categoryId: null }, { categoryId: "" }];
      } else {
        // Only include channels with matching category
        where.categoryId = categoryId;
      }
    }

    // Add search filter if provided
    if (options?.search) {
      where.name = {
        contains: options.search,
      };
    }

    const channels = await prisma.channel.findMany({
      where,
      orderBy: { name: "asc" },
      skip: options?.skip,
      take: options?.take,
    });

    return channels as Channel[];
  }

  /**
   * Get channel count for a playlist
   */
  static async getChannelCount(playlistId: number): Promise<number> {
    return await prisma.channel.count({
      where: { playlistId },
    });
  }

  /**
   * Search channels by name (optimized with limit)
   */
  static async searchChannels(
    playlistId: number,
    searchTerm: string,
    limit: number = 100
  ): Promise<Channel[]> {
    const channels = await prisma.channel.findMany({
      where: {
        playlistId,
        name: {
          contains: searchTerm,
        },
      },
      orderBy: { name: "asc" },
      take: limit,
    });

    return channels as Channel[];
  }

  /**
   * Get channels with mapping info (optimized for sorting)
   * Returns channels pre-sorted by database for better performance
   */
  static async getChannelsForExport(
    playlistId: number,
    categoryIds?: string[]
  ): Promise<Channel[]> {
    const where: any = { playlistId };

    if (categoryIds && categoryIds.length > 0) {
      where.categoryId = { in: categoryIds };
    }

    // Fetch all channels, database will use the composite index
    const channels = await prisma.channel.findMany({
      where,
      orderBy: [
        // Sort by whether channel is mapped (null last)
        { channelMapping: "asc" },
        // Then by name
        { name: "asc" },
      ],
    });

    return channels as Channel[];
  }

  /**
   * Get count of channels (with optional category filter)
   */
  static async getChannelCountWithFilter(
    playlistId: number,
    categoryId?: string
  ): Promise<number> {
    const where: any = { playlistId };

    if (categoryId) {
      const playlist = await prisma.playlist.findUnique({
        where: { id: playlistId },
      });
      const includeUncategorized = playlist?.includeUncategorizedChannels !== 0;

      if (includeUncategorized) {
        where.OR = [{ categoryId }, { categoryId: null }, { categoryId: "" }];
      } else {
        where.categoryId = categoryId;
      }
    }

    return await prisma.channel.count({ where });
  }

  /**
   * Get filtered channel count (excluding hidden categories and excluded channels)
   * This matches the filtering logic used in public-playlist.routes.ts
   */
  static async getFilteredChannelCount(playlistId: number): Promise<number> {
    const playlist = await prisma.playlist.findUnique({
      where: { id: playlistId },
      select: {
        hiddenCategories: true,
        excludedChannels: true,
        includeUncategorizedChannels: true,
      },
    });

    if (!playlist) {
      return 0;
    }

    // Parse hidden categories and excluded channels
    let hiddenCategoryIds: string[] = [];
    let excludedChannelIds: string[] = [];
    const includeUncategorized = playlist.includeUncategorizedChannels !== 0;

    if (playlist.hiddenCategories) {
      try {
        hiddenCategoryIds = JSON.parse(playlist.hiddenCategories as string);
        if (!Array.isArray(hiddenCategoryIds)) {
          hiddenCategoryIds = [];
        }
      } catch (e) {
        hiddenCategoryIds = [];
      }
    }

    if (playlist.excludedChannels) {
      try {
        excludedChannelIds = JSON.parse(playlist.excludedChannels as string);
        if (!Array.isArray(excludedChannelIds)) {
          excludedChannelIds = [];
        }
      } catch (e) {
        excludedChannelIds = [];
      }
    }

    const where: any = { playlistId };
    const AND: any[] = [];

    // Exclude explicitly excluded channels
    if (excludedChannelIds.length > 0) {
      AND.push({
        streamId: { notIn: excludedChannelIds },
      });
    }

    // Handle category filtering
    if (hiddenCategoryIds.length > 0) {
      if (includeUncategorized) {
        // Include channels NOT in hidden categories OR uncategorized channels
        AND.push({
          OR: [
            { categoryId: { notIn: hiddenCategoryIds } },
            { categoryId: null },
            { categoryId: "" },
          ],
        });
      } else {
        // Only include channels NOT in hidden categories (exclude uncategorized)
        AND.push({
          AND: [
            { categoryId: { notIn: hiddenCategoryIds } },
            { categoryId: { not: null } },
            { categoryId: { not: "" } },
          ],
        });
      }
    }

    if (AND.length > 0) {
      where.AND = AND;
    }

    return await prisma.channel.count({ where });
  }

  /**
   * Get total category count for a playlist
   */
  static async getCategoryCount(playlistId: number): Promise<number> {
    return await prisma.category.count({ where: { playlistId } });
  }

  /**
   * Get filtered category count (excluding hidden categories)
   */
  static async getFilteredCategoryCount(playlistId: number): Promise<number> {
    const playlist = await prisma.playlist.findUnique({
      where: { id: playlistId },
      select: {
        hiddenCategories: true,
      },
    });

    if (!playlist) {
      return 0;
    }

    const where: any = { playlistId };

    // Exclude hidden categories
    if (playlist.hiddenCategories) {
      try {
        const hiddenCategories = JSON.parse(
          playlist.hiddenCategories as string
        );
        if (Array.isArray(hiddenCategories) && hiddenCategories.length > 0) {
          where.categoryId = { notIn: hiddenCategories };
        }
      } catch (e) {
        // Ignore parse errors
      }
    }

    return await prisma.category.count({ where });
  }
}
