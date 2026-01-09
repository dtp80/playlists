import { useState, useEffect, useRef } from "react";
import { Channel } from "../types";
import { api } from "../api";
import ConfirmModal from "./ConfirmModal";
import "./ChannelMappingModal.css";

interface Props {
  channel: Channel;
  playlistId: number;
  onClose: () => void;
  onMapped: () => void;
}

interface LineupChannel {
  name: string;
  logo: string;
  tvgId?: string;
  extGrp?: string;
}

function ChannelMappingModal({
  channel,
  playlistId,
  onClose,
  onMapped,
}: Props) {
  const [lineup, setLineup] = useState<LineupChannel[]>([]);
  const [filteredLineup, setFilteredLineup] = useState<LineupChannel[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<LineupChannel | null>(
    null
  );
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    loadLineup();
  }, []);

  useEffect(() => {
    if (searchTerm) {
      const filtered = lineup.filter((ch) =>
        ch.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredLineup(filtered);
    } else {
      setFilteredLineup(lineup);
    }
  }, [searchTerm, lineup]);

  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [loading]);

  const loadLineup = async () => {
    try {
      setLoading(true);

      // Fetch playlist to determine assigned EPG / group (use only that lineup)
      const playlist = await api.getPlaylist(playlistId);
      const epgFileId = playlist?.epgFileId || undefined;
      const epgGroupId = !epgFileId ? playlist?.epgGroupId || undefined : undefined;

      const data = await api.getChannelLineup({ epgFileId, epgGroupId });

      // Sort: mapped to non-default category first, then rest
      const sorted = [...data].sort((a, b) => {
        const aNonDefault =
          a.extGrp && a.extGrp.toLowerCase() !== "imported channels";
        const bNonDefault =
          b.extGrp && b.extGrp.toLowerCase() !== "imported channels";
        if (aNonDefault && !bNonDefault) return -1;
        if (!aNonDefault && bNonDefault) return 1;
        return a.name.localeCompare(b.name);
      });

      setLineup(sorted);
      setFilteredLineup(sorted);
    } catch (err: any) {
      setErrorModal("Failed to load channel lineup: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMap = async () => {
    if (!selectedChannel) {
      return;
    }

    try {
      setSaving(true);
      await api.updateChannelMapping(playlistId, channel.streamId, {
        name: selectedChannel.name,
        logo: selectedChannel.logo,
        tvgId: selectedChannel.tvgId,
        extGrp: selectedChannel.extGrp,
      });
      onMapped();
      onClose();
    } catch (err: any) {
      setErrorModal("Failed to map channel: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveMapping = async () => {
    try {
      setSaving(true);
      await api.removeChannelMapping(playlistId, channel.streamId);
      onMapped();
      onClose();
    } catch (err: any) {
      setErrorModal("Failed to remove mapping: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Parse existing mapping if available
  let currentMapping: { name: string; logo: string } | null = null;
  if (channel.channelMapping) {
    try {
      currentMapping = JSON.parse(channel.channelMapping);
    } catch (e) {
      // Invalid JSON
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content mapping-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Map Channel</h2>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {/* Original Channel Info */}
          <div className="mapping-original">
            <h3>Original Channel</h3>
            <div className="channel-preview">
              {channel.streamIcon ? (
                <img src={channel.streamIcon} alt={channel.name} />
              ) : (
                <div className="channel-preview-placeholder">📺</div>
              )}
              <div className="channel-preview-info">
                <div className="channel-preview-name">{channel.name}</div>
                <div className="channel-preview-url">{channel.streamUrl}</div>
              </div>
            </div>
          </div>

          {/* Current Mapping (if exists) */}
          {currentMapping && (
            <div className="mapping-current">
              <h3>Current Mapping</h3>
              <div className="channel-preview mapped">
                <img src={currentMapping.logo} alt={currentMapping.name} />
                <div className="channel-preview-info">
                  <div className="channel-preview-name">
                    {currentMapping.name}
                  </div>
                </div>
                <button
                  className="btn-remove-mapping"
                  onClick={handleRemoveMapping}
                  disabled={saving}
                >
                  Remove
                </button>
              </div>
            </div>
          )}

          {/* Search */}
          <div className="mapping-search">
            <h3>Select from Channel Lineup</h3>
            <input
              type="text"
              className="form-input"
              placeholder="Search channels..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              ref={searchInputRef}
            />
          </div>

          {/* Lineup Channels */}
          <div className="mapping-lineup">
            {loading && (
              <div className="mapping-loading">Loading channels...</div>
            )}

            {!loading && filteredLineup.length === 0 && (
              <div className="mapping-empty">
                {searchTerm
                  ? "No channels found matching your search"
                  : "No channels available in lineup"}
              </div>
            )}

            {!loading && filteredLineup.length > 0 && (
              <div className="lineup-grid">
                {filteredLineup.map((ch) => (
                  <div
                    key={ch.name}
                    className={`lineup-item ${
                      selectedChannel?.name === ch.name ? "selected" : ""
                    }`}
                    onClick={() => setSelectedChannel(ch)}
                  >
                    <img src={ch.logo} alt={ch.name} />
                    <div className="lineup-item-name">{ch.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleMap}
            disabled={!selectedChannel || saving}
          >
            {saving ? "Mapping..." : "Map Channel"}
          </button>
        </div>
      </div>

      {errorModal && (
        <ConfirmModal
          title="Error"
          message={errorModal}
          confirmVariant="danger"
          onCancel={() => setErrorModal(null)}
        />
      )}
    </div>
  );
}

export default ChannelMappingModal;
