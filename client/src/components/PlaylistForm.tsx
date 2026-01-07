import { useState } from "react";
import { Playlist, PlaylistType } from "../types";
import "./PlaylistForm.css";

interface Props {
  onSubmit: (playlist: Playlist) => Promise<void>;
  onCancel: () => void;
}

function PlaylistForm({ onSubmit, onCancel }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<PlaylistType>(PlaylistType.M3U);
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !url.trim()) {
      setError("Name and URL are required");
      return;
    }

    if (
      type === PlaylistType.XTREAM &&
      (!username.trim() || !password.trim())
    ) {
      setError("Username and password are required for Xtream Codes");
      return;
    }

    setLoading(true);

    try {
      const playlist: Playlist = {
        name: name.trim(),
        type,
        url: url.trim(),
        username: username.trim() || undefined,
        password: password.trim() || undefined,
      };

      await onSubmit(playlist);
    } catch (err: any) {
      setError(err.message || "Failed to add playlist");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="playlist-form-container">
      <div className="form-header">
        <h2>Add New Playlist</h2>
        <p className="text-secondary">Connect to an IPTV provider</p>
      </div>

      <form onSubmit={handleSubmit} className="playlist-form">
        {error && <div className="error-message">{error}</div>}

        <div className="form-group">
          <label htmlFor="name">Playlist Name *</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My IPTV Playlist"
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label htmlFor="type">Playlist Type *</label>
          <select
            id="type"
            value={type}
            onChange={(e) => setType(e.target.value as PlaylistType)}
            disabled={loading}
          >
            <option value={PlaylistType.M3U}>M3U/M3U8 URL</option>
            <option value={PlaylistType.XTREAM}>Xtream Codes API</option>
          </select>
          <small className="form-help">
            {type === PlaylistType.M3U
              ? "Direct link to M3U or M3U8 playlist file"
              : "Xtream Codes panel URL (e.g., http://example.com:8080)"}
          </small>
        </div>

        <div className="form-group">
          <label htmlFor="url">
            {type === PlaylistType.M3U ? "Playlist URL *" : "Server URL *"}
          </label>
          <input
            id="url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={
              type === PlaylistType.M3U
                ? "http://example.com/playlist.m3u"
                : "http://example.com:8080"
            }
            disabled={loading}
          />
        </div>

        {type === PlaylistType.XTREAM && (
          <>
            <div className="form-group">
              <label htmlFor="username">Username *</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password *</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="password"
                disabled={loading}
              />
            </div>
          </>
        )}

        <div className="form-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "Adding..." : "Add Playlist"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default PlaylistForm;
