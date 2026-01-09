import { Router, Request, Response } from "express";
import { PlaylistRepository } from "../repositories/playlist.repository";
import { XtreamService } from "../services/xtream.service";
import { M3UService } from "../services/m3u.service";
import { ExportService } from "../services/export.service";
import { Playlist } from "@prisma/client";
import prisma, { isDebugMode } from "../database/prisma";

const PlaylistType = {
  M3U: "m3u" as const,
  XTREAM: "xtream" as const,
};

const router = Router();

// Helper function to parse hiddenCategories and excludedChannels from JSON string to array
const parsePlaylist = (playlist: Playlist): any => {
  const parsed = { ...playlist };
  if (parsed.hiddenCategories) {
    try {
      (parsed as any).hiddenCategories = JSON.parse(parsed.hiddenCategories);
    } catch (e) {
      (parsed as any).hiddenCategories = [];
    }
  }
  if (parsed.excludedChannels) {
    try {
      (parsed as any).excludedChannels = JSON.parse(parsed.excludedChannels);
    } catch (e) {
      (parsed as any).excludedChannels = [];
    }
  }
  // Convert SQLite integer (0/1) to boolean
  if (parsed.includeUncategorizedChannels !== undefined) {
    (parsed as any).includeUncategorizedChannels =
      parsed.includeUncategorizedChannels === 1;
  }
  if (parsed.externalAccessEnabled !== undefined) {
    (parsed as any).externalAccessEnabled = parsed.externalAccessEnabled === 1;
  }
  return parsed;
};

// Helper function to sort channels: mapped channels first (by lineup order), then unmapped
// Optimized to only load lineup data when there are mapped channels
const sortChannelsByMapping = async (channels: any[]): Promise<any[]> => {
  // Quick check: if no channels have mapping, return as-is (already sorted by name)
  const hasMappedChannels = channels.some((ch) => ch.channelMapping);
  if (!hasMappedChannels) {
    return channels;
  }

  // Get all channel lineup entries with their sortOrder (cached for session)
  const lineupMap = new Map<string, number>();
  try {
    // Only fetch unique names that are actually mapped
    const mappedNames = new Set<string>();
    channels.forEach((channel) => {
      if (channel.channelMapping) {
        try {
          const mapping = JSON.parse(channel.channelMapping);
          if (mapping.name) {
            mappedNames.add(mapping.name);
          }
        } catch (e) {
          // Invalid JSON, skip
        }
      }
    });

    // Fetch only the lineup entries we need
    if (mappedNames.size > 0) {
      const lineupChannels = await prisma.channelLineup.findMany({
        where: {
          name: { in: Array.from(mappedNames) },
        },
        select: { name: true, sortOrder: true },
      });

      lineupChannels.forEach((ch) => {
        lineupMap.set(ch.name, ch.sortOrder);
      });
    }
  } catch (e) {
    console.error("Error loading channel lineup for sorting:", e);
  }

  // Separate mapped and unmapped channels
  const mapped: Array<{ channel: any; sortOrder: number }> = [];
  const unmapped: any[] = [];

  channels.forEach((channel) => {
    if (channel.channelMapping) {
      try {
        const mapping = JSON.parse(channel.channelMapping);
        const mappedName = mapping.name;
        const sortOrder = lineupMap.get(mappedName) ?? 999999;
        mapped.push({ channel, sortOrder });
      } catch (e) {
        // If mapping is invalid, treat as unmapped
        unmapped.push(channel);
      }
    } else {
      unmapped.push(channel);
    }
  });

  // Sort mapped channels by their lineup sortOrder
  mapped.sort((a, b) => a.sortOrder - b.sortOrder);

  // Combine: mapped first, then unmapped
  return [...mapped.map((m) => m.channel), ...unmapped];
};

/**
 * GET /api/playlists - Get all playlists
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const playlists = await PlaylistRepository.findAll(userId);

    // Add channel counts and parse hiddenCategories
    const playlistsWithCounts = await Promise.all(
      playlists.map(async (playlist) => {
        const parsed = parsePlaylist(playlist);
        return {
          ...parsed,
          channelCount: await PlaylistRepository.getChannelCount(playlist.id!),
          filteredChannelCount:
            await PlaylistRepository.getFilteredChannelCount(playlist.id!),
          categoryCount: await PlaylistRepository.getCategoryCount(
            playlist.id!
          ),
          filteredCategoryCount:
            await PlaylistRepository.getFilteredCategoryCount(playlist.id!),
        };
      })
    );

    res.json(playlistsWithCounts);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/playlists/reorder - Reorder playlists
 * IMPORTANT: Must be before /:id route to avoid conflict
 */
router.put("/reorder", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const { playlists } = req.body;

    if (!Array.isArray(playlists)) {
      return res.status(400).json({ error: "Playlists array is required" });
    }

    // Only update user's own playlists
    await prisma.$transaction(
      playlists.map((playlist: { id: number; sortOrder: number }) =>
        prisma.playlist.updateMany({
          where: { id: playlist.id, userId },
          data: { sortOrder: playlist.sortOrder },
        })
      )
    );

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/playlists/:id - Get playlist by ID
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const id = parseInt(req.params.id);
    const playlist = await PlaylistRepository.findById(id, userId);

    if (!playlist) {
      return res.status(404).json({ error: "Playlist not found" });
    }

    const parsed = parsePlaylist(playlist);
    res.json({
      ...parsed,
      channelCount: await PlaylistRepository.getChannelCount(id),
      filteredChannelCount: await PlaylistRepository.getFilteredChannelCount(id),
      categoryCount: await PlaylistRepository.getCategoryCount(id),
      filteredCategoryCount: await PlaylistRepository.getFilteredCategoryCount(id),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/playlists - Create new playlist
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const { name, type, url, username, password } = req.body;

    // Validate required fields
    if (!name || !type || !url) {
      return res
        .status(400)
        .json({ error: "Missing required fields: name, type, url" });
    }

    if (type === PlaylistType.XTREAM && (!username || !password)) {
      return res
        .status(400)
        .json({ error: "Xtream Codes requires username and password" });
    }

    // Test connection before saving
    if (type === PlaylistType.XTREAM) {
      await XtreamService.authenticate({ url, username, password });
    } else if (type === PlaylistType.M3U) {
      await M3UService.fetchM3U(url);
    }

    // Create playlist with default identifier configuration
    const playlistData = {
      name,
      type,
      url,
      username,
      password,
      identifierSource: "channel-name", // Default to channel name as identifier
    };

    // If no EPG is specified, assign the user's default EPG file (if any)
    try {
      const defaultEpg = await prisma.epgFile.findFirst({
        where: { userId, isDefault: true },
        select: { id: true },
      });
      if (defaultEpg) {
        (playlistData as any).epgFileId = defaultEpg.id;
      }
    } catch (e) {
      // Non-fatal: if default lookup fails, continue without setting
    }

    const created = await PlaylistRepository.create(playlistData as any, userId);
    res.status(201).json(created);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * PUT /api/playlists/:id - Update playlist
 */
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const id = parseInt(req.params.id);
    const {
      name,
      url,
      username,
      password,
      identifierSource,
      identifierRegex,
      identifierMetadataKey,
      hiddenCategories,
      excludedChannels,
      includeUncategorizedChannels,
      externalAccessEnabled,
      externalAccessToken,
      epgFileId,
      epgGroupId,
    } = req.body;

    const updateData: Partial<Playlist> = {
      name,
      url,
      username,
      password,
      identifierSource,
      identifierRegex,
      identifierMetadataKey,
      epgFileId: epgFileId !== undefined ? epgFileId : undefined,
      epgGroupId: epgGroupId !== undefined ? epgGroupId : undefined,
    };

    // External access settings
    if (externalAccessEnabled !== undefined) {
      updateData.externalAccessEnabled = externalAccessEnabled ? 1 : 0;
    }
    if (externalAccessToken !== undefined) {
      updateData.externalAccessToken = externalAccessToken;
    }

    // Convert hiddenCategories array to JSON string for storage
    if (hiddenCategories !== undefined) {
      updateData.hiddenCategories = Array.isArray(hiddenCategories)
        ? JSON.stringify(hiddenCategories)
        : hiddenCategories;
    }

    // Convert excludedChannels array to JSON string for storage
    if (excludedChannels !== undefined) {
      updateData.excludedChannels = Array.isArray(excludedChannels)
        ? JSON.stringify(excludedChannels)
        : excludedChannels;
    }

    // Convert boolean to integer for SQLite storage
    if (includeUncategorizedChannels !== undefined) {
      updateData.includeUncategorizedChannels = includeUncategorizedChannels
        ? 1
        : 0;
    }

    const updated = await PlaylistRepository.update(id, updateData, userId);

    if (!updated) {
      return res.status(404).json({ error: "Playlist not found" });
    }

    const playlist = await PlaylistRepository.findById(id, userId);
    res.json(parsePlaylist(playlist!));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/playlists/:id - Delete playlist
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const id = parseInt(req.params.id);
    const deleted = await PlaylistRepository.delete(id, userId);

    if (!deleted) {
      return res.status(404).json({ error: "Playlist not found" });
    }

    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/playlists/:id/sync-categories - Sync only categories (Xtream)
 */
router.post("/:id/sync-categories", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const id = parseInt(req.params.id);
    const playlist = await PlaylistRepository.findById(id, userId);

    if (!playlist) {
      return res.status(404).json({ error: "Playlist not found" });
    }
    if (playlist.type !== PlaylistType.XTREAM) {
      return res
        .status(400)
        .json({ error: "Category-only sync is only available for Xtream" });
    }

    // Capture existing categories to compute deltas and preserve selection
    const existingCategories = await PlaylistRepository.getCategories(id);
    const existingIds = new Set(existingCategories.map((c) => c.categoryId));

    // Fetch categories from provider
    const xtreamCreds = {
      url: playlist.url,
      username: playlist.username!,
      password: playlist.password!,
    };
    const xtreamCategories = await XtreamService.getCategories(xtreamCreds);
    const categories = xtreamCategories.map((cat) =>
      XtreamService.convertCategory(cat, playlist.id!)
    );

    // Save categories while preserving previous selection
    await PlaylistRepository.saveCategories(id, categories as any);

    // Update lastCategoriesSyncedAt
    await prisma.playlist.update({
      where: { id },
      data: { lastCategoriesSyncedAt: new Date() },
    });

    // Compute deltas
    const newIds = new Set(categories.map((c) => c.categoryId));
    const added = categories
      .filter((c) => !existingIds.has(c.categoryId))
      .map((c) => c.categoryName);
    const removed = existingCategories
      .filter((c) => !newIds.has(c.categoryId))
      .map((c) => c.categoryName);

    const isFirstSync = existingCategories.length === 0;

    res.json({
      success: true,
      categoriesCount: categories.length,
      lastCategoriesSyncedAt: new Date(),
      added,
      removed,
      isFirstSync,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/playlists/:id/categories/select - Set selected categories
 */
router.post("/:id/categories/select", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const id = parseInt(req.params.id);
    const { categoryIds } = req.body;

    if (!Array.isArray(categoryIds)) {
      return res.status(400).json({ error: "categoryIds must be an array" });
    }

    const playlist = await PlaylistRepository.findById(id, userId);

    if (!playlist) {
      return res.status(404).json({ error: "Playlist not found" });
    }

    await PlaylistRepository.setCategorySelection(id, categoryIds);

    res.json({ success: true, selected: categoryIds.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/playlists/:id/sync - Start async playlist sync
 * Returns job ID immediately for polling
 */
router.post("/:id/sync", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const id = parseInt(req.params.id);
    const categoryFilters = Array.isArray(req.body?.categoryIds)
      ? (req.body.categoryIds as string[])
      : undefined;
    const playlist = await PlaylistRepository.findById(id, userId);

    if (!playlist) {
      return res.status(404).json({ error: "Playlist not found" });
    }

    // Import the service (avoid circular dependency)
    const { PlaylistSyncJobService } = await import(
      "../services/playlist-sync-job.service"
    );

    // Create job and return immediately
    // If Xtream and no category filters passed, use previously selected categories
    let filtersToUse = categoryFilters;
    if (!filtersToUse && playlist.type === PlaylistType.XTREAM) {
      const selected = await PlaylistRepository.getSelectedCategoryIds(id);
      if (selected.length > 0) {
        filtersToUse = selected;
      }
    }

    const jobId = await PlaylistSyncJobService.createJob(
      userId,
      id,
      filtersToUse
    );

    res.json({
      success: true,
      jobId,
      message: "Sync started",
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/playlists/:id/sync/job/:jobId - Poll sync job status
 * Also triggers next processing chunk
 */
router.get("/:id/sync/job/:jobId", async (req: Request, res: Response) => {
  try {
    const jobId = parseInt(req.params.jobId);

    // Import the service
    const { PlaylistSyncJobService } = await import(
      "../services/playlist-sync-job.service"
    );

    // Get current status
    let job = await PlaylistSyncJobService.getJobStatus(jobId);

    if (!job) {
      return res.status(404).json({ error: "Sync job not found" });
    }

    // If job is pending or in progress, process next chunk
    if (
      job.status === "pending" ||
      job.status === "syncing" ||
      job.status === "saving"
    ) {
      try {
        await PlaylistSyncJobService.processSyncChunk(jobId, 8000); // 8s max per chunk
      } catch (error: any) {
        // Error is already saved to job, just continue
      }

      // Get updated status
      job = await PlaylistSyncJobService.getJobStatus(jobId);
    }

    res.json(job);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/playlists/:id/sync/cleanup - Clean up stuck sync jobs
 */
router.delete("/:id/sync/cleanup", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const playlistId = parseInt(req.params.id);

    // Verify playlist ownership
    const playlist = await PlaylistRepository.findById(playlistId, userId);
    if (!playlist) {
      return res.status(404).json({ error: "Playlist not found" });
    }

    // Find and clean up stuck jobs (older than 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const stuckJobs = await prisma.playlistSyncJob.findMany({
      where: {
        playlistId,
        status: { in: ["pending", "syncing", "saving"] },
        updatedAt: { lt: fiveMinutesAgo },
      },
    });

    if (stuckJobs.length === 0) {
      // Also check for very recent stuck jobs (less than 5 min but causing issues)
      const recentStuckJobs = await prisma.playlistSyncJob.findMany({
        where: {
          playlistId,
          status: { in: ["pending", "syncing", "saving"] },
        },
      });

      if (recentStuckJobs.length > 0) {
        // Mark them as failed
        await prisma.playlistSyncJob.updateMany({
          where: {
            playlistId,
            status: { in: ["pending", "syncing", "saving"] },
          },
          data: {
            status: "failed",
            error: "Job manually cleaned up due to stuck state",
            updatedAt: new Date(),
          },
        });

        console.log(
          `Cleaned up ${recentStuckJobs.length} recent stuck sync jobs for playlist ${playlistId}`
        );

        return res.json({
          success: true,
          cleaned: recentStuckJobs.length,
          message: `Cleaned up ${recentStuckJobs.length} stuck sync job(s)`,
        });
      }

      return res.json({
        success: true,
        cleaned: 0,
        message: "No stuck sync jobs found",
      });
    }

    // Mark stuck jobs as failed
    await prisma.playlistSyncJob.updateMany({
      where: {
        playlistId,
        status: { in: ["pending", "syncing", "saving"] },
        updatedAt: { lt: fiveMinutesAgo },
      },
      data: {
        status: "failed",
        error: "Job stuck for more than 5 minutes - marked as failed",
        updatedAt: new Date(),
      },
    });

    console.log(
      `Cleaned up ${stuckJobs.length} stuck sync jobs for playlist ${playlistId}`
    );

    res.json({
      success: true,
      cleaned: stuckJobs.length,
      message: `Cleaned up ${stuckJobs.length} stuck sync job(s)`,
    });
  } catch (error: any) {
    console.error("Cleanup error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/playlists/:id/categories - Get playlist categories
 */
router.get("/:id/categories", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const id = parseInt(req.params.id);
    const returnFullList = req.query.full === "true";

    // Always fetch all categories from DB
    const categories = await PlaylistRepository.getCategories(id);

    if (returnFullList) {
      // Settings modal needs the complete list (with isSelected flags)
      return res.json(categories);
    }

    // For dashboard views, filter categories based on playlist settings
    const playlist = await PlaylistRepository.findById(id, userId);
    if (!playlist) {
      return res.status(404).json({ error: "Playlist not found" });
    }

    let hiddenCategoryIds: string[] = [];
    if (playlist.hiddenCategories) {
      try {
        hiddenCategoryIds = JSON.parse(playlist.hiddenCategories as any);
        if (!Array.isArray(hiddenCategoryIds)) hiddenCategoryIds = [];
      } catch {
        hiddenCategoryIds = [];
      }
    }

    const selectedCategoryIds = await PlaylistRepository.getSelectedCategoryIds(
      id
    );

    const filtered = categories.filter((cat) => {
      // Exclude hidden categories
      if (hiddenCategoryIds.includes(cat.categoryId)) return false;
      // If a selection allowlist exists, only include selected ones
      if (selectedCategoryIds.length > 0) {
        return selectedCategoryIds.includes(cat.categoryId);
      }
      return true;
    });

    res.json(filtered);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/playlists/:id/channels - Get playlist channels with pagination
 */
router.get("/:id/channels", async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const userId = (req as any).session.user.id;
    const id = parseInt(req.params.id);
    const categoryId = req.query.categoryId as string | undefined;
    const search = req.query.search as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 1000; // Default 1000 per page
    const skipPagination = req.query.skipPagination === "true";

    console.log("=".repeat(80));
    console.log(`[API] GET /api/playlists/${id}/channels`);
    console.log("Request params:", {
      userId,
      playlistId: id,
      categoryId: categoryId || "ALL",
      search: search || "NONE",
      page,
      limit,
      skipPagination,
    });

    let channels;
    let total;

    // Load playlist filters
    const playlist = await PlaylistRepository.findById(id, userId);
    if (!playlist) {
      return res.status(404).json({ error: "Playlist not found" });
    }
    let hiddenCategoryIds: string[] = [];
    let excludedChannelIds: string[] = [];
    const includeUncategorized = playlist.includeUncategorizedChannels !== 0;

    if (playlist.hiddenCategories) {
      try {
        hiddenCategoryIds = JSON.parse(playlist.hiddenCategories as any);
        if (!Array.isArray(hiddenCategoryIds)) hiddenCategoryIds = [];
      } catch {
        hiddenCategoryIds = [];
      }
    }
    if (playlist.excludedChannels) {
      try {
        excludedChannelIds = JSON.parse(playlist.excludedChannels as any);
        if (!Array.isArray(excludedChannelIds)) excludedChannelIds = [];
      } catch {
        excludedChannelIds = [];
      }
    }

    // Selected categories (isSelected = 1) should act as an allowlist when present
    const selectedCategoryIds = await PlaylistRepository.getSelectedCategoryIds(id);

    const filterConfig = {
      hiddenCategories: hiddenCategoryIds,
      excludedChannels: excludedChannelIds,
      includeUncategorized,
      selectedCategoryIds,
    };

    if (search) {
      console.log(
        `[API] Search mode: "${search}" (limit: ${Math.min(limit, 500)})`
      );
      // Apply the same filtering rules during search
      const searchStart = Date.now();
      channels = await PlaylistRepository.getChannels(
        id,
        undefined,
        {
          search,
          take: Math.min(limit, 500),
        },
        filterConfig
      );
      total = channels.length; // Approximate total for search
      console.log(
        `[API] Search completed in ${Date.now() - searchStart}ms: ${
          channels.length
        } channels`
      );
    } else {
      // Get total count for pagination
      const countStart = Date.now();
      total = await PlaylistRepository.getChannelCountWithFilter(
        id,
        categoryId,
        filterConfig
      );
      console.log(`[API] Count query completed in ${Date.now() - countStart}ms: ${total} total channels`);

      // Get paginated channels
      const skip = skipPagination ? undefined : (page - 1) * limit;
      const take = skipPagination ? undefined : limit;
      
      console.log(`[API] Fetching channels (skip: ${skip ?? "none"}, take: ${take ?? "all"})...`);
      const fetchStart = Date.now();
      channels = await PlaylistRepository.getChannels(
        id,
        categoryId,
        {
          skip,
          take,
        },
        filterConfig
      );
      console.log(`[API] Fetch completed in ${Date.now() - fetchStart}ms: ${channels.length} channels`);
    }

    // Sort channels: mapped first (by lineup order), then unmapped
    const sortStart = Date.now();
    const sortedChannels = await sortChannelsByMapping(channels);
    console.log(`[API] Sorting completed in ${Date.now() - sortStart}ms`);

    const totalTime = Date.now() - startTime;
    console.log(`[API] Total request time: ${totalTime}ms`);
    console.log(`[API] Response: ${sortedChannels.length} channels (page ${page}/${Math.ceil(total / limit)})`);
    console.log("=".repeat(80));

    res.json({
      channels: sortedChannels,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    });
  } catch (error: any) {
    const totalTime = Date.now() - startTime;
    console.log("=".repeat(80));
    console.error(`[API] ERROR after ${totalTime}ms:`, error.message);
    console.error("[API] Error stack:", error.stack);
    console.log("=".repeat(80));
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/playlists/:id/export - Export playlist as M3U
 */
router.get("/:id/export", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const id = parseInt(req.params.id);
    const playlist = await PlaylistRepository.findById(id, userId);

    if (!playlist) {
      return res.status(404).json({ error: "Playlist not found" });
    }

    // Respect hidden/excluded when exporting
    let hiddenCategoryIds: string[] = [];
    let excludedChannelIds: string[] = [];
    const includeUncategorized = playlist.includeUncategorizedChannels !== 0;
    if (playlist.hiddenCategories) {
      try {
        hiddenCategoryIds = JSON.parse(playlist.hiddenCategories as any);
        if (!Array.isArray(hiddenCategoryIds)) hiddenCategoryIds = [];
      } catch {
        hiddenCategoryIds = [];
      }
    }
    if (playlist.excludedChannels) {
      try {
        excludedChannelIds = JSON.parse(playlist.excludedChannels as any);
        if (!Array.isArray(excludedChannelIds)) excludedChannelIds = [];
      } catch {
        excludedChannelIds = [];
      }
    }

    const selectedCategoryIds = await PlaylistRepository.getSelectedCategoryIds(
      id
    );

    let channels = await PlaylistRepository.getChannels(
      id,
      undefined,
      undefined,
      {
        hiddenCategories: hiddenCategoryIds,
        excludedChannels: excludedChannelIds,
        includeUncategorized,
        selectedCategoryIds,
      }
    );

    // Sort channels: mapped first (by lineup order), then unmapped
    channels = await sortChannelsByMapping(channels);

    // Get EPG URL: playlist-specific EPG/Group or user's default EPG
    let epgUrl: string | undefined;
    if (playlist.epgGroupId) {
      // Use EPG group URL
      const epgGroup = await prisma.epgGroup.findUnique({
        where: { id: playlist.epgGroupId },
        select: { url: true },
      });
      epgUrl = epgGroup?.url;
    } else if (playlist.epgFileId) {
      // Use specific EPG file
      const epgFile = await prisma.epgFile.findUnique({
        where: { id: playlist.epgFileId },
        select: { url: true },
      });
      epgUrl = epgFile?.url;
    } else {
      // Use default EPG (file or group)
      const defaultEpgFile = await prisma.epgFile.findFirst({
        where: { userId, isDefault: true },
        select: { url: true },
      });
      const defaultEpgGroup = await prisma.epgGroup.findFirst({
        where: { userId, isDefault: true },
        select: { url: true },
      });
      epgUrl = defaultEpgFile?.url || defaultEpgGroup?.url;
    }

    const m3uContent = ExportService.generateM3U(channels as any, true, epgUrl);

    res.setHeader("Content-Type", "application/x-mpegURL");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${playlist.name}.m3u"`
    );
    res.send(m3uContent);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/playlists/:id/export-custom - Export custom selection as M3U
 */
router.post("/:id/export-custom", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const id = parseInt(req.params.id);
    const { channelIds, categoryIds } = req.body;

    const playlist = await PlaylistRepository.findById(id, userId);
    if (!playlist) {
      return res.status(404).json({ error: "Playlist not found" });
    }

    let channels = await PlaylistRepository.getChannels(id);

    // Filter by categories if provided
    if (categoryIds && categoryIds.length > 0) {
      const includeUncategorized = playlist.includeUncategorizedChannels !== 0;
      if (includeUncategorized) {
        // Include channels from specified categories OR uncategorized channels
        channels = channels.filter(
          (ch) =>
            (ch.categoryId && categoryIds.includes(ch.categoryId)) ||
            !ch.categoryId ||
            ch.categoryId.trim() === ""
        );
      } else {
        // Only include channels from specified categories (exclude uncategorized)
        channels = channels.filter(
          (ch) => ch.categoryId && categoryIds.includes(ch.categoryId)
        );
      }
    }

    // Filter by specific channel IDs (streamIds) if provided
    if (channelIds && channelIds.length > 0) {
      channels = channels.filter((ch) => channelIds.includes(ch.streamId));
    }

    // Sort channels: mapped first (by lineup order), then unmapped
    channels = await sortChannelsByMapping(channels);

    // Get EPG URL: playlist-specific EPG/Group or user's default EPG
    let epgUrl: string | undefined;
    if (playlist.epgGroupId) {
      // Use EPG group URL
      const epgGroup = await prisma.epgGroup.findUnique({
        where: { id: playlist.epgGroupId },
        select: { url: true },
      });
      epgUrl = epgGroup?.url;
    } else if (playlist.epgFileId) {
      // Use specific EPG file
      const epgFile = await prisma.epgFile.findUnique({
        where: { id: playlist.epgFileId },
        select: { url: true },
      });
      epgUrl = epgFile?.url;
    } else {
      // Use default EPG (file or group)
      const defaultEpgFile = await prisma.epgFile.findFirst({
        where: { userId, isDefault: true },
        select: { url: true },
      });
      const defaultEpgGroup = await prisma.epgGroup.findFirst({
        where: { userId, isDefault: true },
        select: { url: true },
      });
      epgUrl = defaultEpgFile?.url || defaultEpgGroup?.url;
    }

    const m3uContent = ExportService.generateM3U(channels as any, true, epgUrl);

    res.setHeader("Content-Type", "application/x-mpegURL");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${playlist.name}-filtered.m3u"`
    );
    res.send(m3uContent);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/playlists/:id/export-json - Export full playlist as JSON
 */
router.get("/:id/export-json", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const id = parseInt(req.params.id);
    const playlist = await PlaylistRepository.findById(id, userId);

    if (!playlist) {
      return res.status(404).json({ error: "Playlist not found" });
    }

    let channels = await PlaylistRepository.getChannels(id);

    // Sort channels: mapped first (by lineup order), then unmapped
    channels = await sortChannelsByMapping(channels);

    const jsonContent = ExportService.generateJSON(
      channels as any,
      playlist.identifierSource || undefined,
      playlist.identifierRegex || undefined,
      playlist.identifierMetadataKey || undefined
    );

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${playlist.name}.json"`
    );
    res.send(jsonContent);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/playlists/:id/export-json-custom - Export custom selection as JSON
 */
router.post("/:id/export-json-custom", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const id = parseInt(req.params.id);
    const { channelIds, categoryIds } = req.body;

    const playlist = await PlaylistRepository.findById(id, userId);
    if (!playlist) {
      return res.status(404).json({ error: "Playlist not found" });
    }

    let channels = await PlaylistRepository.getChannels(id);

    // Filter by categories if provided
    if (categoryIds && categoryIds.length > 0) {
      const includeUncategorized = playlist.includeUncategorizedChannels !== 0;
      if (includeUncategorized) {
        // Include channels from specified categories OR uncategorized channels
        channels = channels.filter(
          (ch) =>
            (ch.categoryId && categoryIds.includes(ch.categoryId)) ||
            !ch.categoryId ||
            ch.categoryId.trim() === ""
        );
      } else {
        // Only include channels from specified categories (exclude uncategorized)
        channels = channels.filter(
          (ch) => ch.categoryId && categoryIds.includes(ch.categoryId)
        );
      }
    }

    // Filter by specific channel IDs (streamIds) if provided
    if (channelIds && channelIds.length > 0) {
      channels = channels.filter((ch) => channelIds.includes(ch.streamId));
    }

    // Sort channels: mapped first (by lineup order), then unmapped
    channels = await sortChannelsByMapping(channels);

    const jsonContent = ExportService.generateJSON(
      channels as any,
      playlist.identifierSource || undefined,
      playlist.identifierRegex || undefined,
      playlist.identifierMetadataKey || undefined
    );

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${playlist.name}-filtered.json"`
    );
    res.send(jsonContent);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/playlists/:id/import - Import channel data from JSON (async job)
 */
router.post("/:id/import", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const playlistId = parseInt(req.params.id);
    const { channels: importedChannels } = req.body;

    if (!Array.isArray(importedChannels)) {
      return res
        .status(400)
        .json({ error: "Invalid format. Expected an array of channels." });
    }

    const playlist = await PlaylistRepository.findById(playlistId, userId);
    if (!playlist) {
      return res.status(404).json({ error: "Playlist not found" });
    }

    // Create async import job
    const { ImportJobService } = await import("../services/import-job.service");
    const jobId = await ImportJobService.createJob(
      userId,
      playlistId,
      importedChannels
    );

    res.json({
      success: true,
      jobId,
      message: "Import started",
    });
  } catch (error: any) {
    console.error("Import error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/playlists/:id/import/job/:jobId - Poll import job status
 */
router.get("/:id/import/job/:jobId", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const playlistId = parseInt(req.params.id);
    const jobId = parseInt(req.params.jobId);

    const playlist = await PlaylistRepository.findById(playlistId, userId);
    if (!playlist) {
      return res.status(404).json({ error: "Playlist not found" });
    }

    const { ImportJobService } = await import("../services/import-job.service");
    let job = await ImportJobService.getJobStatus(jobId);

    if (!job) {
      return res.status(404).json({ error: "Import job not found" });
    }

    // Continue processing if not done
    if (job.status === "pending" || job.status === "processing") {
      try {
        await ImportJobService.processImportChunk(jobId, 8000); // 8s max per chunk
      } catch (error: any) {
        // Error is already saved to job, just continue
        console.error(`Import job ${jobId} processing error:`, error);
      }
      job = await ImportJobService.getJobStatus(jobId);
    }

    res.json(job);
  } catch (error: any) {
    console.error("Import job poll error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/playlists/:id/import-old - Old synchronous import (deprecated, kept for reference)
 */
router.post("/:id/import-old", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const playlistId = parseInt(req.params.id);
    const { channels: importedChannels } = req.body;

    if (!Array.isArray(importedChannels)) {
      return res
        .status(400)
        .json({ error: "Invalid format. Expected an array of channels." });
    }

    const playlist = await PlaylistRepository.findById(playlistId, userId);
    if (!playlist) {
      return res.status(404).json({ error: "Playlist not found" });
    }

    // Get all channels from the playlist
    const playlistChannels = await PlaylistRepository.getChannels(playlistId);

    // Get channel lineup for mapping validation
    // IMPORTANT: Filter by the playlist's assigned EPG file or group
    let epgFileIds: number[] = [];

    if (playlist.epgFileId) {
      // Single EPG file assigned
      epgFileIds = [playlist.epgFileId];
    } else if (playlist.epgGroupId) {
      // EPG group assigned - get all EPG files in the group
      const epgGroup = await prisma.epgGroup.findUnique({
        where: { id: playlist.epgGroupId },
        select: { id: true },
      });
      if (epgGroup) {
        const groupFiles = await prisma.epgFile.findMany({
          where: { epgGroupId: playlist.epgGroupId },
          select: { id: true },
        });
        epgFileIds = groupFiles.map((f) => f.id);
      }
    } else {
      // No specific EPG assigned - use the user's default EPG
      const defaultEpgFile = await prisma.epgFile.findFirst({
        where: { userId, isDefault: true },
        select: { id: true },
      });
      const defaultEpgGroup = await prisma.epgGroup.findFirst({
        where: { userId, isDefault: true },
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

    console.log(`Using EPG file IDs for import: [${epgFileIds.join(", ")}]`);

    const channelLineup = await prisma.channelLineup.findMany({
      where: {
        userId,
        ...(epgFileIds.length > 0 && { epgFileId: { in: epgFileIds } }),
      },
      select: {
        name: true,
        tvgLogo: true,
        tvgId: true,
        extGrp: true,
      },
    });

    console.log(
      `Found ${channelLineup.length} channels in assigned EPG file(s)`
    );

    const lineupMap = new Map(
      channelLineup.map((ch) => [
        ch.name.toLowerCase(),
        { logo: ch.tvgLogo, tvgId: ch.tvgId, extGrp: ch.extGrp },
      ])
    );

    let updatedCount = 0;
    let mappedCount = 0;
    let notFoundCount = 0;
    let matchByExtracted = 0;
    let matchByStreamId = 0;
    let matchByTvgName = 0;
    const notFoundChannels: Array<{ channelName: string; channelId: any }> = [];
    const updateBatch: Array<{ streamId: string; mapping: string }> = [];

    console.log("=== IMPORT DEBUG ===");
    console.log(`Playlist identifier config:`, {
      source: playlist.identifierSource,
      regex: playlist.identifierRegex,
      metadataKey: playlist.identifierMetadataKey,
    });
    console.log(`Total imported channels: ${importedChannels.length}`);
    console.log(`Total playlist channels: ${playlistChannels.length}`);

    // Helper to extract identifier from a channel
    const extractIdentifier = (channel: any): string => {
      const source = playlist.identifierSource || "channel-name";
      const regex = playlist.identifierRegex;
      const metadataKey = playlist.identifierMetadataKey;

      if (source === "stream-url" && regex && channel.streamUrl) {
        const match = channel.streamUrl.match(new RegExp(regex));
        return match ? match[1] || match[0] : channel.streamId;
      } else if (source === "metadata" && metadataKey) {
        // Map hyphenated metadata keys to camelCase property names
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

    // Sample first 3 playlist channels for debugging
    console.log("Sample playlist channel identifiers:");
    playlistChannels.slice(0, 3).forEach((ch) => {
      console.log(
        `  - Name: "${ch.name}", Identifier: "${extractIdentifier(ch)}"`
      );
    });

    console.log("Sample imported channel IDs:");
    importedChannels.slice(0, 3).forEach((ch) => {
      console.log(
        `  - ChannelName: "${ch.channelName}", ChannelId: "${ch.channelId}"`
      );
    });

    // Process each imported channel
    for (const importedChannel of importedChannels) {
      if (!importedChannel.channelId) {
        continue; // Skip channels without identifier
      }

      // Try multiple matching strategies
      let matchingChannel = playlistChannels.find((ch) => {
        const channelIdentifier = extractIdentifier(ch);
        return channelIdentifier === String(importedChannel.channelId);
      });
      let matchStrategy = matchingChannel ? "extracted" : null;

      // Fallback 1: Try matching by streamId directly
      if (!matchingChannel) {
        matchingChannel = playlistChannels.find((ch) => {
          return ch.streamId === String(importedChannel.channelId);
        });
        if (matchingChannel) matchStrategy = "streamId";
      }

      // Fallback 2: Try matching by tvgName
      if (!matchingChannel && importedChannel.tvgName) {
        matchingChannel = playlistChannels.find((ch) => {
          return ch.tvgName === importedChannel.tvgName;
        });
        if (matchingChannel) matchStrategy = "tvgName";
      }

      if (!matchingChannel) {
        notFoundCount++;
        notFoundChannels.push({
          channelName: importedChannel.channelName || "Unknown",
          channelId: importedChannel.channelId,
        });
        continue; // Skip if no match found
      }

      // Track which strategy worked
      if (matchStrategy === "extracted") matchByExtracted++;
      else if (matchStrategy === "streamId") matchByStreamId++;
      else if (matchStrategy === "tvgName") matchByTvgName++;

      // Only use channelName from imported JSON to look up in channel_lineup
      // All other data should come from the provider's playlist (already in DB)
      if (!importedChannel.channelName) {
        notFoundCount++;
        notFoundChannels.push({
          channelName: importedChannel.channelName || "Unknown",
          channelId: importedChannel.channelId,
        });
        continue; // Skip if no channelName provided
      }

      // Look up the channelName in channel_lineup table
      const lineupEntry = lineupMap.get(
        importedChannel.channelName.toLowerCase()
      );

      if (!lineupEntry) {
        notFoundCount++;
        notFoundChannels.push({
          channelName: importedChannel.channelName,
          channelId: importedChannel.channelId,
        });
        continue; // Skip if not found in channel lineup
      }

      // Create mapping with data from channel_lineup
      const mapping = JSON.stringify({
        name: importedChannel.channelName,
        logo: lineupEntry.logo || "",
        extGrp: lineupEntry.extGrp || "",
        tvgId: lineupEntry.tvgId || "",
      });

      // Add to batch instead of updating immediately
      updateBatch.push({
        streamId: matchingChannel.streamId,
        mapping: mapping,
      });

      mappedCount++;
    }

    console.log(
      `Prepared ${updateBatch.length} mappings. Now applying in batches...`
    );

    // Batch update all mappings in groups of 10 to avoid connection contention
    const BATCH_SIZE = 10;
    for (let i = 0; i < updateBatch.length; i += BATCH_SIZE) {
      const batch = updateBatch.slice(i, i + BATCH_SIZE);

      // Update all channels in this batch in parallel
      await Promise.all(
        batch.map((item) =>
          prisma.channel.updateMany({
            where: {
              playlistId,
              streamId: item.streamId,
            },
            data: {
              channelMapping: item.mapping,
            },
          })
        )
      );

      updatedCount += batch.length;
      console.log(
        `Updated batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
          updateBatch.length / BATCH_SIZE
        )} (${updatedCount}/${updateBatch.length} total)`
      );
    }

    console.log(
      `Import results: ${updatedCount} updated, ${mappedCount} mapped, ${notFoundCount} not found`
    );
    console.log(
      `Match strategies: ${matchByExtracted} by extracted ID, ${matchByStreamId} by streamId, ${matchByTvgName} by tvgName`
    );

    res.json({
      success: true,
      updated: updatedCount,
      mapped: mappedCount,
      notFound: notFoundCount,
      notFoundChannels: notFoundChannels,
      message: `Import complete: ${updatedCount} channels updated, ${mappedCount} mapped, ${notFoundCount} not found.`,
    });
  } catch (error: any) {
    console.error("Import error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/playlists/:id/copy-mappings - Copy channel mappings from another playlist
 */
router.post("/:id/copy-mappings", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const targetPlaylistId = parseInt(req.params.id);
    const { sourcePlaylistId } = req.body;

    if (!sourcePlaylistId) {
      return res.status(400).json({ error: "Source playlist ID is required" });
    }

    // Verify both playlists belong to the user
    const [sourcePlaylist, targetPlaylist] = await Promise.all([
      PlaylistRepository.findById(sourcePlaylistId, userId),
      PlaylistRepository.findById(targetPlaylistId, userId),
    ]);

    if (!sourcePlaylist) {
      return res.status(404).json({ error: "Source playlist not found" });
    }
    if (!targetPlaylist) {
      return res.status(404).json({ error: "Target playlist not found" });
    }

    console.log(
      `Copying mappings from playlist ${sourcePlaylist.name} to ${targetPlaylist.name}`
    );

    // Get mapped channels from source playlist
    const sourceChannels = await prisma.channel.findMany({
      where: {
        playlistId: sourcePlaylistId,
        channelMapping: { not: null },
      },
      select: {
        streamId: true,
        channelMapping: true,
      },
    });

    console.log(
      `Found ${sourceChannels.length} mapped channels in source playlist`
    );

    // Get all channels from target playlist for matching
    const targetChannels = await PlaylistRepository.getChannels(
      targetPlaylistId
    );

    // Get channel lineup for validation
    const channelLineup = await prisma.channelLineup.findMany({
      where: { userId },
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

    let updatedCount = 0;
    let mappedCount = 0;
    let notFoundCount = 0;
    const notFoundChannels: Array<{ channelName: string; channelId: any }> = [];

    // Copy mappings by matching streamId
    for (const sourceChannel of sourceChannels) {
      const targetChannel = targetChannels.find(
        (ch) => ch.streamId === sourceChannel.streamId
      );

      if (!targetChannel) {
        // Try to extract channel name from mapping for reporting
        try {
          const mapping = JSON.parse(sourceChannel.channelMapping || "{}");
          notFoundCount++;
          notFoundChannels.push({
            channelName: mapping.name || "Unknown",
            channelId: sourceChannel.streamId,
          });
        } catch (e) {
          notFoundCount++;
          notFoundChannels.push({
            channelName: "Unknown",
            channelId: sourceChannel.streamId,
          });
        }
        continue;
      }

      // Verify the mapping still exists in channel lineup
      try {
        const mapping = JSON.parse(sourceChannel.channelMapping || "{}");
        const lineupEntry = lineupMap.get(mapping.name?.toLowerCase());

        if (!lineupEntry) {
          notFoundCount++;
          notFoundChannels.push({
            channelName: mapping.name || "Unknown",
            channelId: sourceChannel.streamId,
          });
          continue;
        }

        // Copy the mapping to target channel
        await prisma.channel.updateMany({
          where: {
            playlistId: targetPlaylistId,
            streamId: targetChannel.streamId,
          },
          data: {
            channelMapping: sourceChannel.channelMapping,
          },
        });

        updatedCount++;
        mappedCount++;
      } catch (e) {
        console.error(
          `Error copying mapping for channel ${sourceChannel.streamId}:`,
          e
        );
      }
    }

    console.log(
      `Copy results: ${updatedCount} updated, ${mappedCount} mapped, ${notFoundCount} not found`
    );

    res.json({
      success: true,
      updated: updatedCount,
      mapped: mappedCount,
      notFound: notFoundCount,
      notFoundChannels: notFoundChannels,
      message: `Copied mappings: ${mappedCount} channels mapped, ${notFoundCount} not found in target playlist.`,
    });
  } catch (error: any) {
    console.error("Copy mappings error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/playlists/:id/channels/:streamId/mapping - Update channel mapping
 */
router.put(
  "/:id/channels/:streamId/mapping",
  async (req: Request, res: Response) => {
    try {
      const playlistId = parseInt(req.params.id);
      const { streamId } = req.params;
      const { name, logo, tvgId, extGrp } = req.body;

      if (!name || !logo) {
        return res.status(400).json({ error: "Missing name or logo" });
      }

      // Include tvgId in the mapping JSON so it's preserved during sync
      const mapping = JSON.stringify({ name, logo, extGrp, tvgId });

      // Update channelMapping (which now includes tvgId)
      const result = await prisma.channel.updateMany({
        where: {
          playlistId,
          streamId,
        },
        data: {
          channelMapping: mapping,
        },
      });

      if (result.count === 0) {
        return res.status(404).json({ error: "Channel not found" });
      }

      res.json({ success: true, mapping: { name, logo, tvgId, extGrp } });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * DELETE /api/playlists/:id/channels/:streamId/mapping - Remove channel mapping
 */
router.delete(
  "/:id/channels/:streamId/mapping",
  async (req: Request, res: Response) => {
    try {
      const playlistId = parseInt(req.params.id);
      const { streamId } = req.params;

      const result = await prisma.channel.updateMany({
        where: {
          playlistId,
          streamId,
        },
        data: {
          channelMapping: null,
        },
      });

      if (result.count === 0) {
        return res.status(404).json({ error: "Channel not found" });
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * POST /api/playlists/generate-regex - Generate regex from sample URL and identifier
 */
router.post("/generate-regex", async (req: Request, res: Response) => {
  try {
    const { sampleUrl, expectedIdentifier, identifier } = req.body;
    const idValue = expectedIdentifier || identifier;

    if (!sampleUrl || !idValue) {
      return res.status(400).json({
        error: "Both sampleUrl and identifier are required",
      });
    }

    // Find the identifier in the URL
    const index = sampleUrl.indexOf(idValue);

    if (index === -1) {
      return res.status(400).json({
        error: "Identifier not found in the sample URL",
      });
    }

    // Determine if identifier is numeric
    const isNumeric = /^\d+$/.test(idValue);
    const captureGroup = isNumeric ? "(\\d+)" : "([^/]+)";

    // Get context around the identifier (a few characters before and after)
    const contextLength = 10; // Look at 10 chars before/after for pattern
    const beforeContext = sampleUrl.substring(
      Math.max(0, index - contextLength),
      index
    );
    const afterContext = sampleUrl.substring(
      index + idValue.length,
      Math.min(sampleUrl.length, index + idValue.length + contextLength)
    );

    // Build a minimal, generic regex pattern
    // Strategy: Find the last meaningful delimiter before (/, -, _) and first meaningful part after

    // Find the last delimiter before the identifier
    const beforeDelimiterMatch = beforeContext.match(/[\/\-_]([^\/\-_]*)$/);
    const beforePattern = beforeDelimiterMatch
      ? beforeDelimiterMatch[0]
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(
            new RegExp(idValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"),
            ""
          )
      : "";

    // Find the first meaningful part after (file extension, delimiter, etc.)
    const afterDelimiterMatch = afterContext.match(/^([^\/\?#]*)/);
    const afterPattern = afterDelimiterMatch
      ? afterDelimiterMatch[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      : "";

    // Check if this is at the end of the URL (or before query params)
    const isAtEnd =
      index + idValue.length + afterPattern.length >= sampleUrl.length ||
      sampleUrl[index + idValue.length + afterPattern.length] === "?" ||
      sampleUrl[index + idValue.length + afterPattern.length] === "#";

    // Build the regex
    let regex = `${beforePattern}${captureGroup}${afterPattern}`;

    // Add end anchor if identifier is at the end
    if (isAtEnd && !regex.endsWith("$")) {
      regex += "$";
    }

    // Test the generated regex
    const testRegex = new RegExp(regex);
    const match = sampleUrl.match(testRegex);

    if (!match || match[1] !== idValue) {
      return res.status(400).json({
        error:
          "Generated regex does not correctly extract the identifier. Please check your inputs.",
      });
    }

    // Create a human-readable explanation
    const beforeDesc = beforePattern
      ? `"${beforePattern.replace(/\\/g, "")}"`
      : "start";
    const afterDesc = afterPattern
      ? `"${afterPattern.replace(/\\/g, "")}"`
      : "end";
    const explanation = `This regex will extract the identifier from URLs where it appears between ${beforeDesc} and ${afterDesc}`;

    res.json({
      regex,
      explanation,
      test: {
        sampleUrl,
        extracted: match[1],
        success: match[1] === idValue,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
