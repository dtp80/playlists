import { useState, useEffect } from "react";
import { Playlist, User, UserRole } from "./types";
import { api } from "./api";
import PlaylistList from "./components/PlaylistList";
import PlaylistForm from "./components/PlaylistForm";
import PlaylistViewer from "./components/PlaylistViewer";
import PlaylistEditModal from "./components/PlaylistEditModal";
import AdminModal from "./components/AdminModal";
import ConfirmModal from "./components/ConfirmModal";
import "./App.css";

const defaultUser: User = {
  id: 1,
  email: "admin@localhost",
  role: UserRole.ADMIN,
  twoFactorEnabled: false,
};

function App() {
  const [user] = useState<User>(defaultUser);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(
    null
  );
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    message: string;
    onConfirm?: () => void;
    title?: string;
    confirmText?: string;
    cancelText?: string;
    confirmVariant?: "danger" | "primary" | "warning" | "success";
  } | null>(null);

  // Load playlists on mount
  useEffect(() => {
    loadPlaylists();
  }, []);

  const loadPlaylists = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getPlaylists();
      setPlaylists(data);

      // Update selectedPlaylist if it's currently selected
      if (selectedPlaylist?.id) {
        const updated = data.find((p) => p.id === selectedPlaylist.id);
        if (updated) {
          setSelectedPlaylist(updated);
        }
      }
    } catch (err: any) {
      setError(err.message || "Failed to load playlists");
    } finally {
      setLoading(false);
    }
  };

  // Refresh just the selected playlist
  const refreshSelectedPlaylist = async () => {
    if (!selectedPlaylist?.id) return;

    try {
      const updated = await api.getPlaylist(selectedPlaylist.id);
      setSelectedPlaylist(updated);

      // Also update in the playlists array
      setPlaylists((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
    } catch (err: any) {
      setError(err.message || "Failed to refresh playlist");
    }
  };

  const handleAddPlaylist = async (playlist: Playlist) => {
    try {
      const newPlaylist = await api.createPlaylist(playlist);
      setShowAddForm(false);

      // Select the new playlist and show it
      setSelectedPlaylist(newPlaylist);

      // Reload playlists to update the list
      await loadPlaylists();
    } catch (err: any) {
      throw new Error(err.response?.data?.error || err.message);
    }
  };

  const handleDeletePlaylist = async (id: number) => {
    const playlistToDelete = playlists.find((p) => p.id === id);
    setConfirmModal({
      title: "Delete Playlist",
      message: `Are you sure you want to delete "${playlistToDelete?.name}"? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmVariant: "danger",
      onConfirm: async () => {
        try {
          await api.deletePlaylist(id);
          if (selectedPlaylist?.id === id) {
            setSelectedPlaylist(null);
          }
          await loadPlaylists();
        } catch (err: any) {
          setConfirmModal({
            title: "Error",
            message: "Failed to delete playlist: " + err.message,
            confirmVariant: "danger",
          });
        }
      },
    });
  };

  const handleSelectPlaylist = (playlist: Playlist) => {
    setSelectedPlaylist(playlist);
    setShowAddForm(false);
  };

  const handleEditPlaylist = (playlist: Playlist, initialTab?: string) => {
    setEditingPlaylist({ ...playlist, initialTab } as any);
  };

  const handleSaveEdit = async () => {
    await loadPlaylists();
    // The loadPlaylists function will automatically update the selectedPlaylist
  };

  const handleSync = async () => {
    // After sync, only refresh the selected playlist (fast)
    // Don't reload all playlists (slow, causes timeouts for large playlists)
    if (selectedPlaylist?.id) {
      await refreshSelectedPlaylist();
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1>📺 IPTV Playlist Manager</h1>
          <p className="subtitle">Manage your Xtream Codes and M3U playlists</p>
        </div>
        <div className="header-right">
          <div className="user-profile-static">
            <span className="user-avatar-static">
              {user.email.charAt(0).toUpperCase()}
            </span>
            <div className="user-details-static">
              <div className="user-email-static">{user.email}</div>
              <div className="user-role-static">Local Admin</div>
            </div>
          </div>
        </div>
      </header>

      <div className="app-content">
        <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
          {!sidebarCollapsed && (
            <>
              <div className="sidebar-header">
                <h2>Playlists</h2>
                <div className="sidebar-header-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setShowAddForm(true);
                      setSelectedPlaylist(null);
                    }}
                  >
                    + Add
                  </button>
                  <button
                    className="sidebar-toggle"
                    onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                    title="Collapse sidebar"
                  >
                    ◀
                  </button>
                </div>
              </div>

              <div className="sidebar-content">
                {loading && <div className="loading">Loading playlists...</div>}

                {error && <div className="error-message">{error}</div>}

                {!loading && !error && (
                  <PlaylistList
                    playlists={playlists}
                    selectedPlaylist={selectedPlaylist}
                    onSelect={handleSelectPlaylist}
                    onDelete={handleDeletePlaylist}
                    onEdit={handleEditPlaylist}
                  />
                )}
              </div>

              <div className="sidebar-footer">
                <button
                  className="btn btn-secondary sidebar-settings-btn"
                  onClick={() => setShowAdminModal(true)}
                  title="Settings"
                >
                  ⚙️ Settings
                </button>
              </div>
            </>
          )}

          {sidebarCollapsed && (
            <>
              <button
                className="sidebar-toggle-collapsed"
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                title="Expand sidebar"
              >
                ▶
              </button>
              <button
                className="sidebar-settings-btn-collapsed"
                onClick={() => setShowAdminModal(true)}
                title="Settings"
              >
                ⚙️
              </button>
            </>
          )}
        </aside>

        <main className="main-content">
          {showAddForm && (
            <PlaylistForm
              onSubmit={handleAddPlaylist}
              onCancel={() => setShowAddForm(false)}
            />
          )}

          {!showAddForm && selectedPlaylist && (
            <PlaylistViewer
              playlist={selectedPlaylist}
              onSync={handleSync}
              onEditPlaylist={(tab) =>
                handleEditPlaylist(selectedPlaylist, tab)
              }
            />
          )}

          {!showAddForm && !selectedPlaylist && (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <h2>No Playlist Selected</h2>
              <p>
                Select a playlist from the sidebar or add a new one to get
                started.
              </p>
            </div>
          )}
        </main>
      </div>

      {editingPlaylist && (
        <PlaylistEditModal
          playlist={editingPlaylist}
          onClose={() => setEditingPlaylist(null)}
          onSave={handleSaveEdit}
        />
      )}

      {showAdminModal && (
        <AdminModal
          onClose={() => setShowAdminModal(false)}
          onPlaylistsReordered={loadPlaylists}
          user={user}
        />
      )}

      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText={confirmModal.confirmText}
          cancelText={confirmModal.cancelText}
          confirmVariant={confirmModal.confirmVariant}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
}

export default App;
