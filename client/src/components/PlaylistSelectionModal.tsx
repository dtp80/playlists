import { useState } from "react";
import { Playlist } from "../types";
import "./PlaylistSelectionModal.css";

interface Props {
  playlists: Playlist[];
  currentPlaylistId: number;
  onSelect: (playlistId: number) => void;
  onClose: () => void;
}

function PlaylistSelectionModal({
  playlists,
  currentPlaylistId,
  onSelect,
  onClose,
}: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(
    null
  );

  // Filter out the current playlist and apply search filter
  const availablePlaylists = playlists.filter(
    (p) => p.id !== currentPlaylistId
  );

  const filteredPlaylists = availablePlaylists.filter((playlist) =>
    playlist.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleConfirm = () => {
    if (selectedPlaylistId !== null) {
      onSelect(selectedPlaylistId);
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content playlist-selection-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>📋 Select Source Playlist</h2>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-description">
            Choose a playlist to copy channel mappings from. Only playlists with
            the same identifier settings will work correctly.
          </p>

          {availablePlaylists.length === 0 ? (
            <div className="empty-message">
              No other playlists available. Please add another playlist first.
            </div>
          ) : (
            <>
              <div className="search-box">
                <input
                  type="text"
                  placeholder="🔍 Search playlists..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                  autoFocus
                />
                {searchTerm && (
                  <button
                    className="clear-search"
                    onClick={() => setSearchTerm("")}
                    title="Clear search"
                  >
                    ×
                  </button>
                )}
              </div>

              <div className="playlist-count">
                {filteredPlaylists.length} of {availablePlaylists.length}{" "}
                playlist(s)
                {searchTerm && filteredPlaylists.length > 0 && (
                  <span className="search-results-info"> (filtered)</span>
                )}
              </div>

              {filteredPlaylists.length === 0 ? (
                <div className="no-results">
                  No playlists match "{searchTerm}"
                </div>
              ) : (
                <div className="playlist-list">
                  {filteredPlaylists.map((playlist) => (
                    <div
                      key={playlist.id}
                      className={`playlist-item ${
                        selectedPlaylistId === playlist.id ? "selected" : ""
                      }`}
                      onClick={() => setSelectedPlaylistId(playlist.id!)}
                    >
                      <label className="radio-label">
                        <input
                          type="radio"
                          name="playlist"
                          checked={selectedPlaylistId === playlist.id}
                          onChange={() => setSelectedPlaylistId(playlist.id!)}
                        />
                        <div className="playlist-info">
                          <span className="playlist-name">{playlist.name}</span>
                          <div className="playlist-meta">
                            <span className="playlist-type badge">
                              {playlist.type.toUpperCase()}
                            </span>
                            {playlist.identifierSource && (
                              <span className="playlist-identifier">
                                {playlist.identifierSource === "channel-name"
                                  ? "Channel Name"
                                  : playlist.identifierSource === "stream-url"
                                  ? "Stream URL"
                                  : "Metadata"}
                              </span>
                            )}
                            {playlist.channelCount && (
                              <span className="playlist-channels">
                                {playlist.channelCount} channels
                              </span>
                            )}
                          </div>
                        </div>
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={selectedPlaylistId === null}
          >
            Copy Mappings
          </button>
        </div>
      </div>
    </div>
  );
}

export default PlaylistSelectionModal;
