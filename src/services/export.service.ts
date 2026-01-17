import { Channel, Category } from "../types";

export class ExportService {
  /**
   * Convert a value to number if it's a valid numeric string, otherwise return as-is
   */
  private static toNumberIfNumeric(value: any): any {
    if (value === null || value === undefined || value === "") {
      return value;
    }
    const str = String(value).trim();
    // Check if it's a valid number (including negative numbers and decimals)
    if (/^-?\d+(\.\d+)?$/.test(str)) {
      const num = Number(str);
      if (!isNaN(num)) {
        return num;
      }
    }
    return value;
  }

  /**
   * Generate M3U playlist content
   */
  static generateM3U(
    channels: Channel[],
    includeCategories: boolean = true,
    epgUrl?: string
  ): string {
    // M3U header with optional EPG URL
    let m3uContent = epgUrl ? `#EXTM3U url-tvg="${epgUrl}"\n\n` : "#EXTM3U\n\n";

    channels.forEach((channel) => {
      const attributes: string[] = [];

      // Check if channel has mapping
      let displayName = channel.name;
      let displayLogo = channel.tvgLogo || channel.streamIcon;
      let mappedExtGrp = null;
      let mappedTvgId = null;
      let isMapped = false;

      if (channel.channelMapping) {
        try {
          const mapping = JSON.parse(channel.channelMapping);
          displayName = mapping.name || displayName;
          displayLogo = mapping.logo || displayLogo;
          mappedExtGrp = mapping.extGrp || null;
          mappedTvgId = mapping.tvgId || null;
          isMapped = true;
        } catch (e) {
          // Invalid JSON, use original values
        }
      }

      // Determine tvg-id based on mapping status
      // For mapped channels: use mapped tvgId if available, otherwise fall back to original
      // For unmapped channels: use original tvgId or epgChannelId
      const tvgId = isMapped
        ? mappedTvgId || channel.tvgId || channel.epgChannelId
        : channel.tvgId || channel.epgChannelId;
      if (tvgId) {
        attributes.push(`tvg-id="${tvgId}"`);
      }

      // Add tvg-name if available (use mapped name if exists)
      const tvgName = channel.tvgName || displayName;
      if (tvgName) {
        attributes.push(`tvg-name="${tvgName}"`);
      }

      // Add tvg-logo if available (use mapped logo if exists)
      if (displayLogo) {
        attributes.push(`tvg-logo="${displayLogo}"`);
      }

      // Don't add group-title attribute anymore, we'll use #EXTGRP instead

      // Add additional metadata tags if available
      if (channel.timeshift) {
        attributes.push(`timeshift="${channel.timeshift}"`);
      }
      if (channel.tvgRec) {
        attributes.push(`tvg-rec="${channel.tvgRec}"`);
      }
      if (channel.tvgChno) {
        attributes.push(`tvg-chno="${channel.tvgChno}"`);
      }
      if (channel.catchup) {
        attributes.push(`catchup="${channel.catchup}"`);
      }
      if (channel.catchupDays) {
        attributes.push(`catchup-days="${channel.catchupDays}"`);
      }
      if (channel.catchupSource) {
        attributes.push(`catchup-source="${channel.catchupSource}"`);
      }
      if (channel.catchupCorrection) {
        attributes.push(`catchup-correction="${channel.catchupCorrection}"`);
      }

      // Build EXTINF line (use displayName from mapping if available)
      const attributeStr =
        attributes.length > 0 ? attributes.join(" ") + " " : "";

      // Use channel-specific duration or default to -1
      const duration = channel.duration || "-1";

      // Add #EXTINF line first
      m3uContent += `#EXTINF:${duration} ${attributeStr},${displayName}\n`;

      // Add #EXTGRP line if categories are included
      if (includeCategories) {
        const groupTitle =
          mappedExtGrp || channel.groupTitle || channel.categoryName;
        if (groupTitle) {
          m3uContent += `#EXTGRP:${groupTitle}\n`;
        }
      }

      // Add stream URL last
      m3uContent += `${channel.streamUrl}\n\n`;
    });

    return m3uContent;
  }

  /**
   * Generate M3U for specific categories
   */
  static generateM3UByCategories(
    channels: Channel[],
    categoryIds: string[],
    epgUrl?: string
  ): string {
    const filteredChannels = channels.filter(
      (ch) => ch.categoryId && categoryIds.includes(ch.categoryId)
    );

    return this.generateM3U(filteredChannels, true, epgUrl);
  }

  /**
   * Generate M3U with custom channel selection
   */
  static generateM3UCustom(
    channels: Channel[],
    selectedChannelIds: number[],
    epgUrl?: string
  ): string {
    const filteredChannels = channels.filter(
      (ch) => ch.id && selectedChannelIds.includes(ch.id)
    );

    return this.generateM3U(filteredChannels, true, epgUrl);
  }

  /**
   * Extract identifier from channel using playlist configuration
   */
  private static extractIdentifier(
    channel: Channel,
    identifierSource?: string,
    identifierRegex?: string,
    identifierMetadataKey?: string
  ): string {
    if (!identifierSource) {
      return channel.name;
    }

    try {
      // Extract from metadata tag
      if (identifierSource === "metadata") {
        const key = (identifierMetadataKey || "tvg-id").toLowerCase();
        switch (key) {
          case "tvg-id":
            return channel.tvgId || channel.name;
          case "tvg-name":
            return channel.tvgName || channel.name;
          case "tvg-logo":
            return channel.tvgLogo || channel.name;
          case "group-title":
            return channel.groupTitle || channel.categoryName || channel.name;
          case "tvg-rec":
            return channel.tvgRec || channel.name;
          case "tvg-chno":
            return channel.tvgChno || channel.name;
          case "timeshift":
            return channel.timeshift || channel.name;
          case "catchup":
            return channel.catchup || channel.name;
          case "catchup-days":
            return channel.catchupDays || channel.name;
          case "catchup-source":
            return channel.catchupSource || channel.name;
          case "catchup-correction":
            return channel.catchupCorrection || channel.name;
          case "cuid":
            return channel.cuid || channel.name;
          case "xui-id":
            return channel.xuiId || channel.name;
          default:
            return channel.name;
        }
      }

      // Extract using regex
      if (identifierRegex) {
        const regex = new RegExp(identifierRegex);
        const source =
          identifierSource === "stream-url" ? channel.streamUrl : channel.name;
        const match = source.match(regex);
        if (match && match[1]) {
          return match[1];
        }
      }
    } catch (error) {
      console.warn("Error extracting identifier:", error);
    }

    // Fallback to channel name
    return channel.name;
  }

  /**
   * Generate JSON playlist content
   */
  static generateJSON(
    channels: Channel[],
    identifierSource?: string,
    identifierRegex?: string,
    identifierMetadataKey?: string
  ): string {
    const jsonChannels = channels.map((channel) => {
      // Check if channel has mapping
      let displayName = channel.name;
      let displayLogo = channel.tvgLogo || channel.streamIcon;
      let mappedExtGrp = null;
      let mappedTvgId = null;
      let isMapped = false;

      if (channel.channelMapping) {
        try {
          const mapping = JSON.parse(channel.channelMapping);
          displayName = mapping.name || displayName;
          displayLogo = mapping.logo || displayLogo;
          mappedExtGrp = mapping.extGrp || null;
          mappedTvgId = mapping.tvgId || null;
          isMapped = true;
        } catch (e) {
          // Invalid JSON, use original values
        }
      }

      // Build channel object with camelCase property names
      const channelObj: any = {
        channelName: displayName,
        channelId: this.toNumberIfNumeric(
          this.extractIdentifier(
            channel,
            identifierSource,
            identifierRegex,
            identifierMetadataKey
          )
        ),
      };

      // Add optional fields if they exist (converting from kebab-case to camelCase)
      // Note: tvgName should ALWAYS remain a string (per user requirement)
      if (channel.tvgName) channelObj.tvgName = channel.tvgName;

      // Determine tvgId based on mapping status
      // For mapped channels: use ONLY the mapped tvgId (no fallback to original)
      // For unmapped channels: use original tvgId
      const tvgId = isMapped ? mappedTvgId : channel.tvgId;
      if (tvgId) channelObj.tvgId = tvgId;

      if (displayLogo) channelObj.tvgLogo = displayLogo;

      // Use extGrp (mapped if available, otherwise use groupTitle or categoryName)
      const extGrp = mappedExtGrp || channel.groupTitle || channel.categoryName;
      if (extGrp) channelObj.extGrp = extGrp;

      // Convert numeric values to actual numbers (not strings)
      if (channel.tvgRec)
        channelObj.tvgRec = this.toNumberIfNumeric(channel.tvgRec);
      if (channel.tvgChno)
        channelObj.tvgChno = this.toNumberIfNumeric(channel.tvgChno);
      if (channel.timeshift)
        channelObj.timeshift = this.toNumberIfNumeric(channel.timeshift);
      if (channel.catchup)
        channelObj.catchup = this.toNumberIfNumeric(channel.catchup);
      if (channel.catchupDays)
        channelObj.catchupDays = this.toNumberIfNumeric(channel.catchupDays);
      if (channel.catchupSource)
        channelObj.catchupSource = this.toNumberIfNumeric(
          channel.catchupSource
        );
      if (channel.catchupCorrection)
        channelObj.catchupCorrection = this.toNumberIfNumeric(
          channel.catchupCorrection
        );

      return channelObj;
    });

    return JSON.stringify(jsonChannels, null, 2);
  }
}
