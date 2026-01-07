import { Router, Request, Response } from "express";
import prisma, { isDebugMode, getSyncTimeout } from "../database/prisma";

const router = Router();

/**
 * GET /api/channel-lineup - Get all channels for mapping (user-specific)
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;

    const channels = await prisma.channelLineup.findMany({
      where: { userId },
      select: {
        name: true,
        tvgLogo: true,
        tvgId: true,
        extGrp: true,
      },
      orderBy: { name: "asc" },
    });

    const formatted = channels.map((ch) => ({
      name: ch.name,
      logo: ch.tvgLogo,
      tvgId: ch.tvgId,
      extGrp: ch.extGrp,
    }));

    res.json(formatted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/channel-lineup/admin - Get all channels with full details for admin
 * Channels are sorted by category first (using min sortOrder of channels in category),
 * then by individual channel sortOrder within each category
 * Query params: epgFileId (optional) - Filter channels by EPG file
 */
router.get("/admin", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const userEmail = (req as any).session.user.email;
    const epgFileId = req.query.epgFileId ? parseInt(req.query.epgFileId as string) : undefined;

    console.log(`📺 Loading channel lineup for user: ${userEmail} (ID: ${userId})${epgFileId ? ` for EPG file: ${epgFileId}` : ' (all EPG files)'}`);

    // Build where clause
    const where: any = { userId };
    if (epgFileId) {
      where.epgFileId = epgFileId;
    }

    // Get all channels for this user (optionally filtered by EPG file)
    const channels = await prisma.channelLineup.findMany({
      where,
      select: {
        id: true,
        name: true,
        tvgLogo: true,
        tvgId: true,
        extGrp: true,
        sortOrder: true,
        epgFileId: true,
      },
    });

    console.log(`✅ Found ${channels.length} channels for user ${userEmail}`);

    // Calculate min sortOrder per category for category ordering
    const categoryMinSort = new Map<string | null, number>();
    channels.forEach((ch) => {
      const category = ch.extGrp;
      const currentMin = categoryMinSort.get(category);
      if (currentMin === undefined || ch.sortOrder < currentMin) {
        categoryMinSort.set(category, ch.sortOrder);
      }
    });

    // Sort channels: first by category order (min sortOrder), then by individual sortOrder
    const sorted = channels.sort((a, b) => {
      const aCategoryMin = categoryMinSort.get(a.extGrp) || 0;
      const bCategoryMin = categoryMinSort.get(b.extGrp) || 0;

      // First compare by category order
      if (aCategoryMin !== bCategoryMin) {
        return aCategoryMin - bCategoryMin;
      }

      // If same category, compare by individual sortOrder
      return a.sortOrder - b.sortOrder;
    });

    res.json(sorted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/channel-lineup/categories - Get unique categories ordered by their channels' sortOrder
 * Query params: epgFileId (optional) - Filter categories by EPG file
 */
router.get("/categories", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const userEmail = (req as any).session.user.email;
    const epgFileId = req.query.epgFileId ? parseInt(req.query.epgFileId as string) : undefined;

    console.log(`📋 Loading categories for user: ${userEmail} (ID: ${userId})${epgFileId ? ` for EPG file: ${epgFileId}` : ' (all EPG files)'}`);

    // Build where clause
    const where: any = {
      userId,
      extGrp: { not: null },
    };
    if (epgFileId) {
      where.epgFileId = epgFileId;
    }

    const categories = await prisma.channelLineup.groupBy({
      by: ["extGrp"],
      where,
      _min: {
        sortOrder: true,
      },
      orderBy: {
        _min: {
          sortOrder: "asc",
        },
      },
    });

    console.log(`✅ Found ${categories.length} categories for user ${userEmail}:`, categories.map(c => c.extGrp));

    // Return just the names
    res.json(categories.map((cat) => ({ name: cat.extGrp })));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/channel-lineup - Create a new channel
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const { name, tvgLogo, tvgId, extGrp } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Channel name is required" });
    }

    // Get max sortOrder for this category and user
    const maxSort = await prisma.channelLineup.aggregate({
      _max: {
        sortOrder: true,
      },
      where: {
        userId,
        extGrp: extGrp || null,
      },
    });

    const sortOrder = (maxSort._max.sortOrder || 0) + 1;

    const newChannel = await prisma.channelLineup.create({
      data: {
        userId,
        name,
        tvgLogo: tvgLogo || null,
        tvgId: tvgId || null,
        extGrp: extGrp || null,
        sortOrder,
      },
    });

    res.status(201).json(newChannel);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/channel-lineup/reorder - Reorder channels
 * IMPORTANT: This must be defined BEFORE the /:id route to avoid conflicts
 */
router.put("/reorder", async (req: Request, res: Response) => {
  if (await isDebugMode()) {
    console.log("=== REORDER ENDPOINT HIT ===");
    console.log("Request body:", JSON.stringify(req.body, null, 2));
    console.log("Body type:", typeof req.body);
    console.log("Body keys:", Object.keys(req.body));
  }

  try {
    const { channels } = req.body as {
      channels: Array<{ id: number; sortOrder: number }>;
    };

    if (await isDebugMode()) {
      console.log("Extracted channels:", channels);
      console.log("Channels type:", typeof channels);
      console.log("Is array?:", Array.isArray(channels));
    }

    if (!channels) {
      return res.status(400).json({ error: "Missing channels field" });
    }

    if (!Array.isArray(channels)) {
      return res.status(400).json({ error: "Invalid channels array" });
    }

    if (channels.length === 0) {
      return res.status(400).json({ error: "Empty channels array" });
    }

    // Validate each channel object
    for (const channel of channels) {
      if (
        typeof channel.id !== "number" ||
        typeof channel.sortOrder !== "number"
      ) {
        console.error("Invalid channel object:", channel);
        return res.status(400).json({
          error: "Invalid channel object format",
          received: channel,
        });
      }
    }

    const userId = (req as any).session.user.id;

    // Update channels (only user's own channels)
    await prisma.$transaction(
      channels.map((channel) =>
        prisma.channelLineup.updateMany({
          where: {
            id: channel.id,
            userId, // Only update if channel belongs to user
          },
          data: { sortOrder: channel.sortOrder },
        })
      )
    );

    if (await isDebugMode()) {
      console.log("Reorder successful");
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error("Reorder error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/channel-lineup/:id - Update a channel
 */
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const id = parseInt(req.params.id);
    const { name, tvgLogo, tvgId, extGrp } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Channel name is required" });
    }

    try {
      // Verify channel belongs to user, then update
      const result = await prisma.channelLineup.updateMany({
        where: { id, userId },
        data: {
          name,
          tvgLogo: tvgLogo || null,
          tvgId: tvgId || null,
          extGrp: extGrp || null,
        },
      });

      if (result.count === 0) {
        return res.status(404).json({ error: "Channel not found" });
      }

      // Fetch the updated channel to return
      const updated = await prisma.channelLineup.findFirst({
        where: { id, userId },
      });

      res.json(updated);
    } catch (error) {
      return res.status(404).json({ error: "Channel not found" });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/channel-lineup/:id - Delete a channel
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const id = parseInt(req.params.id);

    try {
      // Verify channel belongs to user, then delete
      const result = await prisma.channelLineup.deleteMany({
        where: { id, userId },
      });

      if (result.count === 0) {
        return res.status(404).json({ error: "Channel not found" });
      }

      res.json({ success: true });
    } catch (error) {
      return res.status(404).json({ error: "Channel not found" });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/channel-lineup/category/rename - Rename a category
 */
router.put("/category/rename", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const { oldName, newName } = req.body;

    if (!oldName || !newName) {
      return res
        .status(400)
        .json({ error: "Old name and new name are required" });
    }

    if (oldName === newName) {
      return res.json({ success: true, message: "No change needed" });
    }

    // Update all user's channels with the old category name to the new name
    const result = await prisma.channelLineup.updateMany({
      where: {
        userId,
        extGrp: oldName,
      },
      data: { extGrp: newName },
    });

    res.json({
      success: true,
      updatedCount: result.count,
      message: `Updated ${result.count} channel(s)`,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/channel-lineup/import - Import channel lineup from JSON to add/update channels
 */
router.post("/import", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).session.user.id;
    const { channels } = req.body;

    if (!channels || !Array.isArray(channels)) {
      return res.status(400).json({ error: "Invalid channels array" });
    }

    // Get all existing lineup channels for this user
    const existingLineup = await prisma.channelLineup.findMany({
      where: { userId },
      select: {
        name: true,
        tvgLogo: true,
        tvgId: true,
        extGrp: true,
      },
    });

    const lineupMap = new Map(
      existingLineup.map((ch) => [
        ch.name,
        { logo: ch.tvgLogo, tvgId: ch.tvgId, extGrp: ch.extGrp },
      ])
    );

    let addedCount = 0;
    let updatedCount = 0;

    // Get max sortOrder for this user
    const maxSortResult = await prisma.channelLineup.aggregate({
      where: { userId },
      _max: {
        sortOrder: true,
      },
    });
    let currentMaxSort = maxSortResult._max.sortOrder || 0;

    const timeout = await getSyncTimeout();
    await prisma.$transaction(
      async (tx) => {
        for (const channel of channels) {
          const channelName = channel.channelName;
          if (!channelName) continue;

          if (lineupMap.has(channelName)) {
            // Update existing channel
            const updateData: any = {};
            if (channel.tvgLogo) updateData.tvgLogo = channel.tvgLogo;
            if (channel.tvgId) updateData.tvgId = channel.tvgId;
            if (channel.extGrp) updateData.extGrp = channel.extGrp;

            if (Object.keys(updateData).length > 0) {
              await tx.channelLineup.updateMany({
                where: { userId, name: channelName },
                data: updateData,
              });
              updatedCount++;
            }
          } else {
            // Add new channel
            currentMaxSort++;
            await tx.channelLineup.create({
              data: {
                userId,
                name: channelName,
                tvgLogo: channel.tvgLogo || null,
                tvgId: channel.tvgId || null,
                extGrp: channel.extGrp || null,
                sortOrder: currentMaxSort,
              },
            });
            addedCount++;
          }
        }
      },
      {
        timeout,
      }
    );

    res.json({
      success: true,
      added: addedCount,
      updated: updatedCount,
      message: `Import complete: ${addedCount} added, ${updatedCount} updated`,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
