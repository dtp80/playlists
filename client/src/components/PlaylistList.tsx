import { Playlist } from "../types";
import "./PlaylistList.css";

interface Props {
  playlists: Playlist[];
  selectedPlaylist: Playlist | null;
  onSelect: (playlist: Playlist) => void;
  onDelete: (id: number) => void;
  onEdit: (playlist: Playlist) => void;
}

function PlaylistList({
  playlists,
  selectedPlaylist,
  onSelect,
  onDelete,
  onEdit,
}: Props) {
  if (playlists.length === 0) {
    return (
      <div className="playlist-list-empty">
        <p>No playlists yet. Add one to get started!</p>
      </div>
    );
  }

  return (
    <div className="playlist-list">
      {playlists.map((playlist) => (
        <div
          key={playlist.id}
          className={`playlist-item ${
            selectedPlaylist?.id === playlist.id ? "active" : ""
          }`}
          onClick={() => onSelect(playlist)}
        >
          <div className="playlist-grid">
            <div className="playlist-header">
              <div className="playlist-name-wrapper">
                <span
                  className={`status-indicator ${
                    playlist.externalAccessEnabled ? "enabled" : "disabled"
                  }`}
                  title={
                    playlist.externalAccessEnabled
                      ? "External access enabled"
                      : "External access disabled"
                  }
                />
                <span className="playlist-name">{playlist.name}</span>
              </div>
              <div className="playlist-actions">
                <button
                  className="btn-icon btn-edit"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(playlist);
                  }}
                  title="Edit playlist"
                >
                  ✏️
                </button>
                <button
                  className="btn-icon btn-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(playlist.id!);
                  }}
                  title="Delete playlist"
                >
                  🗑️
                </button>
              </div>
            </div>
            <div className="playlist-footer">
              <span className="playlist-type">
                {playlist.type.toUpperCase()}
              </span>
              <span className="playlist-count">
                {playlist.channelCount || 0} channels
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default PlaylistList;
