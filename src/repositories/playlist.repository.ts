import prisma, { getSyncTimeout } from "../database/prisma";
import { Playlist, Channel, Category } from "@prisma/client";

export class PlaylistRepository {
  /**
   * Create a new playlist
   */
  static async create(playlist: Playlist, userId: number): Promise<Playlist> {
    // New playlists should be appended to the bottom: compute next sortOrder
    const maxSort = await prisma.playlist.aggregate({
      where: { userId },
      _max: { sortOrder: true },
    });
    const nextSortOrder = (maxSort._max.sortOrder ?? 0) + 1;

    const created = await prisma.playlist.create({
      data: {
        userId,
        name: playlist.name,
        type: playlist.type,
        url: playlist.url,
        username: playlist.username || null,
        password: playlist.password || null,
        sortOrder: nextSortOrder,
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
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
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
    categories: Category[],
    preserveExisting: boolean = false
  ): Promise<void> {
    const timeout = await getSyncTimeout();

    // Preserve previous selection state
    const existing = await prisma.category.findMany({
      where: { playlistId },
      select: { categoryId: true, isSelected: true, categoryName: true, parentId: true },
    });
    const selectionMap = new Map(
      existing.map((c) => [c.categoryId, c.isSelected || 0])
    );

    // Build final category set
    const categoryMap = new Map<string, Category & { isSelected?: number }>();

    if (preserveExisting) {
      existing.forEach((cat) => {
        categoryMap.set(cat.categoryId, {
          playlistId,
          categoryId: cat.categoryId,
          categoryName: cat.categoryName,
          parentId: cat.parentId || null,
          isSelected: cat.isSelected || 0,
        } as any);
      });
    }

    categories.forEach((cat) => {
      categoryMap.set(cat.categoryId, {
        playlistId: cat.playlistId,
        categoryId: cat.categoryId,
        categoryName: cat.categoryName,
        parentId: cat.parentId || null,
        isSelected: selectionMap.get(cat.categoryId) ?? 0,
      } as any);
    });

    const finalCategories = Array.from(categoryMap.values());

    await prisma.$transaction(
      async (tx) => {
        await tx.category.deleteMany({
          where: { playlistId },
        });

        if (finalCategories.length > 0) {
          await tx.category.createMany({
            data: finalCategories.map((cat) => ({
              playlistId: cat.playlistId,
              categoryId: cat.categoryId,
              categoryName: cat.categoryName,
              parentId: cat.parentId || null,
              isSelected: cat.isSelected ?? 0,
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
    },
    filters?: {
      hiddenCategories?: string[];
      excludedChannels?: string[];
      includeUncategorized?: boolean;
      selectedCategoryIds?: string[];
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
    // If no specific category requested, but playlist has selected categories, limit to them
    if (!categoryId && filters?.selectedCategoryIds && filters.selectedCategoryIds.length > 0) {
      const includeUncategorized =
        filters.includeUncategorized === undefined
          ? true
          : !!filters.includeUncategorized;
      if (includeUncategorized) {
        where.OR = [
          { categoryId: { in: filters.selectedCategoryIds } },
          { categoryId: null },
          { categoryId: "" },
        ];
      } else {
        where.categoryId = { in: filters.selectedCategoryIds };
      }
    }

    // Apply exclusions
    if (filters?.excludedChannels && filters.excludedChannels.length > 0) {
      where.streamId = { notIn: filters.excludedChannels };
    }

    // Apply hidden categories
    if (filters?.hiddenCategories && filters.hiddenCategories.length > 0) {
      const includeUncategorized =
        filters.includeUncategorized === undefined
          ? true
          : !!filters.includeUncategorized;
      if (includeUncategorized) {
        where.NOT = [{ categoryId: { in: filters.hiddenCategories } }];
      } else {
        where.categoryId = {
          notIn: filters.hiddenCategories,
          not: { in: [null, ""] },
        } as any;
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
    categoryId?: string,
    filters?: {
      hiddenCategories?: string[];
      excludedChannels?: string[];
      includeUncategorized?: boolean;
      selectedCategoryIds?: string[];
    }
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
    if (!categoryId && filters?.selectedCategoryIds && filters.selectedCategoryIds.length > 0) {
      const includeUncategorized =
        filters.includeUncategorized === undefined
          ? true
          : !!filters.includeUncategorized;
      if (includeUncategorized) {
        where.OR = [
          { categoryId: { in: filters.selectedCategoryIds } },
          { categoryId: null },
          { categoryId: "" },
        ];
      } else {
        where.categoryId = { in: filters.selectedCategoryIds };
      }
    }

    if (filters?.excludedChannels && filters.excludedChannels.length > 0) {
      where.streamId = { notIn: filters.excludedChannels };
    }

    if (filters?.hiddenCategories && filters.hiddenCategories.length > 0) {
      const includeUncategorized =
        filters.includeUncategorized === undefined
          ? true
          : !!filters.includeUncategorized;
      if (includeUncategorized) {
        where.NOT = [{ categoryId: { in: filters.hiddenCategories } }];
      } else {
        where.categoryId = {
          notIn: filters.hiddenCategories,
          not: { in: [null, ""] },
        } as any;
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
    const selectedCategoryIds = await this.getSelectedCategoryIds(playlistId);

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

    // Selected categories act as an allowlist when present
    if (selectedCategoryIds.length > 0) {
      if (includeUncategorized) {
        where.OR = [
          { categoryId: { in: selectedCategoryIds } },
          { categoryId: null },
          { categoryId: "" },
        ];
      } else {
        where.categoryId = { in: selectedCategoryIds };
      }
    }

    // Exclude explicitly excluded channels
    if (excludedChannelIds.length > 0) {
      where.streamId = { notIn: excludedChannelIds };
    }

    // Handle category filtering
    if (hiddenCategoryIds.length > 0) {
      if (includeUncategorized) {
        // Include channels NOT in hidden categories OR uncategorized channels
        where.NOT = [{ categoryId: { in: hiddenCategoryIds } }];
      } else {
        // Only include channels NOT in hidden categories (exclude uncategorized)
        where.categoryId = {
          notIn: hiddenCategoryIds,
          not: { in: [null, ""] },
        } as any;
      }
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
    const selectedCategoryIds = await this.getSelectedCategoryIds(playlistId);

    // Exclude hidden categories
    let hiddenCategories: string[] = [];
    if (playlist.hiddenCategories) {
      try {
        hiddenCategories = JSON.parse(playlist.hiddenCategories as string);
      } catch (e) {
        hiddenCategories = [];
      }
    }

    const AND: any[] = [];
    if (hiddenCategories.length > 0) {
      AND.push({ categoryId: { notIn: hiddenCategories } });
    }

    if (selectedCategoryIds.length > 0) {
      AND.push({ categoryId: { in: selectedCategoryIds } });
    }

    if (AND.length > 0) {
      where.AND = AND;
    }

    return await prisma.category.count({ where });
  }
}
