import { Channel } from "../types";
import { useState } from "react";
import "./ChannelList.css";

interface Props {
  channels: Channel[];
  viewMode?: "grid" | "table";
  identifierSource?: "channel-name" | "stream-url" | "metadata";
  identifierRegex?: string;
  identifierMetadataKey?: string;
  playlistId?: number;
  onExcludeChannel?: (streamId: string) => void;
  onMapChannel?: (channel: Channel) => void;
  isLargePlaylist?: boolean;
  channelCount?: number;
}

function ChannelList({
  channels,
  viewMode = "grid",
  identifierSource = "channel-name",
  identifierRegex,
  identifierMetadataKey = "tvg-id",
  playlistId: _playlistId,
  onExcludeChannel,
  onMapChannel,
  isLargePlaylist = false,
  channelCount = 0,
}: Props) {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const copyToClipboard = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const getMappedInfo = (
    channel: Channel
  ): { name: string; logo: string } | null => {
    if (channel.channelMapping) {
      try {
        return JSON.parse(channel.channelMapping);
      } catch (e) {
        return null;
      }
    }
    return null;
  };

  const getDisplayName = (channel: Channel): string => {
    const mapped = getMappedInfo(channel);
    return mapped ? mapped.name : channel.name;
  };

  const getDisplayLogo = (channel: Channel): string | undefined => {
    const mapped = getMappedInfo(channel);
    return mapped ? mapped.logo : channel.streamIcon;
  };

  const extractIdentifier = (channel: Channel): string => {
    // If no configuration, return channel name
    if (!identifierSource) {
      return channel.name;
    }

    try {
      // Extract from metadata tag
      if (identifierSource === "metadata") {
        const key = identifierMetadataKey || "tvg-id";
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
          case "xui-id":
            return channel.xuiId || channel.streamId;
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
  };
  if (channels.length === 0) {
    return (
      <div className="channels-empty">
        <div className="empty-icon">📺</div>
        {isLargePlaylist ? (
          <>
            <h3>Select a Category to View Channels</h3>
            <p>
              This playlist has {channelCount?.toLocaleString() || "many"}{" "}
              channels.
              <br />
              Please select a category from the dropdown above or use the search
              to view channels.
            </p>
          </>
        ) : (
          <>
            <h3>No Channels Found</h3>
            <p>Sync your playlist to load channels, or adjust your filters.</p>
          </>
        )}
      </div>
    );
  }

  if (viewMode === "table") {
    return (
      <div className="channel-list">
        <div className="channel-table-wrapper">
          <table className="channel-table">
            <thead>
              <tr>
                <th>Icon</th>
                <th>Name</th>
                <th>Identifier</th>
                <th>Stream URL</th>
                {(onMapChannel || onExcludeChannel) && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {channels.map((channel) => {
                const displayLogo = getDisplayLogo(channel);
                const displayName = getDisplayName(channel);
                const mapped = getMappedInfo(channel);

                return (
                  <tr key={channel.id}>
                    <td className="table-icon">
                      {displayLogo ? (
                        <img src={displayLogo} alt={displayName} />
                      ) : (
                        <div className="table-icon-placeholder">📺</div>
                      )}
                    </td>
                    <td className="table-name">
                      <div>
                        {mapped && (
                          <span className="channel-mapped-badge">✓</span>
                        )}
                        {displayName}
                      </div>
                      {mapped && (
                        <div className="table-original-name">
                          Original: {channel.name}
                        </div>
                      )}
                    </td>
                    <td className="table-identifier">
                      <span className="identifier-badge">
                        {extractIdentifier(channel)}
                      </span>
                    </td>
                    <td className="table-url" title={channel.streamUrl}>
                      <div className="url-with-copy">
                        <span className="url-text">{channel.streamUrl}</span>
                        <button
                          className="btn-copy"
                          onClick={() => copyToClipboard(channel.streamUrl)}
                          title="Copy stream URL"
                        >
                          {copiedUrl === channel.streamUrl ? "✓" : "📋"}
                        </button>
                      </div>
                    </td>
                    {(onMapChannel || onExcludeChannel) && (
                      <td className="table-actions">
                        <div className="table-actions-buttons">
                          {onMapChannel && (
                            <button
                              className="btn-map"
                              onClick={() => onMapChannel(channel)}
                              title="Map channel"
                            >
                              🔗 Map
                            </button>
                          )}
                          {onExcludeChannel && (
                            <button
                              className="btn-exclude"
                              onClick={() => onExcludeChannel(channel.streamId)}
                              title="Exclude this channel"
                            >
                              ✗ Exclude
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="channel-list">
      <div className="channel-grid">
        {channels.map((channel) => {
          const displayLogo = getDisplayLogo(channel);
          const displayName = getDisplayName(channel);
          const mapped = getMappedInfo(channel);

          return (
            <div key={channel.id} className="channel-card">
              <div className="channel-icon">
                {displayLogo ? (
                  <img src={displayLogo} alt={displayName} />
                ) : (
                  <div className="channel-icon-placeholder">📺</div>
                )}
              </div>
              <div className="channel-info">
                <div className="channel-name" title={displayName}>
                  {mapped && <span className="channel-mapped-badge">✓</span>}
                  {displayName}
                </div>
                {mapped && (
                  <div className="channel-original-name" title={channel.name}>
                    Original: {channel.name}
                  </div>
                )}
                <div className="channel-identifier">
                  {extractIdentifier(channel)}
                </div>
                <div className="channel-url-container">
                  <div className="channel-url" title={channel.streamUrl}>
                    {channel.streamUrl}
                  </div>
                  <button
                    className="btn-copy-grid"
                    onClick={() => copyToClipboard(channel.streamUrl)}
                    title="Copy stream URL"
                  >
                    {copiedUrl === channel.streamUrl ? "✓" : "📋"}
                  </button>
                </div>
              </div>
              <div className="channel-card-actions">
                {onMapChannel && (
                  <button
                    className="btn-map-card"
                    onClick={() => onMapChannel(channel)}
                    title="Map channel"
                  >
                    🔗
                  </button>
                )}
                {onExcludeChannel && (
                  <button
                    className="btn-exclude-card"
                    onClick={() => onExcludeChannel(channel.streamId)}
                    title="Exclude this channel"
                  >
                    ✗
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ChannelList;
