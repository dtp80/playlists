import { Router, Request, Response } from "express";
import { prisma } from "../database/prisma";
import { ExportService } from "../services/export.service";

const router = Router();

/**
 * GET /playlist/:uniqueId - Public endpoint for external playlist access
 * Supports both Xtream Codes (username/password) and M3U (token) authentication
 */
router.get("/:uniqueId", async (req: Request, res: Response) => {
  try {
    const { uniqueId } = req.params;
    const { u: username, p: password, t: token } = req.query;

    console.log(
      `📡 External playlist access request for uniqueId: ${uniqueId}`
    );

    // Find playlist by uniqueId
    const playlist = await prisma.playlist.findUnique({
      where: { uniqueId },
      select: {
        id: true,
        userId: true,
        name: true,
        type: true,
        url: true,
        username: true,
        password: true,
        externalAccessEnabled: true,
        externalAccessToken: true,
        hiddenCategories: true,
        excludedChannels: true,
        includeUncategorizedChannels: true,
        epgFileId: true,
        epgGroupId: true,
      },
    });

    if (!playlist) {
      console.log(`❌ Playlist not found: ${uniqueId}`);
      return res.status(404).send("Playlist not found");
    }

    // Check if external access is enabled
    if (!playlist.externalAccessEnabled) {
      console.log(`🔒 External access disabled for playlist: ${playlist.name}`);
      return res
        .status(403)
        .send("External access is disabled for this playlist");
    }

    // Validate credentials based on playlist type
    if (playlist.type === "xtream") {
      // Xtream Codes: validate username and password
      if (!username || !password) {
        console.log(`⚠️ Missing username or password for Xtream playlist`);
        return res
          .status(401)
          .send("Username and password are required for this playlist");
      }

      if (username !== playlist.username || password !== playlist.password) {
        console.log(`❌ Invalid credentials for Xtream playlist`);
        return res.status(401).send("Invalid credentials");
      }
    } else if (playlist.type === "m3u") {
      // M3U: validate token
      if (!token) {
        console.log(`⚠️ Missing token for M3U playlist`);
        return res.status(401).send("Token is required for this playlist");
      }

      if (token !== playlist.externalAccessToken) {
        console.log(`❌ Invalid token for M3U playlist`);
        return res.status(401).send("Invalid token");
      }
    } else {
      console.log(`❌ Unsupported playlist type: ${playlist.type}`);
      return res.status(400).send("Unsupported playlist type");
    }

    console.log(`✅ Authentication successful for playlist: ${playlist.name}`);

    // Get all channels from the playlist
    const channels = await prisma.channel.findMany({
      where: { playlistId: playlist.id },
      orderBy: { name: "asc" },
    });

    console.log(`📺 Found ${channels.length} channels`);

    // Apply filters (same logic as filtered export)
    const hiddenCategoryIds = playlist.hiddenCategories
      ? JSON.parse(playlist.hiddenCategories)
      : [];
    const excludedChannelIds = playlist.excludedChannels
      ? JSON.parse(playlist.excludedChannels)
      : [];
    const includeUncategorized = playlist.includeUncategorizedChannels !== 0;

    let filteredChannels = channels.filter((ch) => {
      // Exclude explicitly excluded channels
      if (excludedChannelIds.includes(ch.streamId)) {
        return false;
      }

      // Check category filters
      if (hiddenCategoryIds.length > 0) {
        if (!ch.categoryId || ch.categoryId.trim() === "") {
          // Uncategorized channel - include only if includeUncategorized is true
          return includeUncategorized;
        } else {
          // Categorized channel - exclude if in hidden categories
          return !hiddenCategoryIds.includes(ch.categoryId);
        }
      }

      return true;
    });

    console.log(
      `📤 Exporting ${filteredChannels.length} filtered channels (${
        channels.length - filteredChannels.length
      } filtered out)`
    );

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
        where: { userId: playlist.userId, isDefault: true },
        select: { url: true },
      });
      const defaultEpgGroup = await prisma.epgGroup.findFirst({
        where: { userId: playlist.userId, isDefault: true },
        select: { url: true },
      });
      epgUrl = defaultEpgFile?.url || defaultEpgGroup?.url;
    }

    // Generate M3U content
    const m3uContent = ExportService.generateM3U(
      filteredChannels as any,
      true,
      epgUrl
    );

    // Set appropriate headers
    res.setHeader("Content-Type", "application/x-mpegURL");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${playlist.name}.m3u"`
    );
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    console.log(`✅ Successfully served playlist: ${playlist.name}`);
    res.send(m3uContent);
  } catch (error: any) {
    console.error("❌ External playlist access error:", error);
    res.status(500).send("Internal server error");
  }
});

export default router;
