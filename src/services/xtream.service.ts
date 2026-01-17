import axios from "axios";
import {
  XtreamCredentials,
  XtreamAuthResponse,
  XtreamCategory,
  XtreamChannel,
  Channel,
  Category,
} from "../types";
import { isDebugMode } from "../database/prisma";
import { M3UService } from "./m3u.service";

export class XtreamService {
  /**
   * Test Xtream Codes credentials
   */
  static async authenticate(
    credentials: XtreamCredentials
  ): Promise<XtreamAuthResponse> {
    const { url, username, password } = credentials;
    const apiUrl = `${url}/player_api.php?username=${username}&password=${password}`;

    try {
      const response = await axios.get<XtreamAuthResponse>(apiUrl, {
        timeout: 10000,
      });

      if (response.data.user_info && response.data.user_info.auth === 1) {
        return response.data;
      }

      throw new Error("Authentication failed");
    } catch (error: any) {
      throw new Error(`Xtream authentication failed: ${error.message}`);
    }
  }

  /**
   * Get live TV categories
   */
  static async getCategories(
    credentials: XtreamCredentials
  ): Promise<XtreamCategory[]> {
    const { url, username, password } = credentials;
    const apiUrl = `${url}/player_api.php?username=${username}&password=${password}&action=get_live_categories`;

    try {
      const response = await axios.get<XtreamCategory[]>(apiUrl, {
        timeout: 15000,
      });
      return response.data || [];
    } catch (error: any) {
      throw new Error(`Failed to fetch categories: ${error.message}`);
    }
  }

  /**
   * Get live TV channels (optionally filtered by category)
   * Note: For very large providers we fetch per-category to avoid connection resets.
   */
  static async getChannels(
    credentials: XtreamCredentials,
    categoryId?: string
  ): Promise<XtreamChannel[]> {
    const { url, username, password } = credentials;
    let apiUrl = `${url}/player_api.php?username=${username}&password=${password}&action=get_live_streams`;

    if (categoryId) {
      apiUrl += `&category_id=${categoryId}`;
    }

    try {
      const response = await axios.get<XtreamChannel[]>(apiUrl, {
        timeout: 60000,
      });

      // Log sample channel data for debugging (first 3 channels)
      if (response.data && response.data.length > 0 && (await isDebugMode())) {
        console.log("\n========== CHANNEL DATA SAMPLE ==========");
        response.data.slice(0, 3).forEach((ch, idx) => {
          console.log(`\nChannel ${idx + 1}: ${ch.name}`);
          console.log("Available fields:", Object.keys(ch).join(", "));
          console.log("EPG-related fields:", {
            epg_channel_id: ch.epg_channel_id || "NOT SET",
            epg_id: (ch as any).epg_id || "NOT SET",
            tvg_id: (ch as any).tvg_id || "NOT SET",
            channel_id: (ch as any).channel_id || "NOT SET",
          });
        });
        console.log("\n=========================================\n");
      }

      return response.data || [];
    } catch (error: any) {
      // Bubble up with context for caller-side retries
      throw new Error(
        `Failed to fetch channels${categoryId ? ` for category ${categoryId}` : ""}: ${error.message}`
      );
    }
  }

  /**
   * Fetch channels per category with controlled concurrency to reduce connection resets
   */
  static async getChannelsBatched(
    credentials: XtreamCredentials,
    categories: XtreamCategory[]
  ): Promise<XtreamChannel[]> {
    if (!categories || categories.length === 0) {
      // Fallback to single request
      return this.getChannels(credentials);
    }

    const results: XtreamChannel[] = [];
    const errors: string[] = [];

    // Limit concurrency to 3 to avoid hammering provider
    const MAX_CONCURRENCY = 3;
    let index = 0;

    const worker = async () => {
      while (index < categories.length) {
        const current = categories[index++];
        try {
          const chans = await this.getChannels(credentials, current.category_id);
          results.push(...chans);
        } catch (err: any) {
          errors.push(
            `Category ${current.category_id} (${current.category_name}): ${err.message}`
          );
        }
      }
    };

    const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, categories.length) }).map(
      () => worker()
    );
    await Promise.all(workers);

    if (errors.length > 0 && (await isDebugMode())) {
      console.warn("Some categories failed to load:", errors);
    }

    return results;
  }

  /**
   * Get detailed stream information (alternative method to fetch EPG data)
   */
  static async getStreamInfo(
    credentials: XtreamCredentials,
    streamId: number
  ): Promise<any> {
    const { url, username, password } = credentials;
    const apiUrl = `${url}/player_api.php?username=${username}&password=${password}&action=get_simple_data_table&stream_id=${streamId}`;

    try {
      const response = await axios.get(apiUrl, { timeout: 5000 });
      return response.data || null;
    } catch (error: any) {
      // Silently fail, this is just an additional attempt
      return null;
    }
  }

  /**
   * Try to fetch XMLTV EPG data and extract channel mappings
   */
  static async getXMLTVChannelMappings(
    credentials: XtreamCredentials
  ): Promise<Map<string, string>> {
    const { url, username, password } = credentials;
    const xmltvUrl = `${url}/xmltv.php?username=${username}&password=${password}`;
    const mappings = new Map<string, string>();

    try {
      const response = await axios.get(xmltvUrl, {
        timeout: 15000,
        responseType: "text",
      });

      // Parse XMLTV to extract channel IDs
      const channelMatches = response.data.matchAll(
        /<channel id="([^"]+)"[^>]*>[\s\S]*?<display-name[^>]*>([^<]+)<\/display-name>/g
      );

      for (const match of channelMatches) {
        const xmltvId = match[1];
        const displayName = match[2].trim();
        mappings.set(displayName, xmltvId);
      }

      return mappings;
    } catch (error: any) {
      // XMLTV might not be available, return empty mappings
      return mappings;
    }
  }

  /**
   * Fetch and parse M3U playlist from Xtream provider
   * This gets the actual stream URLs and all metadata tags
   */
  static async getM3UPlaylist(
    credentials: XtreamCredentials
  ): Promise<Map<string, any>> {
    const { url, username, password } = credentials;
    const m3uUrl = `${url}/get.php?username=${username}&password=${password}&type=m3u_plus&output=ts`;
    const channelMap = new Map<string, any>();

    try {
      if (await isDebugMode()) {
        console.log("Fetching M3U playlist for enhanced metadata...");
      }

      const m3uContent = await M3UService.fetchM3U(m3uUrl);
      const m3uChannels = M3UService.parseM3U(m3uContent);

      if (await isDebugMode()) {
        console.log(`Parsed ${m3uChannels.length} channels from M3U playlist`);
      }

      // Create multiple indexes for better matching:
      // 1. By xui-id (most reliable)
      // 2. By stream ID from URL
      // 3. By channel name (fallback)
      const byXuiId = new Map<string, any>();
      const byStreamId = new Map<string, any>();
      const byName = new Map<string, any>();

      m3uChannels.forEach((channel) => {
        // Index by xui-id if available
        if (channel.xuiId) {
          byXuiId.set(channel.xuiId, channel);
        }

        // Index by stream ID from URL
        const streamIdMatch = channel.url.match(/\/(\d+)\.(ts|m3u8?)$/);
        if (streamIdMatch) {
          const streamId = streamIdMatch[1];
          byStreamId.set(streamId, channel);
        }

        // Index by name (lowercase for case-insensitive matching)
        byName.set(channel.name.toLowerCase(), channel);
      });

      // Combine into a single map with xui-id as primary key and name as secondary
      byXuiId.forEach((channel, xuiId) =>
        channelMap.set(`xui:${xuiId}`, channel)
      );
      byStreamId.forEach((channel, streamId) =>
        channelMap.set(`stream:${streamId}`, channel)
      );
      byName.forEach((channel, name) =>
        channelMap.set(`name:${name}`, channel)
      );

      if (await isDebugMode()) {
        console.log(
          `Indexed M3U channels: ${byXuiId.size} by xui-id, ${byStreamId.size} by stream ID, ${byName.size} by name`
        );
      }

      return channelMap;
    } catch (error: any) {
      if (await isDebugMode()) {
        console.log(`Failed to fetch M3U playlist: ${error.message}`);
      }
      // Return empty map if M3U fetch fails
      return channelMap;
    }
  }

  /**
   * Convert Xtream channel to internal Channel format
   */
  static convertChannel(
    xtreamChannel: XtreamChannel,
    playlistId: number,
    credentials: XtreamCredentials,
    xmltvMappings?: Map<string, string>,
    m3uData?: Map<string, any>
  ): Channel {
    const { url, username, password } = credentials;
    const streamIdStr = String(xtreamChannel.stream_id);

    // Try to find M3U data using multiple matching strategies:
    // 1. By xui-id if available from API
    // 2. By stream ID
    // 3. By channel name (lowercase)
    let m3uChannel = null;
    if (m3uData) {
      // Try xui-id first
      if (xtreamChannel.xui_id) {
        m3uChannel = m3uData.get(`xui:${xtreamChannel.xui_id}`);
      }
      // Fallback to stream ID
      if (!m3uChannel) {
        m3uChannel = m3uData.get(`stream:${streamIdStr}`);
      }
      // Fallback to name
      if (!m3uChannel) {
        m3uChannel = m3uData.get(`name:${xtreamChannel.name.toLowerCase()}`);
      }
    }

    // Use actual stream URL from M3U if available, otherwise reconstruct
    const streamUrl =
      m3uChannel?.url ||
      `${url}/live/${username}/${password}/${xtreamChannel.stream_id}.ts`;

    // Try multiple possible field names for EPG channel ID
    let epgChannelId =
      xtreamChannel.epg_channel_id ||
      (xtreamChannel as any).epg_id ||
      (xtreamChannel as any).tvg_id ||
      (xtreamChannel as any).channel_id ||
      m3uChannel?.tvgId ||
      undefined;

    // If no EPG ID found and we have XMLTV mappings, try to find by channel name
    if (!epgChannelId && xmltvMappings && xmltvMappings.size > 0) {
      epgChannelId = xmltvMappings.get(xtreamChannel.name) || undefined;
    }

    const fallbackCatchupDays =
      m3uChannel?.catchupDays ??
      (xtreamChannel.tv_archive_duration
        ? String(xtreamChannel.tv_archive_duration)
        : xtreamChannel.tv_archive
          ? "1"
          : null);

    return {
      playlistId,
      streamId: streamIdStr,
      name: xtreamChannel.name,
      streamUrl,
      streamIcon: xtreamChannel.stream_icon || m3uChannel?.tvgLogo || null,
      epgChannelId: epgChannelId,
      categoryId: xtreamChannel.category_id || null,
      categoryName: null,
      added: xtreamChannel.added || null,
      duration: m3uChannel?.duration || "-1", // Default to -1 if not specified
      tvgId: m3uChannel?.tvgId || epgChannelId,
      tvgName: m3uChannel?.tvgName || xtreamChannel.name || null,
      tvgLogo: m3uChannel?.tvgLogo || xtreamChannel.stream_icon || null,
      groupTitle: m3uChannel?.groupTitle || null, // Will be set from category mapping
      // Extract all additional metadata from M3U if available
      timeshift: m3uChannel?.timeshift || null,
      tvgRec: m3uChannel?.tvgRec || null,
      tvgChno: m3uChannel?.tvgChno || null,
      catchup: m3uChannel?.catchup || null,
      catchupDays: fallbackCatchupDays,
      catchupSource: m3uChannel?.catchupSource || null,
      catchupCorrection: m3uChannel?.catchupCorrection || null,
      // For Xtream, xui-id from M3U takes priority, then API xui_id, then stream_id
      xuiId:
        m3uChannel?.xuiId ||
        (xtreamChannel.xui_id
          ? String(xtreamChannel.xui_id)
          : String(xtreamChannel.stream_id)),
    } as any;
  }

  /**
   * Convert Xtream category to internal Category format
   */
  static convertCategory(
    xtreamCategory: XtreamCategory,
    playlistId: number
  ): Category {
    return {
      playlistId,
      categoryId: xtreamCategory.category_id,
      categoryName: xtreamCategory.category_name,
      parentId: xtreamCategory.parent_id || null,
    } as any;
  }

  /**
   * Sync all data from Xtream Codes provider
   * Optimized: Skips provider EPG fetch since users provide their own EPG files
   */
  static async syncPlaylist(
    playlistId: number,
    credentials: XtreamCredentials,
    categoryFilters?: string[]
  ): Promise<{
    categories: Category[];
    allCategories: Category[];
    channels: Channel[];
  }> {
    const syncStart = Date.now();

    // First authenticate
    await this.authenticate(credentials);

    // Get categories
    const xtreamCategories = await this.getCategories(credentials);

    // All categories (for persistence and UI)
    const allCategories = xtreamCategories.map((cat) =>
      this.convertCategory(cat, playlistId)
    );

    // If filters provided, keep only those categories for channel fetch
    const filteredCategories =
      categoryFilters && categoryFilters.length > 0
        ? xtreamCategories.filter((c) =>
            categoryFilters.includes(c.category_id)
          )
        : xtreamCategories;

    const categories = filteredCategories.map((cat) =>
      this.convertCategory(cat, playlistId)
    );

    // Try to fetch M3U playlist for enhanced metadata (stream URLs, timeshift, catchup)
    // Use short timeout to avoid delaying sync - this is optional metadata.
    // For very large providers, skip M3U enrichment to reduce load/timeout risk.
    let m3uData = new Map<string, any>();
    const skipM3U = xtreamCategories.length > 200; // heuristic for very large providers
    if (!skipM3U) {
      if (await isDebugMode()) {
        console.log("Fetching M3U playlist for enhanced metadata...");
      }
      try {
        // Use Promise.race with 3-second timeout to fail fast
        m3uData = await Promise.race([
          this.getM3UPlaylist(credentials),
          new Promise<Map<string, any>>((_, reject) =>
            setTimeout(() => reject(new Error("M3U fetch timeout (3s)")), 3000)
          ),
        ]);
      } catch (error: any) {
        if (await isDebugMode()) {
          console.log(
            `Skipping M3U metadata (${error.message}), continuing with basic data`
          );
        }
      }
    } else if (await isDebugMode()) {
      console.log(
        `Skipping M3U enrichment because provider has ${xtreamCategories.length} categories (very large)`
      );
    }

    // SKIP provider XMLTV EPG fetch - users provide their own EPG files and map channels manually
    // This saves ~5 seconds on sync for large playlists

    // Get all channels (batched per category; filtered when provided)
    const xtreamChannels = await this.getChannelsBatched(
      credentials,
      filteredCategories
    );
    const channels = xtreamChannels.map((ch) =>
      this.convertChannel(ch, playlistId, credentials, undefined, m3uData)
    );

    // Map category names to channels
    const categoryMap = new Map(
      categories.map((cat) => [cat.categoryId, cat.categoryName])
    );
    channels.forEach((channel) => {
      if (channel.categoryId) {
        const categoryName = categoryMap.get(channel.categoryId);
        channel.categoryName = categoryName || null;
        // Only override groupTitle if it wasn't set from M3U data
        if (!channel.groupTitle) {
          channel.groupTitle = categoryName || null;
        }
      }
    });

    // Log statistics
    if (await isDebugMode()) {
      const syncTime = ((Date.now() - syncStart) / 1000).toFixed(2);
      const channelsWithTimeshift = channels.filter(
        (ch) => ch.timeshift
      ).length;
      console.log(
        `✅ Synced ${channels.length.toLocaleString()} channels and ${
          categories.length
        } categories in ${syncTime}s`
      );
      console.log(
        `Metadata Coverage: ${channelsWithTimeshift} channels have timeshift data`
      );
    }

    return { categories, allCategories, channels };
  }
}
