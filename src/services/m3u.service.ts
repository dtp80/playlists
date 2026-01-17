import axios from "axios";
import { Channel, Category } from "../types";

interface M3UChannelInfo {
  name: string;
  url: string;
  duration?: string;
  tvgId?: string;
  tvgName?: string;
  tvgLogo?: string;
  groupTitle?: string;
  timeshift?: string;
  tvgRec?: string;
  tvgChno?: string;
  catchup?: string;
  catchupDays?: string;
  catchupSource?: string;
  catchupCorrection?: string;
  cuid?: string;
  xuiId?: string;
}

export class M3UService {
  /**
   * Parse M3U/M3U8 content
   */
  static parseM3U(content: string): M3UChannelInfo[] {
    const channels: M3UChannelInfo[] = [];
    const lines = content.split("\n").map((line) => line.trim());

    let currentChannel: Partial<M3UChannelInfo> = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip empty lines
      if (!line) {
        continue;
      }

      // Parse EXTINF line
      if (line.startsWith("#EXTINF")) {
        // Extract duration (the number after #EXTINF:)
        const durationMatch = line.match(/#EXTINF:([-0-9]+)/);

        // Extract attributes (using word boundaries to match exact attribute names only)
        const tvgIdMatch = line.match(/\btvg-id="([^"]*)"/);
        const tvgNameMatch = line.match(/\btvg-name="([^"]*)"/);
        const tvgLogoMatch = line.match(/\btvg-logo="([^"]*)"/);
        const groupTitleMatch = line.match(/\bgroup-title="([^"]*)"/);
        const timeshiftMatch = line.match(/\btimeshift="([^"]*)"/);
        const tvgRecMatch = line.match(/\btvg-rec="([^"]*)"/);
        const tvgChnoMatch = line.match(/\btvg-chno="([^"]*)"/);
        const catchupMatch = line.match(/\bcatchup="([^"]*)"/);
        const catchupDaysMatch = line.match(/\bcatchup-days="([^"]*)"/);
        const catchupSourceMatch = line.match(/\bcatchup-source="([^"]*)"/);
        const catchupCorrectionMatch = line.match(
          /\bcatchup-correction="([^"]*)"/
        );
        const cuidMatch = line.match(/\bCUID="([^"]*)"/i);
        const xuiIdMatch = line.match(/\bxui-id="([^"]*)"/);

        // Extract channel name (after the last comma)
        const nameMatch = line.match(/,(.+)$/);

        currentChannel = {
          duration: durationMatch ? durationMatch[1] : undefined,
          tvgId: tvgIdMatch ? tvgIdMatch[1] : undefined,
          tvgName: tvgNameMatch ? tvgNameMatch[1] : undefined,
          tvgLogo: tvgLogoMatch ? tvgLogoMatch[1] : undefined,
          groupTitle: groupTitleMatch ? groupTitleMatch[1] : undefined,
          timeshift: timeshiftMatch ? timeshiftMatch[1] : undefined,
          tvgRec: tvgRecMatch ? tvgRecMatch[1] : undefined,
          tvgChno: tvgChnoMatch ? tvgChnoMatch[1] : undefined,
          catchup: catchupMatch ? catchupMatch[1] : undefined,
          catchupDays: catchupDaysMatch ? catchupDaysMatch[1] : undefined,
          catchupSource: catchupSourceMatch ? catchupSourceMatch[1] : undefined,
          catchupCorrection: catchupCorrectionMatch
            ? catchupCorrectionMatch[1]
            : undefined,
          cuid: cuidMatch ? cuidMatch[1] : undefined,
          xuiId: xuiIdMatch ? xuiIdMatch[1] : undefined,
          name: nameMatch ? nameMatch[1].trim() : "Unknown Channel",
        };
      } else if (line.startsWith("#EXTGRP:")) {
        // Parse #EXTGRP line (category group) - this takes priority over group-title
        const extGrpValue = line.substring(8).trim(); // Remove "#EXTGRP:" prefix
        if (extGrpValue && currentChannel.name) {
          // Override groupTitle with EXTGRP value (EXTGRP has priority)
          currentChannel.groupTitle = extGrpValue;
        }
      } else if (line.startsWith("http://") || line.startsWith("https://")) {
        // This is the URL line
        currentChannel.url = line;

        if (currentChannel.name && currentChannel.url) {
          channels.push(currentChannel as M3UChannelInfo);
        }

        currentChannel = {};
      }
      // Skip other comment lines (like #EXTM3U)
    }

    return channels;
  }

  /**
   * Fetch M3U content from URL
   */
  static async fetchM3U(url: string): Promise<string> {
    try {
      const response = await axios.get(url, {
        timeout: 30000,
        headers: {
          "User-Agent": "IPTV-Playlist-Manager/1.0",
        },
      });

      if (typeof response.data === "string") {
        return response.data;
      }

      throw new Error("Invalid M3U content");
    } catch (error: any) {
      throw new Error(`Failed to fetch M3U: ${error.message}`);
    }
  }

  /**
   * Convert M3U channel to internal Channel format
   */
  static convertChannel(
    m3uChannel: M3UChannelInfo,
    playlistId: number,
    index: number
  ): Channel {
    return {
      playlistId,
      streamId: `m3u_${index}`,
      name: m3uChannel.name,
      streamUrl: m3uChannel.url,
      streamIcon: m3uChannel.tvgLogo,
      epgChannelId: m3uChannel.tvgId,
      categoryId: m3uChannel.groupTitle,
      categoryName: m3uChannel.groupTitle,
      duration: m3uChannel.duration,
      tvgId: m3uChannel.tvgId,
      tvgName: m3uChannel.tvgName,
      tvgLogo: m3uChannel.tvgLogo,
      groupTitle: m3uChannel.groupTitle,
      timeshift: m3uChannel.timeshift,
      tvgRec: m3uChannel.tvgRec || null,
      tvgChno: m3uChannel.tvgChno || null,
      catchup: m3uChannel.catchup || null,
      catchupDays: m3uChannel.catchupDays || null,
      catchupSource: m3uChannel.catchupSource || null,
      catchupCorrection: m3uChannel.catchupCorrection || null,
      cuid: m3uChannel.cuid || null,
      xuiId: m3uChannel.xuiId || null,
    } as any;
  }

  /**
   * Extract unique categories from M3U channels
   */
  static extractCategories(
    m3uChannels: M3UChannelInfo[],
    playlistId: number
  ): Category[] {
    const categoryMap = new Map<string, string>();

    m3uChannels.forEach((channel) => {
      if (channel.groupTitle) {
        categoryMap.set(channel.groupTitle, channel.groupTitle);
      }
    });

    return Array.from(categoryMap.entries()).map(([id, name]) => ({
      playlistId,
      categoryId: id,
      categoryName: name,
    })) as any;
  }

  /**
   * Sync all data from M3U/M3U8 URL
   */
  static async syncPlaylist(
    playlistId: number,
    url: string
  ): Promise<{
    categories: Category[];
    channels: Channel[];
  }> {
    const content = await this.fetchM3U(url);
    const m3uChannels = this.parseM3U(content);

    const categories = this.extractCategories(m3uChannels, playlistId);
    const channels = m3uChannels.map((ch, index) =>
      this.convertChannel(ch, playlistId, index)
    );

    return { categories, channels };
  }
}
