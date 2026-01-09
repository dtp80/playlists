import { useState, useEffect, useRef } from "react";
import { api } from "../api";
import { Playlist, User, UserRole, EpgFile, EpgGroup } from "../types";
import ConfirmModal from "./ConfirmModal";
import "./AdminModal.css";

interface Props {
  onClose: () => void;
  onPlaylistsReordered?: () => void;
  user: User;
}

type TabType =
  | "general"
  | "playlists"
  | "channels"
  | "epg"
  | "users"
  | "schedule";

interface LineupChannel {
  id: number;
  name: string;
  tvgLogo: string | null;
  tvgId: string | null;
  extGrp: string | null;
  sortOrder: number;
}

interface Category {
  name: string;
}

function AdminModal({ onClose, onPlaylistsReordered, user }: Props) {
  // Debug: Log the actual role value
  console.log("[AdminModal] User role:", user.role);
  console.log("[AdminModal] UserRole.ADMIN:", UserRole.ADMIN);

  // Helper function to check if user is admin (handles both old and new role values)
  // Cast to string for comparison to handle both enum and legacy string values
  const roleStr = String(user.role);
  const isAdmin =
    roleStr === UserRole.ADMIN || roleStr === "Admin" || roleStr === "ADMIN";

  console.log("[AdminModal] isAdmin:", isAdmin);

  const [activeTab, setActiveTab] = useState<TabType>(
    isAdmin ? "general" : "playlists"
  );
  const [channels, setChannels] = useState<LineupChannel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [draggedPlaylist, setDraggedPlaylist] = useState<Playlist | null>(null);
  const [dragOverPlaylist, setDragOverPlaylist] = useState<number | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [schedule, setSchedule] = useState<
    Array<{ playlistId: number; enabled: boolean; time: string }>
  >([]);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<string>(UserRole.MEMBER);
  const [showRoleChangeModal, setShowRoleChangeModal] = useState(false);
  const [roleChangeUserId, setRoleChangeUserId] = useState<number | null>(null);
  const [roleChangeNewRole, setRoleChangeNewRole] = useState<string>("");
  const [debugMode, setDebugMode] = useState(true);
  const [bypass2FA, setBypass2FA] = useState(false);
  const [syncTimeout, setSyncTimeout] = useState(60);
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramSendSummaries, setTelegramSendSummaries] = useState(false);
  const [prevTelegramBotToken, setPrevTelegramBotToken] = useState("");
  const [prevTelegramChatId, setPrevTelegramChatId] = useState("");
  const [prevTelegramSendSummaries, setPrevTelegramSendSummaries] =
    useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [editingChannel, setEditingChannel] = useState<LineupChannel | null>(
    null
  );
  const [formData, setFormData] = useState({
    name: "",
    tvgLogo: "",
    tvgId: "",
    extGrp: "",
  });
  const [draggedChannel, setDraggedChannel] = useState<LineupChannel | null>(
    null
  );
  const [draggedCategory, setDraggedCategory] = useState<string | null>(null);
  const [dragOverChannel, setDragOverChannel] = useState<number | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState<string | null>(
    null
  );
  const [newCategoryName, setNewCategoryName] = useState<string>("");
  const [confirmModal, setConfirmModal] = useState<{
    message: string;
    onConfirm?: () => void;
    title?: string;
    confirmText?: string;
    cancelText?: string;
    confirmVariant?: "danger" | "primary" | "warning" | "success";
  } | null>(null);
  const [channelSearchTerm, setChannelSearchTerm] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // EPG Files management
  const [epgFiles, setEpgFiles] = useState<EpgFile[]>([]);
  const [showAddEpgForm, setShowAddEpgForm] = useState(false);
  const [newEpgName, setNewEpgName] = useState("");
  const [newEpgUrl, setNewEpgUrl] = useState("");
  const [epgLoading, setEpgLoading] = useState(false);
  const [selectedEpgId, setSelectedEpgId] = useState<number | null>(null);
  const [selectedEpgType, setSelectedEpgType] = useState<"file" | "group">(
    "file"
  );
  const [channelExportOpen, setChannelExportOpen] = useState(false);
  const [editingEpgFile, setEditingEpgFile] = useState<EpgFile | null>(null);
  const [showEditEpgModal, setShowEditEpgModal] = useState(false);
  const [editEpgName, setEditEpgName] = useState("");
  const [editEpgUrl, setEditEpgUrl] = useState("");
  const [syncingEpgId, setSyncingEpgId] = useState<number | null>(null);
  const [importProgress, setImportProgress] = useState<{
    jobId: number;
    name: string;
    status: string;
    progress: number;
    message: string;
    downloadProgress?: number;
    importProgress?: number;
  } | null>(null);

  // EPG Groups management
  const [epgGroups, setEpgGroups] = useState<EpgGroup[]>([]);
  const [showAddGroupForm, setShowAddGroupForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupUrl, setNewGroupUrl] = useState("");
  const [selectedGroupEpgFileIds, setSelectedGroupEpgFileIds] = useState<
    number[]
  >([]);
  const [editingEpgGroup, setEditingEpgGroup] = useState<EpgGroup | null>(null);
  const [showEditGroupModal, setShowEditGroupModal] = useState(false);
  const [editGroupName, setEditGroupName] = useState("");
  const [editGroupUrl, setEditGroupUrl] = useState("");
  const [editGroupEpgFileIds, setEditGroupEpgFileIds] = useState<number[]>([]);

  // Reload data when selectedEpgId or selectedEpgType changes (for Channels tab)
  useEffect(() => {
    if (activeTab === "channels" && selectedEpgId !== null) {
      loadData();
    }
  }, [selectedEpgId, selectedEpgType]);

  useEffect(() => {
    console.log("[useEffect] activeTab changed to:", activeTab);
    console.log("[useEffect] isAdmin:", isAdmin);

    if (activeTab === "channels") {
      // Ensure EPG list and default selection are ready before loading channels
      const initChannels = async () => {
        let effectiveId = selectedEpgId;
        let effectiveType: "file" | "group" = selectedEpgType;

        if (epgFiles.length === 0 && epgGroups.length === 0) {
          const result = await loadEpgFiles();
          effectiveId = result.selectedId ?? effectiveId;
          effectiveType = result.selectedType ?? effectiveType;
        } else if (selectedEpgId === null) {
          // Attempt to auto-select if list already loaded
          const defaultFile =
            epgFiles.find((f: EpgFile) => f.isDefault) || epgFiles[0];
          if (defaultFile?.id != null) {
            setSelectedEpgId(defaultFile.id);
            setSelectedEpgType("file");
            effectiveId = defaultFile.id;
            effectiveType = "file";
          } else if (epgGroups.length > 0 && epgGroups[0].id != null) {
            setSelectedEpgId(epgGroups[0].id);
            setSelectedEpgType("group");
            effectiveId = epgGroups[0].id;
            effectiveType = "group";
          }
        }
        await loadData(effectiveId, effectiveType);
      };
      initChannels();
    } else if (activeTab === "general") {
      loadSettings();
    } else if (activeTab === "playlists") {
      loadPlaylists();
    } else if (activeTab === "epg") {
      loadEpgFiles();
    } else if (activeTab === "schedule") {
      loadSchedule();
    }
  }, [activeTab]);

  const loadSettings = async () => {
    try {
      const settings = await api.getSettings();
      setDebugMode(settings.debugMode);
      setBypass2FA(settings.bypass2FA);
      setSyncTimeout(settings.syncTimeout || 60);
      setTelegramBotToken(settings.telegramBotToken || "");
      setTelegramChatId(settings.telegramChatId || "");
      setTelegramSendSummaries(Boolean(settings.telegramSendSummaries));
      setPrevTelegramBotToken(settings.telegramBotToken || "");
      setPrevTelegramChatId(settings.telegramChatId || "");
      setPrevTelegramSendSummaries(Boolean(settings.telegramSendSummaries));
    } catch (err: any) {
      console.error("Failed to load settings:", err);
    }
  };

  const loadSchedule = async () => {
    try {
      const saved = await api.getSchedule();
      // Ensure playlists are loaded to merge with schedule
      let currentPlaylists = playlists;
      if (playlists.length === 0) {
        currentPlaylists = await loadPlaylists();
      }
      // Merge with playlists so every playlist has a row
      const merged = currentPlaylists.map((p) => {
        const found = saved.find((s) => s.playlistId === p.id);
        return (
          found || {
            playlistId: p.id!,
            enabled: false,
            time: "02:00",
          }
        );
      });
      setSchedule(merged);
    } catch (err) {
      console.error("Failed to load schedule:", err);
    }
  };

  const updateScheduleItem = (
    playlistId: number,
    patch: Partial<{ enabled: boolean; time: string }>
  ) => {
    setSchedule((prev) => {
      const existing = prev.find((s) => s.playlistId === playlistId);
      if (existing) {
        return prev.map((s) =>
          s.playlistId === playlistId ? { ...s, ...patch } : s
        );
      }
      return [...prev, { playlistId, enabled: false, time: "02:00", ...patch }];
    });
  };

  const handleSaveSchedule = async () => {
    try {
      setSavingSchedule(true);
      await api.saveSchedule(schedule);
    } catch (err) {
      setConfirmModal({
        title: "Error",
        message: "Failed to save schedule: " + (err as any).message,
        confirmVariant: "danger",
      });
    } finally {
      setSavingSchedule(false);
    }
  };

  const loadUsers = async () => {
    try {
      console.log("[loadUsers] Starting to load users...");
      setLoading(true);
      const usersData = await api.getUsers();
      console.log("[loadUsers] Users loaded:", usersData);
      console.log("[loadUsers] Number of users:", usersData?.length);
      setUsers(usersData);
    } catch (error) {
      console.error("[loadUsers] Failed to load users:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadEpgFiles = async (): Promise<{
    files: EpgFile[];
    groups: EpgGroup[];
    selectedId: number | null;
    selectedType: "file" | "group" | null;
  }> => {
    try {
      setEpgLoading(true);
      const [files, groups] = await Promise.all([
        api.getEpgFiles(),
        api.getEpgGroups(),
      ]);
      setEpgFiles(files);
      setEpgGroups(groups);

      // Auto-select default/starred EPG (or first available) so buttons render immediately
      let selectedId: number | null = selectedEpgId;
      let selectedType: "file" | "group" | null = selectedEpgType;
      if (selectedEpgId === null) {
        const defaultFile =
          files.find((f: EpgFile) => f.isDefault) || files[0];
        if (defaultFile?.id != null) {
          setSelectedEpgId(defaultFile.id);
          setSelectedEpgType("file");
          selectedId = defaultFile.id;
          selectedType = "file";
        } else if (groups.length > 0 && groups[0].id != null) {
          setSelectedEpgId(groups[0].id);
          setSelectedEpgType("group");
          selectedId = groups[0].id;
          selectedType = "group";
        }
      }
      return { files, groups, selectedId, selectedType };
    } catch (error) {
      console.error("Failed to load EPG files:", error);
      setConfirmModal({
        title: "Error",
        message: "Failed to load EPG files",
        confirmVariant: "danger",
      });
      return {
        files: [],
        groups: [],
        selectedId: selectedEpgId,
        selectedType: selectedEpgType,
      };
    } finally {
      setEpgLoading(false);
    }
  };

  const pollEpgImportJob = async (jobId: number) => {
    try {
      const job = await api.getEpgImportJob(jobId);

      // Update progress
      setImportProgress({
        jobId,
        name: job.name,
        status: job.status,
        progress: job.progress,
        downloadProgress: job.downloadProgress ?? job.progress,
        importProgress: job.importProgress ?? job.progress,
        message: job.message || `Status: ${job.status}`,
      });

      // If still in progress, poll again in 3 seconds
      if (
        job.status === "pending" ||
        job.status === "downloading" ||
        job.status === "parsing" ||
        job.status === "importing"
      ) {
        setTimeout(() => pollEpgImportJob(jobId), 1000); // faster polling for progress bars
      } else if (job.status === "completed") {
        // Success!
        setTimeout(() => {
          setImportProgress(null);
          setEpgLoading(false);
          loadEpgFiles();
          setConfirmModal({
            title: "✅ EPG Import Complete",
            message: `Successfully imported ${job.importedChannels.toLocaleString()} channels from ${job.totalChannels.toLocaleString()} total channels in the EPG file.`,
            confirmVariant: "success",
          });
        }, 2000); // Show 100% for 2 seconds before closing
      } else if (job.status === "failed") {
        // Failed
        setImportProgress(null);
        setEpgLoading(false);
        setConfirmModal({
          title: "❌ EPG Import Failed",
          message:
            job.message ||
            job.error ||
            "An unknown error occurred during EPG import.",
          confirmVariant: "danger",
        });
      }
    } catch (error: any) {
      console.error("Polling error:", error);
      setImportProgress(null);
      setEpgLoading(false);
      setConfirmModal({
        title: "Import Error",
        message: "Failed to check import status. Please refresh the page.",
        confirmVariant: "danger",
      });
    }
  };

  const handleAddEpgFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEpgName || !newEpgUrl) return;

    try {
      setEpgLoading(true);
      const result = await api.createEpgFile(newEpgName, newEpgUrl);

      // Start polling for import progress
      setImportProgress({
        jobId: result.jobId,
        name: newEpgName,
        status: result.status,
        progress: result.progress,
        message: result.message || "Starting import...",
      });

      setNewEpgName("");
      setNewEpgUrl("");
      setShowAddEpgForm(false);

      // Start polling
      pollEpgImportJob(result.jobId);
    } catch (error: any) {
      setConfirmModal({
        title: "Import Failed",
        message: error.response?.data?.error || "Failed to start EPG import",
        confirmVariant: "danger",
      });
      setEpgLoading(false);
    }
  };

  const handleDeleteEpgFile = async (id: number) => {
    setConfirmModal({
      title: "Delete EPG File",
      message:
        "Are you sure you want to delete this EPG file? This will also remove all associated channels from your lineup.",
      confirmText: "Delete",
      confirmVariant: "danger",
      onConfirm: async () => {
        try {
          await api.deleteEpgFile(id);
          setConfirmModal({
            title: "Success",
            message: "EPG file deleted successfully",
            confirmVariant: "success",
          });
          loadEpgFiles();
          loadData(); // Reload channels
        } catch (error: any) {
          setConfirmModal({
            title: "Error",
            message: error.response?.data?.error || "Failed to delete EPG file",
            confirmVariant: "danger",
          });
        }
      },
    });
  };

  const handleSetDefaultEpg = async (epgFile: EpgFile) => {
    if (epgFile.isDefault) return; // Already default

    try {
      await api.setDefaultEpgFile(epgFile.id!);
      // Reload to get updated state
      await loadEpgFiles();
      setConfirmModal({
        title: "✅ Success",
        message: `"${epgFile.name}" is now the default EPG file.`,
        confirmVariant: "success",
      });
    } catch (error: any) {
      setConfirmModal({
        title: "Error",
        message: "Failed to set default EPG file",
        confirmVariant: "danger",
      });
    }
  };

  const handleEditEpgFile = (epgFile: EpgFile) => {
    setEditingEpgFile(epgFile);
    setEditEpgName(epgFile.name);
    setEditEpgUrl(epgFile.url);
    setShowEditEpgModal(true);
  };

  const handleSaveEditEpg = async () => {
    if (!editingEpgFile || !editEpgName || !editEpgUrl) return;

    try {
      setEpgLoading(true);

      // Check if URL changed
      const urlChanged = editEpgUrl !== editingEpgFile.url;

      // Update EPG file
      await api.updateEpgFile(editingEpgFile.id!, {
        name: editEpgName,
        url: editEpgUrl,
      });

      // If URL changed, sync via job pipeline with progress modal
      if (urlChanged) {
        setEpgLoading(true);
        const result = await api.syncEpgFile(editingEpgFile.id!);
        setImportProgress({
          jobId: result.jobId,
          name: editEpgName,
          status: result.status,
          progress: result.progress || 5,
          downloadProgress: result.progress || 5,
          importProgress: result.progress || 0,
          message: result.message || "Sync started.",
        });
        pollEpgImportJob(result.jobId);
      }

      setConfirmModal({
        title: "Success",
        message: "EPG file updated successfully",
        confirmVariant: "success",
      });

      setShowEditEpgModal(false);
      setEditingEpgFile(null);
      setEditEpgName("");
      setEditEpgUrl("");
      loadEpgFiles();
    } catch (error: any) {
      setConfirmModal({
        title: "Error",
        message: error.response?.data?.error || "Failed to update EPG file",
        confirmVariant: "danger",
      });
    } finally {
      setEpgLoading(false);
    }
  };

  const handleSyncEpgFile = async (id: number) => {
    try {
      setSyncingEpgId(id);
      setEpgLoading(true);
      const result = await api.syncEpgFile(id);

      // Show the same import/sync modal immediately
      setImportProgress({
        jobId: result.jobId,
        name: epgFiles.find((f) => f.id === id)?.name || "EPG",
        status: result.status,
        progress: result.progress || 5,
        downloadProgress: result.progress || 5, // nudge the bar off zero
        importProgress: result.progress || 0,
        message: result.message || "Sync started.",
      });
      pollEpgImportJob(result.jobId);
    } catch (error: any) {
      setConfirmModal({
        title: "Sync Failed",
        message: error.response?.data?.error || "Failed to sync EPG file",
        confirmVariant: "danger",
      });
    } finally {
      setSyncingEpgId(null);
    }
  };

  const handleCopyEpgUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setConfirmModal({
      title: "Copied!",
      message: "EPG URL copied to clipboard",
      confirmVariant: "success",
    });
  };


  const handleTriggerImportJson = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleImportJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || selectedEpgId === null) return;
    try {
      setEpgLoading(true);
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await api.importEpgJson(selectedEpgId, data);
      setConfirmModal({
        title: "EPG Import JSON",
        message: `Updated ${result.updated} channels.`,
        confirmVariant: "success",
      });
      loadData();
    } catch (err: any) {
      setConfirmModal({
        title: "Import Failed",
        message: err?.message || "Failed to import EPG JSON",
        confirmVariant: "danger",
      });
    } finally {
      setEpgLoading(false);
    }
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = async (filtered: boolean) => {
    if (selectedEpgId === null) return;
    try {
      setEpgLoading(true);
      const blob = await api.exportEpgJson(selectedEpgId, filtered);
      downloadBlob(
        blob,
        `${(epgFiles.find((f) => f.id === selectedEpgId)?.name || "epg")}${filtered ? "-filtered" : ""
        }.json`
      );
    } catch (err: any) {
      setConfirmModal({
        title: "Export Failed",
        message: err?.message || "Failed to export EPG JSON",
        confirmVariant: "danger",
      });
    } finally {
      setEpgLoading(false);
    }
  };

  const handleExportXmltv = async (filtered: boolean) => {
    if (selectedEpgId === null) return;
    try {
      setEpgLoading(true);
      const blob = await api.exportEpgXmltv(selectedEpgId, filtered);
      downloadBlob(
        blob,
        `${(epgFiles.find((f) => f.id === selectedEpgId)?.name || "epg")}${filtered ? "-filtered" : ""
        }.xml`
      );
    } catch (err: any) {
      setConfirmModal({
        title: "Export Failed",
        message: err?.message || "Failed to export XMLTV",
        confirmVariant: "danger",
      });
    } finally {
      setEpgLoading(false);
    }
  };

  const renderChannelActions = () => {
    if (selectedEpgId === null) return null;
    return (
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleTriggerImportJson}
          disabled={epgLoading}
        >
          Import EPG JSON
        </button>
        <div className="export-dropdown">
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => setChannelExportOpen((prev) => !prev)}
            disabled={epgLoading}
          >
            Export ▾
          </button>
          {channelExportOpen && (
            <>
              <div
                className="export-dropdown-overlay"
                onClick={() => setChannelExportOpen(false)}
              />
              <div className="export-dropdown-menu">
                <button
                  className="export-dropdown-item"
                  onClick={() => {
                    handleExportJson(false);
                    setChannelExportOpen(false);
                  }}
                  disabled={epgLoading}
                >
                  <span className="export-icon">📊</span>
                  <div className="export-details">
                    <div className="export-title">JSON (Full)</div>
                    <div className="export-description">
                      Export all channels as JSON
                    </div>
                  </div>
                </button>
                <button
                  className="export-dropdown-item"
                  onClick={() => {
                    handleExportJson(true);
                    setChannelExportOpen(false);
                  }}
                  disabled={epgLoading}
                >
                  <span className="export-icon">📈</span>
                  <div className="export-details">
                    <div className="export-title">JSON (Filtered)</div>
                    <div className="export-description">
                      Export channels excluding Imported channels
                    </div>
                  </div>
                </button>
                <button
                  className="export-dropdown-item"
                  onClick={() => {
                    handleExportXmltv(true);
                    setChannelExportOpen(false);
                  }}
                  disabled={epgLoading}
                >
                  <span className="export-icon">🗂️</span>
                  <div className="export-details">
                    <div className="export-title">XMLTV (Filtered)</div>
                    <div className="export-description">
                      Export filtered XMLTV with programmes
                    </div>
                  </div>
                </button>
              </div>
            </>
          )}
        </div>
        <input
          type="file"
          accept=".json,application/json"
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={handleImportJsonFile}
        />
      </div>
    );
  };

  const formatLastSynced = (dateString: string | null | undefined) => {
    if (!dateString) return "Never";

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? "s" : ""} ago`;
    if (diffHours < 24)
      return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;

    return date.toLocaleDateString();
  };

  // EPG Group handlers
  const handleAddEpgGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName || !newGroupUrl || selectedGroupEpgFileIds.length === 0) {
      setConfirmModal({
        title: "Validation Error",
        message:
          "Please provide a name, URL, and select at least one EPG file.",
        confirmVariant: "danger",
      });
      return;
    }

    try {
      setEpgLoading(true);
      await api.createEpgGroup({
        name: newGroupName,
        url: newGroupUrl,
        epgFileIds: selectedGroupEpgFileIds,
      });
      setNewGroupName("");
      setNewGroupUrl("");
      setSelectedGroupEpgFileIds([]);
      setShowAddGroupForm(false);
      await loadEpgFiles();
      setConfirmModal({
        title: "Success",
        message: "EPG group created successfully",
        confirmVariant: "success",
      });
    } catch (error: any) {
      setConfirmModal({
        title: "Error",
        message: error.response?.data?.error || "Failed to create EPG group",
        confirmVariant: "danger",
      });
    } finally {
      setEpgLoading(false);
    }
  };

  const handleEditEpgGroup = (epgGroup: EpgGroup) => {
    setEditingEpgGroup(epgGroup);
    setEditGroupName(epgGroup.name);
    setEditGroupUrl(epgGroup.url);
    setEditGroupEpgFileIds(epgGroup.epgFileIds || []);
    setShowEditGroupModal(true);
  };

  const handleSaveEditGroup = async () => {
    if (
      !editingEpgGroup ||
      !editGroupName ||
      !editGroupUrl ||
      editGroupEpgFileIds.length === 0
    ) {
      setConfirmModal({
        title: "Validation Error",
        message:
          "Please provide a name, URL, and select at least one EPG file.",
        confirmVariant: "danger",
      });
      return;
    }

    try {
      setEpgLoading(true);
      await api.updateEpgGroup(editingEpgGroup.id!, {
        name: editGroupName,
        url: editGroupUrl,
        epgFileIds: editGroupEpgFileIds,
      });
      setShowEditGroupModal(false);
      setEditingEpgGroup(null);
      await loadEpgFiles();
      setConfirmModal({
        title: "Success",
        message: "EPG group updated successfully",
        confirmVariant: "success",
      });
    } catch (error: any) {
      setConfirmModal({
        title: "Error",
        message: error.response?.data?.error || "Failed to update EPG group",
        confirmVariant: "danger",
      });
    } finally {
      setEpgLoading(false);
    }
  };

  const handleDeleteEpgGroup = async (id: number) => {
    setConfirmModal({
      title: "Delete EPG Group",
      message:
        "Are you sure you want to delete this EPG group? The individual EPG files will not be deleted.",
      confirmText: "Delete",
      cancelText: "Cancel",
      confirmVariant: "danger",
      onConfirm: async () => {
        try {
          await api.deleteEpgGroup(id);
          await loadEpgFiles();
          setConfirmModal({
            title: "Success",
            message: "EPG group deleted successfully",
            confirmVariant: "success",
          });
        } catch (error: any) {
          setConfirmModal({
            title: "Error",
            message: "Failed to delete EPG group",
            confirmVariant: "danger",
          });
        }
      },
    });
  };

  const handleSetDefaultEpgGroup = async (epgGroup: EpgGroup) => {
    if (epgGroup.isDefault) return; // Already default

    try {
      await api.setDefaultEpgGroup(epgGroup.id!);
      await loadEpgFiles();
      setConfirmModal({
        title: "✅ Success",
        message: `"${epgGroup.name}" is now the default EPG.`,
        confirmVariant: "success",
      });
    } catch (error: any) {
      setConfirmModal({
        title: "Error",
        message: "Failed to set default EPG group",
        confirmVariant: "danger",
      });
    }
  };

  const toggleGroupEpgFile = (epgFileId: number, isNewGroup: boolean) => {
    if (isNewGroup) {
      setSelectedGroupEpgFileIds((prev) =>
        prev.includes(epgFileId)
          ? prev.filter((id) => id !== epgFileId)
          : [...prev, epgFileId]
      );
    } else {
      setEditGroupEpgFileIds((prev) =>
        prev.includes(epgFileId)
          ? prev.filter((id) => id !== epgFileId)
          : [...prev, epgFileId]
      );
    }
  };

  const handleSaveDebugMode = async (enabled: boolean) => {
    try {
      setSavingSettings(true);
      await api.updateSettings({ debugMode: enabled });
      setDebugMode(enabled);
    } catch (err: any) {
      console.error("Failed to save debug mode:", err);
      setConfirmModal({
        title: "Error",
        message: "Failed to save settings",
        confirmVariant: "danger",
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveTelegram = async () => {
    if (!telegramBotToken || !telegramChatId) {
      setConfirmModal({
        title: "Telegram Required",
        message: "Please provide both Bot Token and Chat ID before testing.",
        confirmVariant: "warning",
      });
      return;
    }

    try {
      setSavingSettings(true);
      // Send test message without persisting
      await api.testTelegram({
        botToken: telegramBotToken,
        chatId: telegramChatId,
      });

      // Ask user to confirm receipt; only then persist
      setConfirmModal({
        title: "Test Message Sent",
        message: "We sent a test Telegram message. Did you receive it?",
        confirmText: "Yes",
        cancelText: "No",
        confirmVariant: "primary",
        onConfirm: async () => {
          try {
            await api.updateSettings({
              telegramBotToken,
              telegramChatId,
              telegramSendSummaries,
            });
            setPrevTelegramBotToken(telegramBotToken);
            setPrevTelegramChatId(telegramChatId);
            setPrevTelegramSendSummaries(telegramSendSummaries);
            setConfirmModal({
              title: "Saved",
              message: "Telegram settings saved.",
              confirmText: "OK",
              onConfirm: () => setConfirmModal(null),
              confirmVariant: "success",
            });
          } catch (err: any) {
            setConfirmModal({
              title: "Error",
              message: "Failed to save Telegram settings",
              confirmVariant: "danger",
            });
          } finally {
            setSavingSettings(false);
          }
        },
      });

      // Handle No choice by separate modal
      setConfirmModal((prev) =>
        prev
          ? {
              ...prev,
              onConfirm: prev.onConfirm,
              cancelText: "No",
              onCancel: () => {
                setTelegramBotToken(prevTelegramBotToken);
                setTelegramChatId(prevTelegramChatId);
                setTelegramSendSummaries(prevTelegramSendSummaries);
                setSavingSettings(false);
                setConfirmModal(null);
              },
            }
          : prev
      );
    } catch (err: any) {
      console.error("Failed to send Telegram test:", err);
      setConfirmModal({
        title: "Error",
        message:
          "Failed to send Telegram test message: " +
          (err?.response?.data?.error || err.message),
        confirmVariant: "danger",
      });
      setSavingSettings(false);
    }
  };

  const handleSaveBypass2FA = async (enabled: boolean) => {
    try {
      setSavingSettings(true);
      await api.updateSettings({ bypass2FA: enabled });
      setBypass2FA(enabled);
    } catch (err: any) {
      console.error("Failed to save bypass 2FA setting:", err);
      setConfirmModal({
        title: "Error",
        message: "Failed to save bypass 2FA setting. Admin access required.",
        confirmVariant: "danger",
      });
      setBypass2FA(!enabled);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveSyncTimeout = async (value: number) => {
    try {
      setSavingSettings(true);
      await api.updateSettings({ syncTimeout: value });
      setSyncTimeout(value);
    } catch (err: any) {
      console.error("Failed to save sync timeout:", err);
      setConfirmModal({
        title: "Error",
        message:
          "Failed to save sync timeout. Value must be between 10 and 300 seconds.",
        confirmVariant: "danger",
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDeleteUser = async (userId: number) => {
    const userToDelete = users.find((u) => u.id === userId);
    setConfirmModal({
      title: "Delete User",
      message: `Are you sure you want to delete user "${userToDelete?.email}"? This action cannot be undone.`,
      confirmText: "Delete",
      confirmVariant: "danger",
      onConfirm: async () => {
    try {
      await api.deleteUser(userId);
      await loadUsers();
    } catch (err: any) {
          setConfirmModal({
            title: "Error",
            message: err.response?.data?.error || "Failed to delete user",
            confirmVariant: "danger",
          });
        }
      },
    });
  };

  const handleResetUser2FA = async (userId: number) => {
    const userToReset = users.find((u) => u.id === userId);
    setConfirmModal({
      title: "Reset 2FA",
      message: `Reset 2FA for "${userToReset?.email}"? The user will be prompted to set up 2FA on their next login.`,
      confirmText: "Reset 2FA",
      confirmVariant: "warning",
      onConfirm: async () => {
    try {
      await api.reset2FA(userId);
      await loadUsers();
          // Show success modal
          setConfirmModal({
            title: "Success",
            message:
              "2FA has been reset successfully. The user will be prompted to set up 2FA on their next login.",
            confirmText: "OK",
            confirmVariant: "primary",
            onConfirm: () => {},
          });
    } catch (err: any) {
          // Show error modal
          setConfirmModal({
            title: "Error",
            message:
              err.response?.data?.error ||
              "Failed to reset 2FA. Please try again.",
            confirmText: "OK",
            confirmVariant: "danger",
            onConfirm: () => {},
          });
        }
      },
    });
  };

  const handleChangeUserRole = async (userId: number, newRole: string) => {
    try {
      await api.updateUserRole(userId, newRole);
      await loadUsers();
    } catch (err: any) {
      setConfirmModal({
        title: "Error",
        message: err.response?.data?.error || "Failed to change user role",
        confirmVariant: "danger",
      });
    }
  };

  const handleOpenRoleChangeModal = (userId: number, currentRole: string) => {
    setRoleChangeUserId(userId);
    // Normalize role to match UserRole enum values
    const normalizedRole =
      currentRole === "ADMIN" || currentRole === "Admin"
        ? UserRole.ADMIN
        : UserRole.USER;
    setRoleChangeNewRole(normalizedRole);
    setShowRoleChangeModal(true);
  };

  const handleConfirmRoleChange = async () => {
    if (roleChangeUserId !== null && roleChangeNewRole) {
      await handleChangeUserRole(roleChangeUserId, roleChangeNewRole);
      setShowRoleChangeModal(false);
      setRoleChangeUserId(null);
      setRoleChangeNewRole("");
    }
  };

  const handleCancelRoleChange = () => {
    setShowRoleChangeModal(false);
    setRoleChangeUserId(null);
    setRoleChangeNewRole("");
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newUserEmail || !newUserPassword) {
      setConfirmModal({
        title: "Validation Error",
        message: "Email and password are required",
        confirmVariant: "warning",
      });
      return;
    }

    try {
      await api.createUser({
        email: newUserEmail,
        password: newUserPassword,
        role: newUserRole,
      });

      // Reset form
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserRole(UserRole.MEMBER);
      setShowAddUserForm(false);

      // Reload users
      await loadUsers();
      setConfirmModal({
        title: "Success",
        message: "User created successfully!",
        confirmVariant: "success",
      });
    } catch (err: any) {
      setConfirmModal({
        title: "Error",
        message: err.response?.data?.error || "Failed to create user",
        confirmVariant: "danger",
      });
    }
  };

  const loadData = async (
    epgIdOverride?: number | null,
    epgTypeOverride?: "file" | "group"
  ) => {
    try {
      setLoading(true);

      const epgId = epgIdOverride ?? selectedEpgId;
      const epgType = epgTypeOverride ?? selectedEpgType;

      if (!epgId) {
        setChannels([]);
        setCategories([]);
        return;
      }

      if (epgType === "group" && epgId) {
        // For EPG groups, fetch channels from all associated EPG files
        const group = epgGroups.find((g) => g.id === epgId);
        if (group && group.epgFileIds && group.epgFileIds.length > 0) {
          // Fetch channels and categories for each EPG file in the group
          const allChannelsPromises = group.epgFileIds.map((fileId) =>
            api.getAdminChannelLineup(fileId)
          );
          const allCategoriesPromises = group.epgFileIds.map((fileId) =>
            api.getChannelLineupCategories(fileId)
          );

          const [channelsArrays, categoriesArrays] = await Promise.all([
            Promise.all(allChannelsPromises),
            Promise.all(allCategoriesPromises),
          ]);

          // Combine all channels (remove duplicates by id)
          const allChannels = channelsArrays.flat();
          const uniqueChannels = Array.from(
            new Map(allChannels.map((ch) => [ch.id, ch])).values()
          );

          // Combine all categories (remove duplicates by name)
          const allCategories = categoriesArrays.flat();
          const uniqueCategoriesUnordered = Array.from(
            new Map(allCategories.map((cat) => [cat.name, cat])).values()
          );
          const orderedCategories = [
            ...uniqueCategoriesUnordered.filter(
              (c) =>
                c.name &&
                c.name.toLowerCase() !== "imported channels"
            ),
            ...uniqueCategoriesUnordered.filter(
              (c) => c.name && c.name.toLowerCase() === "imported channels"
            ),
          ];

          setChannels(uniqueChannels);
          setCategories(orderedCategories);
        } else {
          setChannels([]);
          setCategories([]);
        }
      } else {
        // For EPG files, fetch normally
      const [channelsData, categoriesData] = await Promise.all([
          api.getAdminChannelLineup(epgId),
          api.getChannelLineupCategories(epgId),
      ]);
      setChannels(channelsData);
        const orderedCategories = [
          ...categoriesData.filter(
            (c) =>
              c.name &&
              c.name.toLowerCase() !== "imported channels"
          ),
          ...categoriesData.filter(
            (c) => c.name && c.name.toLowerCase() === "imported channels"
          ),
        ];
        setCategories(orderedCategories);
      }
    } catch (error: any) {
      setConfirmModal({
        title: "Error",
        message: "Failed to load data: " + error.message,
        confirmVariant: "danger",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadPlaylists = async () => {
    try {
      setLoading(true);
      const playlistsData = await api.getPlaylists();
      setPlaylists(playlistsData);
      return playlistsData;
    } catch (error: any) {
      setConfirmModal({
        title: "Error",
        message: "Failed to load playlists: " + error.message,
        confirmVariant: "danger",
      });
      return [];
    } finally {
      setLoading(false);
    }
  };

  const getFilteredChannels = () => {
    let filtered = selectedCategory
      ? channels.filter((ch) => ch.extGrp === selectedCategory)
      : channels;

    // Apply search filter
    if (channelSearchTerm.trim()) {
      const searchLower = channelSearchTerm.toLowerCase();
      filtered = filtered.filter(
        (ch) =>
          ch.name.toLowerCase().includes(searchLower) ||
          ch.tvgId?.toLowerCase().includes(searchLower)
      );
    }

    return filtered;
  };

  const handleAddChannel = () => {
    setEditingChannel(null);
    setFormData({
      name: "",
      tvgLogo: "",
      tvgId: "",
      extGrp: selectedCategory || "",
    });
    setShowAddForm(true);
  };

  const handleEditChannel = (channel: LineupChannel) => {
    setEditingChannel(channel);
    setFormData({
      name: channel.name,
      tvgLogo: channel.tvgLogo || "",
      tvgId: channel.tvgId || "",
      extGrp: channel.extGrp || "",
    });
    setShowAddForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      setConfirmModal({
        title: "Validation Error",
        message: "Channel name is required",
        confirmVariant: "warning",
      });
      return;
    }

    try {
      if (editingChannel) {
        await api.updateChannelLineup(editingChannel.id, {
          name: formData.name,
          tvgLogo: formData.tvgLogo || undefined,
          tvgId: formData.tvgId || undefined,
          extGrp: formData.extGrp || undefined,
        });
      } else {
        await api.createChannelLineup({
          name: formData.name,
          tvgLogo: formData.tvgLogo || undefined,
          tvgId: formData.tvgId || undefined,
          extGrp: formData.extGrp || undefined,
        });
      }

      setShowAddForm(false);
      setEditingChannel(null);
      loadData();
    } catch (error: any) {
      setConfirmModal({
        title: "Error",
        message: "Failed to save channel: " + error.message,
        confirmVariant: "danger",
      });
    }
  };

  const handleDelete = async (channelId: number) => {
    const channelToDelete = channels.find((c) => c.id === channelId);
    setConfirmModal({
      title: "Delete Channel",
      message: `Are you sure you want to delete "${channelToDelete?.name}"? This action cannot be undone.`,
      confirmText: "Delete",
      confirmVariant: "danger",
      onConfirm: async () => {
    try {
      await api.deleteChannelLineup(channelId);
      loadData();
    } catch (error: any) {
          setConfirmModal({
            title: "Error",
            message: "Failed to delete channel: " + error.message,
            confirmVariant: "danger",
          });
        }
      },
    });
  };

  const handleDragStart = (channel: LineupChannel) => {
    setDraggedChannel(channel);
  };

  const handleDragOver = (e: React.DragEvent, channel: LineupChannel) => {
    e.preventDefault();
    if (draggedChannel && draggedChannel.id !== channel.id) {
      setDragOverChannel(channel.id);
    }
  };

  const handleDragLeave = () => {
    setDragOverChannel(null);
  };

  const handleDragEnd = () => {
    setDraggedChannel(null);
    setDragOverChannel(null);
  };

  const handleDrop = async (targetChannel: LineupChannel) => {
    setDragOverChannel(null);

    if (!draggedChannel || draggedChannel.id === targetChannel.id) {
      setDraggedChannel(null);
      return;
    }

    const draggedChannelId = draggedChannel.id;
    const filtered = getFilteredChannels();
    const draggedIndex = filtered.findIndex(
      (ch) => ch.id === draggedChannel.id
    );
    const targetIndex = filtered.findIndex((ch) => ch.id === targetChannel.id);

    // Create new order
    const reordered = [...filtered];
    reordered.splice(draggedIndex, 1);

    // Adjust target index when dragging down
    // After removing the dragged item, indices shift, so we need to compensate
    const adjustedTargetIndex =
      draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
    reordered.splice(adjustedTargetIndex, 0, draggedChannel);

    // Calculate base sortOrder for this category
    const categoryIndex = selectedCategory
      ? categories.findIndex((cat) => cat.name === selectedCategory)
      : -1;
    const baseSortOrder = categoryIndex >= 0 ? categoryIndex * 1000 : 0;

    // Update sortOrder for all affected channels with proper base
    const updates = reordered.map((ch, index) => ({
      id: ch.id,
      sortOrder: baseSortOrder + index,
    }));

    console.log("Reordering channels:", {
      selectedCategory,
      categoryIndex,
      baseSortOrder,
      updatesCount: updates.length,
      updates,
      firstUpdate: updates[0],
      payload: { channels: updates },
    });

    // Store original state for rollback
    const originalChannels = [...channels];

    try {
      // Optimistically update UI immediately
      const updatedChannels = channels.map((ch) => {
        const update = updates.find((u) => u.id === ch.id);
        return update ? { ...ch, sortOrder: update.sortOrder } : ch;
      });

      // Re-sort channels to match backend sorting (by category, then by sortOrder within category)
      // Calculate min sortOrder per category for category ordering
      const categoryMinSort = new Map<string | null, number>();
      updatedChannels.forEach((ch) => {
        const category = ch.extGrp;
        const currentMin = categoryMinSort.get(category);
        if (currentMin === undefined || ch.sortOrder < currentMin) {
          categoryMinSort.set(category, ch.sortOrder);
        }
      });

      // Sort channels: first by category order (min sortOrder), then by individual sortOrder
      const sortedChannels = updatedChannels.sort((a, b) => {
        const aCategoryMin = categoryMinSort.get(a.extGrp) || 0;
        const bCategoryMin = categoryMinSort.get(b.extGrp) || 0;

        // First compare by category order
        if (aCategoryMin !== bCategoryMin) {
          return aCategoryMin - bCategoryMin;
        }

        // If same category, compare by individual sortOrder
        return a.sortOrder - b.sortOrder;
      });

      setChannels(sortedChannels);

      // Persist to server in background
      await api.reorderChannelLineup(updates);

      // Scroll to the dragged channel
      requestAnimationFrame(() => {
        const channelElement = document.querySelector(
          `[data-channel-id="${draggedChannelId}"]`
        );
        if (channelElement) {
          channelElement.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
      });
    } catch (error: any) {
      // Rollback on error
      setChannels(originalChannels);
      console.error("Reorder channels error:", error);
      console.error("Error response data:", error.response?.data);
      console.error("Error response status:", error.response?.status);
      setConfirmModal({
        title: "Error",
        message:
        "Failed to reorder channels: " +
          (error.response?.data?.error || error.message),
        confirmVariant: "danger",
      });
    }

    setDraggedChannel(null);
  };

  const handleEditCategoryName = (categoryName: string) => {
    setEditingCategoryName(categoryName);
    setNewCategoryName(categoryName);
  };

  const handleSaveCategoryName = async () => {
    if (!editingCategoryName || !newCategoryName.trim()) {
      return;
    }

    try {
      await api.renameCategory(editingCategoryName, newCategoryName.trim());
      setEditingCategoryName(null);
      setNewCategoryName("");
      loadData();
    } catch (error: any) {
      setConfirmModal({
        title: "Error",
        message: "Failed to rename category: " + error.message,
        confirmVariant: "danger",
      });
    }
  };

  const handleCancelEditCategoryName = () => {
    setEditingCategoryName(null);
    setNewCategoryName("");
  };

  const handleCategoryDragStart = (categoryName: string) => {
    setDraggedCategory(categoryName);
  };

  const handleCategoryDragOver = (e: React.DragEvent, categoryName: string) => {
    e.preventDefault();
    if (draggedCategory && draggedCategory !== categoryName) {
      setDragOverCategory(categoryName);
    }
  };

  const handleCategoryDragLeave = () => {
    setDragOverCategory(null);
  };

  const handleCategoryDragEnd = () => {
    setDraggedCategory(null);
    setDragOverCategory(null);
  };

  const handleCategoryDrop = async (targetCategory: string) => {
    setDragOverCategory(null);

    if (!draggedCategory || draggedCategory === targetCategory) {
      setDraggedCategory(null);
      return;
    }

    const draggedCategoryName = draggedCategory;
    const draggedIndex = categories.findIndex(
      (cat) => cat.name === draggedCategory
    );
    const targetIndex = categories.findIndex(
      (cat) => cat.name === targetCategory
    );

    // Create new category order
    const reordered = [...categories];
    reordered.splice(draggedIndex, 1);

    // Adjust target index when dragging down
    const adjustedTargetIndex =
      draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
    reordered.splice(adjustedTargetIndex, 0, { name: draggedCategory });

    // Update sortOrder for all channels in all affected categories
    const updates: Array<{ id: number; sortOrder: number }> = [];

    reordered.forEach((cat, catIndex) => {
      const categoryChannels = channels
        .filter((ch) => ch.extGrp === cat.name)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      categoryChannels.forEach((ch, chIndex) => {
        updates.push({
          id: ch.id,
          sortOrder: catIndex * 1000 + chIndex,
        });
      });
    });

    // Also update channels with no category (null extGrp)
    const uncategorized = channels.filter((ch) => !ch.extGrp);
    uncategorized.forEach((ch, index) => {
      updates.push({
        id: ch.id,
        sortOrder: 999000 + index, // Put uncategorized at the end
      });
    });

    console.log("Reordering categories:", {
      draggedCategory,
      targetCategory,
      reordered: reordered.map((c) => c.name),
      updatesCount: updates.length,
      updates,
    });

    // Store original state for rollback
    const originalChannels = [...channels];
    const originalCategories = [...categories];

    try {
      // Optimistically update UI immediately
      const updatedChannels = channels.map((ch) => {
        const update = updates.find((u) => u.id === ch.id);
        return update ? { ...ch, sortOrder: update.sortOrder } : ch;
      });

      // Re-sort channels to match backend sorting (by category, then by sortOrder within category)
      const categoryMinSort = new Map<string | null, number>();
      updatedChannels.forEach((ch) => {
        const category = ch.extGrp;
        const currentMin = categoryMinSort.get(category);
        if (currentMin === undefined || ch.sortOrder < currentMin) {
          categoryMinSort.set(category, ch.sortOrder);
        }
      });

      const sortedChannels = updatedChannels.sort((a, b) => {
        const aCategoryMin = categoryMinSort.get(a.extGrp) || 0;
        const bCategoryMin = categoryMinSort.get(b.extGrp) || 0;

        if (aCategoryMin !== bCategoryMin) {
          return aCategoryMin - bCategoryMin;
        }

        return a.sortOrder - b.sortOrder;
      });

      setChannels(sortedChannels);
      setCategories(reordered);

      // Persist to server in background
      await api.reorderChannelLineup(updates);

      // Scroll to the dragged category
      requestAnimationFrame(() => {
        const categoryElement = document.querySelector(
          `[data-category-name="${CSS.escape(draggedCategoryName)}"]`
        );
        if (categoryElement) {
          categoryElement.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
      });
    } catch (error: any) {
      // Rollback on error
      setChannels(originalChannels);
      setCategories(originalCategories);
      console.error("Reorder categories error:", error);
      setConfirmModal({
        title: "Error",
        message: "Failed to reorder categories: " + error.message,
        confirmVariant: "danger",
      });
    }

    setDraggedCategory(null);
  };

  // Playlist Drag and Drop Handlers
  const handlePlaylistDragStart = (playlist: Playlist) => {
    setDraggedPlaylist(playlist);
  };

  const handlePlaylistDragOver = (e: React.DragEvent, playlistId: number) => {
    e.preventDefault();
    setDragOverPlaylist(playlistId);
  };

  const handlePlaylistDragEnd = () => {
    setDraggedPlaylist(null);
    setDragOverPlaylist(null);
  };

  const handlePlaylistDrop = async (targetPlaylist: Playlist) => {
    setDragOverPlaylist(null);

    if (!draggedPlaylist || draggedPlaylist.id === targetPlaylist.id) {
      setDraggedPlaylist(null);
      return;
    }

    const draggedPlaylistData = draggedPlaylist;
    const draggedIndex = playlists.findIndex(
      (p) => p.id === draggedPlaylist.id
    );
    const targetIndex = playlists.findIndex((p) => p.id === targetPlaylist.id);

    // Create new order
    const reordered = [...playlists];
    reordered.splice(draggedIndex, 1);

    // Adjust target index when dragging down
    const adjustedTargetIndex =
      draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
    reordered.splice(adjustedTargetIndex, 0, draggedPlaylist);

    // Update sortOrder for all playlists
    const updates = reordered.map((playlist, index) => ({
      id: playlist.id!,
      sortOrder: index,
    }));

    // Store original state for rollback
    const originalPlaylists = [...playlists];

    try {
      // Optimistically update UI immediately
      const updatedPlaylists = reordered.map((playlist, index) => ({
        ...playlist,
        sortOrder: index,
      }));
      setPlaylists(updatedPlaylists);

      // Persist to server in background
      await api.reorderPlaylists(updates);

      // Notify parent to refresh playlist list
      if (onPlaylistsReordered) {
        onPlaylistsReordered();
      }

      // Scroll to the dragged playlist
      requestAnimationFrame(() => {
        const playlistElement = document.querySelector(
          `[data-playlist-id="${draggedPlaylistData.id}"]`
        );
        if (playlistElement) {
          playlistElement.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
      });
    } catch (error: any) {
      // Rollback on error
      setPlaylists(originalPlaylists);
      console.error("Reorder playlists error:", error);
      setConfirmModal({
        title: "Error",
        message: "Failed to reorder playlists: " + error.message,
        confirmVariant: "danger",
      });
    }

    setDraggedPlaylist(null);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content admin-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-tabs">
          {isAdmin && (
            <button
              className={`tab-btn ${activeTab === "general" ? "active" : ""}`}
              onClick={() => setActiveTab("general")}
            >
              Admin
            </button>
          )}
          <button
            className={`tab-btn ${activeTab === "playlists" ? "active" : ""}`}
            onClick={() => setActiveTab("playlists")}
          >
            Playlists
          </button>
          <button
            className={`tab-btn ${activeTab === "channels" ? "active" : ""}`}
            onClick={() => setActiveTab("channels")}
          >
            Channels
          </button>
          <button
            className={`tab-btn ${activeTab === "epg" ? "active" : ""}`}
            onClick={() => setActiveTab("epg")}
          >
            EPG
          </button>
          <button
            className={`tab-btn ${activeTab === "schedule" ? "active" : ""}`}
            onClick={() => setActiveTab("schedule")}
          >
            Schedule
          </button>
        </div>

        <div className="modal-body">
          {activeTab === "general" && isAdmin && (
            <div className="tab-content">
              <div className="settings-section">
                <h3>Telegram Account Setup</h3>
                <p className="setting-description">
                  Provide a Telegram Bot token and your chat ID so the app can send
                  sync summaries to you. (Bot token and chat ID are stored locally.)
                </p>
                <div className="setting-item">
                  <label className="setting-label">
                    <span className="setting-text">Bot Token</span>
                  </label>
                  <input
                    type="text"
                    className="setting-input"
                    style={{ width: "100%", maxWidth: "420px" }}
                    placeholder="123456:ABC-DEF..."
                    value={telegramBotToken}
                    onChange={(e) => setTelegramBotToken(e.target.value)}
                    disabled={savingSettings}
                  />
                </div>
                <div className="setting-item">
                  <label className="setting-label">
                    <span className="setting-text">Chat ID</span>
                  </label>
                  <input
                    type="text"
                    className="setting-input"
                    style={{ width: "100%", maxWidth: "420px" }}
                    placeholder="Your chat ID"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    disabled={savingSettings}
                  />
                </div>
                <div className="setting-item">
                  <label className="setting-label">
                    <input
                      type="checkbox"
                      checked={telegramSendSummaries}
                      onChange={(e) => setTelegramSendSummaries(e.target.checked)}
                      disabled={savingSettings}
                    />
                    <span className="setting-text">Send sync summaries via Telegram</span>
                  </label>
                </div>
                <div className="settings-actions">
                  <button
                    className="btn btn-primary"
                    onClick={handleSaveTelegram}
                    disabled={savingSettings}
                  >
                    {savingSettings ? "Saving..." : "Save Telegram Settings"}
                  </button>
                </div>
              </div>

              <div className="settings-section">
                <h3>Debug Settings</h3>
                <div className="setting-item">
                  <label className="setting-label">
                    <input
                      type="checkbox"
                      checked={debugMode}
                      onChange={(e) => handleSaveDebugMode(e.target.checked)}
                      disabled={savingSettings}
                    />
                    <span className="setting-text">Enable Debug Mode</span>
                  </label>
                  <p className="setting-description">
                    When enabled, the system will log detailed debug information
                    to the server console. Disable this in production for better
                    performance and cleaner logs.
                  </p>
                </div>

                <div className="setting-item">
                  <label className="setting-label">
                    <span className="setting-text">Sync Timeout (seconds)</span>
                  </label>
                  <input
                    type="number"
                    min="10"
                    max="300"
                    value={syncTimeout}
                    onChange={(e) => {
                      const value = parseInt(e.target.value, 10);
                      if (!isNaN(value)) {
                        setSyncTimeout(value);
                      }
                    }}
                    onBlur={() => handleSaveSyncTimeout(syncTimeout)}
                    disabled={savingSettings}
                    style={{
                      width: "120px",
                      padding: "0.5rem",
                      marginTop: "0.5rem",
                      fontSize: "1rem",
                      border: "1px solid var(--border-color)",
                      borderRadius: "6px",
                      backgroundColor: "var(--bg-secondary)",
                      color: "var(--text-primary)",
                    }}
                  />
                  <p className="setting-description">
                    Maximum time (in seconds) to wait for playlist sync
                    operations to complete. Range: 10-300 seconds. Default: 60
                    seconds. Increase this value if you have large playlists
                    that take longer to sync.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "playlists" && (
            <div className="tab-content playlists-management">
              {loading ? (
                <div className="loading-state">Loading...</div>
              ) : playlists.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📋</div>
                  <h3>No Playlists Yet</h3>
                  <p>
                    You haven't added any playlists yet. Playlists allow you to
                    organize and manage your IPTV channels.
                  </p>
                  <p className="empty-hint">
                    To get started, click the <strong>"+ Add Playlist"</strong>{" "}
                    button in the main sidebar to add your first M3U or Xtream
                    Codes playlist.
                  </p>
                </div>
              ) : (
                <>
                  <div className="playlists-list">
                    {playlists.map((playlist) => (
                      <div
                        key={playlist.id}
                        data-playlist-id={playlist.id}
                        className={`playlist-drag-item ${
                          dragOverPlaylist === playlist.id ? "drag-over" : ""
                        }`}
                        draggable
                        onDragStart={() => handlePlaylistDragStart(playlist)}
                        onDragOver={(e) =>
                          handlePlaylistDragOver(e, playlist.id!)
                        }
                        onDragEnd={handlePlaylistDragEnd}
                        onDrop={() => handlePlaylistDrop(playlist)}
                      >
                        <span className="playlist-drag-handle">⋮⋮</span>
                        <div className="playlist-info">
                          <div className="playlist-header-row">
                          <div className="playlist-name">{playlist.name}</div>
                            <span
                              className={`status-indicator ${
                                playlist.externalAccessEnabled
                                  ? "enabled"
                                  : "disabled"
                              }`}
                              title={
                                playlist.externalAccessEnabled
                                  ? "External access enabled"
                                  : "External access disabled"
                              }
                            />
                          </div>
                          <div className="playlist-details-grid">
                            <div className="playlist-detail-item">
                              <span className="detail-label">Type:</span>
                            <span className="playlist-type">
                              {playlist.type.toUpperCase()}
                            </span>
                            </div>
                            <div className="playlist-detail-item">
                              <span className="detail-label">
                                Total channels:
                              </span>
                              <span className="detail-value">
                                {playlist.channelCount || 0}
                            </span>
                          </div>
                            <div className="playlist-detail-item">
                              <span className="detail-label">
                                Filtered channels:
                              </span>
                              <span className="detail-value">
                                {playlist.filteredChannelCount ??
                                  playlist.channelCount ??
                                  0}
                              </span>
                            </div>
                            <div className="playlist-detail-item">
                              <span className="detail-label">
                                Total groups:
                              </span>
                              <span className="detail-value">
                                {playlist.categoryCount || 0}
                              </span>
                            </div>
                            <div className="playlist-detail-item">
                              <span className="detail-label">
                                Filtered groups:
                              </span>
                              <span className="detail-value">
                                {playlist.filteredCategoryCount ??
                                  playlist.categoryCount ??
                                  0}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "channels" && (
            <div className="tab-content channels-management">
              {loading ? (
                <div className="loading-state">Loading...</div>
              ) : (
                <>
                  <div className="channels-layout">
                    <div className="categories-panel">
                      <div className="panel-header">
                        <h3>Categories</h3>
                      </div>
                      <div className="categories-list">
                        <button
                          className={`category-item ${
                            !selectedCategory ? "active" : ""
                          }`}
                          onClick={() => setSelectedCategory(null)}
                        >
                          <span className="category-name">All Channels</span>
                          <span className="category-count">
                            {channels.length}
                          </span>
                        </button>
                        {categories.map((cat) => (
                          <button
                            key={cat.name}
                            data-category-name={cat.name}
                            className={`category-item ${
                              selectedCategory === cat.name ? "active" : ""
                            } ${
                              dragOverCategory === cat.name ? "drag-over" : ""
                            }`}
                            onClick={() => setSelectedCategory(cat.name)}
                            draggable
                            onDragStart={() =>
                              handleCategoryDragStart(cat.name)
                            }
                            onDragOver={(e) =>
                              handleCategoryDragOver(e, cat.name)
                            }
                            onDragLeave={handleCategoryDragLeave}
                            onDragEnd={handleCategoryDragEnd}
                            onDrop={() => handleCategoryDrop(cat.name)}
                          >
                            <span className="category-drag-handle">⋮⋮</span>
                            {editingCategoryName === cat.name ? (
                              <div
                                className="category-edit-container"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="text"
                                  value={newCategoryName}
                                  onChange={(e) =>
                                    setNewCategoryName(e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      handleSaveCategoryName();
                                    } else if (e.key === "Escape") {
                                      handleCancelEditCategoryName();
                                    }
                                  }}
                                  className="category-name-input"
                                  autoFocus
                                />
                                <span
                                  className="btn-category-save"
                                  onClick={handleSaveCategoryName}
                                  title="Save"
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      handleSaveCategoryName();
                                    }
                                  }}
                                >
                                  ✓
                                </span>
                                <span
                                  className="btn-category-cancel"
                                  onClick={handleCancelEditCategoryName}
                                  title="Cancel"
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      handleCancelEditCategoryName();
                                    }
                                  }}
                                >
                                  ✕
                                </span>
                              </div>
                            ) : (
                              <>
                                <span className="category-name">
                                  {cat.name}
                                </span>
                                <span
                                  className="btn-category-edit"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEditCategoryName(cat.name);
                                  }}
                                  title="Edit category name"
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.stopPropagation();
                                      handleEditCategoryName(cat.name);
                                    }
                                  }}
                                >
                                  ✏️
                                </span>
                              </>
                            )}
                            <span className="category-count">
                              {
                                channels.filter((ch) => ch.extGrp === cat.name)
                                  .length
                              }
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="channels-panel">
                      <div className="panel-header">
                        <h3>
                          {selectedCategory || "All Channels"}
                          <span className="channel-count-badge">
                            {getFilteredChannels().length}
                            {channelSearchTerm &&
                              ` of ${
                                selectedCategory
                                  ? channels.filter(
                                      (ch) => ch.extGrp === selectedCategory
                                    ).length
                                  : channels.length
                              }`}
                          </span>
                        </h3>
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={handleAddChannel}
                        >
                          + Add Channel
                        </button>
                          {(epgFiles.length > 0 || epgGroups.length > 0) && (
                            <select
                              className="epg-selector"
                              value={
                                selectedEpgType === "file"
                                  ? `file-${selectedEpgId}`
                                  : `group-${selectedEpgId}`
                              }
                              onChange={(e) => {
                                const value = e.target.value;
                                if (value.startsWith("file-")) {
                                  const id = parseInt(
                                    value.replace("file-", "")
                                  );
                                  setSelectedEpgId(id);
                                  setSelectedEpgType("file");
                                } else if (value.startsWith("group-")) {
                                  const id = parseInt(
                                    value.replace("group-", "")
                                  );
                                  setSelectedEpgId(id);
                                  setSelectedEpgType("group");
                                }
                                // loadData will be called automatically via useEffect
                              }}
                              style={{
                                padding: "0.5rem 1rem",
                                borderRadius: "6px",
                                border: "1px solid var(--border-color)",
                                backgroundColor: "var(--bg-secondary)",
                                color: "var(--text-primary)",
                                cursor: "pointer",
                              }}
                            >
                              {epgFiles.length > 0 && (
                                <optgroup label="EPG Files">
                                  {epgFiles.map((epgFile) => (
                                    <option
                                      key={`file-${epgFile.id}`}
                                      value={`file-${epgFile.id}`}
                                    >
                                      {epgFile.isDefault ? "⭐ " : ""}
                                      {epgFile.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              {epgGroups.length > 0 && (
                                <optgroup label="EPG Groups">
                                  {epgGroups.map((epgGroup) => (
                                    <option
                                      key={`group-${epgGroup.id}`}
                                      value={`group-${epgGroup.id}`}
                                    >
                                      {epgGroup.isDefault ? "⭐ " : ""}
                                      🗂️ {epgGroup.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          )}
                          {renderChannelActions()}
                        </div>
                      </div>

                      {/* Channel Search Box */}
                      <div className="channel-search-box">
                        <input
                          type="text"
                          className="search-input"
                          placeholder="🔍 Search channels by name or ID..."
                          value={channelSearchTerm}
                          onChange={(e) => setChannelSearchTerm(e.target.value)}
                        />
                        {channelSearchTerm && (
                          <button
                            type="button"
                            className="clear-search"
                            onClick={() => setChannelSearchTerm("")}
                            title="Clear search"
                          >
                            ×
                          </button>
                        )}
                      </div>

                      {showAddForm && (
                        <div className="channel-form">
                          <h4>
                            {editingChannel
                              ? "Edit Channel"
                              : "Add New Channel"}
                          </h4>
                          <form onSubmit={handleSubmit}>
                            <div className="form-group">
                              <label htmlFor="channel-name">
                                Channel Name *
                              </label>
                              <input
                                type="text"
                                id="channel-name"
                                value={formData.name}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    name: e.target.value,
                                  })
                                }
                                placeholder="e.g., IL: Animal Planet HD"
                                required
                              />
                            </div>

                            <div className="form-group">
                              <label htmlFor="channel-logo">Logo URL</label>
                              <input
                                type="text"
                                id="channel-logo"
                                value={formData.tvgLogo}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    tvgLogo: e.target.value,
                                  })
                                }
                                placeholder="https://example.com/logo.png"
                              />
                            </div>

                            <div className="form-group">
                              <label htmlFor="channel-tvgid">TVG ID</label>
                              <input
                                type="text"
                                id="channel-tvgid"
                                value={formData.tvgId}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    tvgId: e.target.value,
                                  })
                                }
                                placeholder="e.g., animal-planet-YES"
                              />
                            </div>

                            <div className="form-group">
                              <label htmlFor="channel-category">
                                Category (extGrp)
                              </label>
                              <input
                                type="text"
                                id="channel-category"
                                value={formData.extGrp}
                                onChange={(e) =>
                                  setFormData({
                                    ...formData,
                                    extGrp: e.target.value,
                                  })
                                }
                                placeholder="e.g., 🌵 טבע והיסטוריה"
                                list="categories-datalist"
                              />
                              <datalist id="categories-datalist">
                                {categories.map((cat) => (
                                  <option key={cat.name} value={cat.name} />
                                ))}
                              </datalist>
                            </div>

                            <div className="form-actions">
                              <button type="submit" className="btn btn-primary">
                                {editingChannel ? "Update" : "Add"} Channel
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={() => {
                                  setShowAddForm(false);
                                  setEditingChannel(null);
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        </div>
                      )}

                      <div className="channels-list">
                        {getFilteredChannels().length === 0 ? (
                          <div className="empty-channels">
                            {channels.length === 0 ? (
                              <>
                                <div
                                  className="empty-icon"
                                  style={{
                                    fontSize: "3em",
                                    marginBottom: "1rem",
                                  }}
                                >
                                  📺
                                </div>
                                <h3>No Channel Lineup Yet</h3>
                                <p>
                                  Your channel lineup is empty. You can add
                                  channels manually or import them from an
                                  EPG/XMLTV file.
                                </p>
                                <p
                                  className="empty-hint"
                                  style={{
                                    marginTop: "1rem",
                                    fontSize: "0.9em",
                                    opacity: 0.8,
                                  }}
                                >
                                  💡 <strong>Tip:</strong> Use the "Import EPG
                                  File" button above to bulk import channels, or
                                  click "Add Channel" to create individual
                                  entries.
                                </p>
                              </>
                            ) : (
                              <>
                            <p>No channels in this category.</p>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={handleAddChannel}
                            >
                                  Add Channel to Category
                            </button>
                              </>
                            )}
                          </div>
                        ) : (
                          getFilteredChannels().map((channel) => (
                            <div
                              key={channel.id}
                              data-channel-id={channel.id}
                              className={`channel-item ${
                                dragOverChannel === channel.id
                                  ? "drag-over"
                                  : ""
                              }`}
                              draggable
                              onDragStart={() => handleDragStart(channel)}
                              onDragOver={(e) => handleDragOver(e, channel)}
                              onDragLeave={handleDragLeave}
                              onDragEnd={handleDragEnd}
                              onDrop={() => handleDrop(channel)}
                            >
                              <div className="channel-drag-handle">⋮⋮</div>
                              {channel.tvgLogo && (
                                <img
                                  src={channel.tvgLogo}
                                  alt={channel.name}
                                  className="channel-logo"
                                />
                              )}
                              <div className="channel-name">{channel.name}</div>
                              <div className="channel-actions">
                                <button
                                  className="btn-icon"
                                  onClick={() => handleEditChannel(channel)}
                                  title="Edit"
                                >
                                  ✏️
                                </button>
                                <button
                                  className="btn-icon btn-danger"
                                  onClick={() => handleDelete(channel.id)}
                                  title="Delete"
                                >
                                  🗑️
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "epg" && (
            <div className="tab-content playlists-management">
              {showAddEpgForm ? (
                <div
                  className="epg-import-form"
                  style={{ marginBottom: "2rem" }}
                >
                  <form onSubmit={handleAddEpgFile}>
                    <h3 style={{ marginBottom: "1.5rem" }}>Add EPG File</h3>
                    <div className="form-group">
                      <label htmlFor="epgName">EPG Name *</label>
                      <input
                        type="text"
                        id="epgName"
                        value={newEpgName}
                        onChange={(e) => setNewEpgName(e.target.value)}
                        placeholder="e.g., Main EPG, Sports EPG"
                        required
                        disabled={epgLoading}
                      />
                      <small className="form-help">
                        Give this EPG file a memorable name to easily
                        distinguish between multiple EPG sources.
                      </small>
                    </div>
                    <div className="form-group">
                      <label htmlFor="epgFileUrl">EPG File URL *</label>
                      <input
                        type="url"
                        id="epgFileUrl"
                        value={newEpgUrl}
                        onChange={(e) => setNewEpgUrl(e.target.value)}
                        placeholder="https://example.com/epg.xml or https://example.com/epg.xml.gz"
                        required
                        disabled={epgLoading}
                      />
                      <small className="form-help">
                        Enter the URL to your XMLTV/EPG file. Gzipped (.gz)
                        files are supported.
                      </small>
                    </div>
                    <div className="form-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          setShowAddEpgForm(false);
                          setNewEpgName("");
                          setNewEpgUrl("");
                        }}
                        disabled={epgLoading}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={epgLoading || !newEpgName || !newEpgUrl}
                      >
                        {epgLoading ? "Importing..." : "Import EPG"}
                      </button>
                    </div>
                  </form>
                </div>
              ) : epgLoading ? (
                <div className="loading-state">Loading...</div>
              ) : epgFiles.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">📺</div>
                  <h3>No EPG Files Yet</h3>
                  <p>
                    You haven't added any EPG (Electronic Program Guide) files
                    yet. EPG files provide channel information for your IPTV
                    channels.
                  </p>
                  <p className="empty-hint">
                    To get started, click the <strong>"+ Add EPG File"</strong>{" "}
                    button below to import your first XMLTV/EPG file.
                  </p>
                  <button
                    className="btn btn-primary"
                    onClick={() => setShowAddEpgForm(true)}
                    style={{ marginTop: "1rem" }}
                  >
                    + Add EPG File
                  </button>
                </div>
              ) : (
                <>
                  <div
                    className="playlists-header"
                    style={{
                      marginBottom: "1.5rem",
                      display: "flex",
                      gap: "1rem",
                    }}
                  >
                    <button
                      className="btn btn-primary"
                      onClick={() => setShowAddEpgForm(true)}
                    >
                      + Add EPG File
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() => setShowAddGroupForm(true)}
                      disabled={
                        epgFiles.filter((f) => !f.epgGroupId).length === 0
                      }
                      title={
                        epgFiles.filter((f) => !f.epgGroupId).length === 0
                          ? "Add EPG files first"
                          : "Create EPG group from multiple files"
                      }
                    >
                      + Add EPG Group
                    </button>
                  </div>


                  {showAddGroupForm && (
                    <div
                      className="epg-import-form"
                      style={{ marginBottom: "2rem" }}
                    >
                      <form onSubmit={handleAddEpgGroup}>
                        <h3 style={{ marginBottom: "1.5rem" }}>
                          Create EPG Group
                        </h3>
                        <div className="form-group">
                          <label htmlFor="groupName">Group Name *</label>
                          <input
                            type="text"
                            id="groupName"
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                            placeholder="e.g., Combined EPG, Regional Sources"
                            required
                            disabled={epgLoading}
                          />
                          <small className="form-help">
                            Give this group a memorable name.
                          </small>
                        </div>
                        <div className="form-group">
                          <label htmlFor="groupUrl">
                            Merged EPG File URL *
                          </label>
                          <input
                            type="url"
                            id="groupUrl"
                            value={newGroupUrl}
                            onChange={(e) => setNewGroupUrl(e.target.value)}
                            placeholder="https://example.com/merged-epg.xml or https://example.com/merged-epg.xml.gz"
                            required
                            disabled={epgLoading}
                          />
                          <small className="form-help">
                            URL to your combined/merged EPG file that includes
                            data from the selected sources below.
                          </small>
                        </div>
                        <div className="form-group">
                          <label>Select EPG Files to Include *</label>
                          <div
                            style={{
                              marginTop: "0.5rem",
                              display: "flex",
                              flexDirection: "column",
                              gap: "0.25rem",
                              maxHeight: "200px",
                              overflowY: "auto",
                              padding: "0.5rem",
                              border: "1px solid var(--border-color)",
                              borderRadius: "4px",
                            }}
                          >
                            {epgFiles
                              .filter((f) => !f.epgGroupId)
                              .map((epgFile) => (
                                <label
                                  key={epgFile.id}
                                  className="epg-file-checkbox-item"
                                  style={{
                                    backgroundColor:
                                      selectedGroupEpgFileIds.includes(
                                        epgFile.id!
                                      )
                                        ? "var(--primary-color-alpha)"
                                        : "transparent",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedGroupEpgFileIds.includes(
                                      epgFile.id!
                                    )}
                                    onChange={() =>
                                      toggleGroupEpgFile(epgFile.id!, true)
                                    }
                                    disabled={epgLoading}
                                  />
                                  <div className="epg-file-checkbox-label">
                                    <span className="epg-file-checkbox-name">
                                      {epgFile.name}
                                    </span>
                                    <span className="epg-file-checkbox-count">
                                      ({epgFile.channelCount} channels)
                                    </span>
                                  </div>
                                </label>
                              ))}
                          </div>
                          <small className="form-help">
                            Select at least one EPG file to include in this
                            group.
                          </small>
                        </div>
                        <div className="form-actions">
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                              setShowAddGroupForm(false);
                              setNewGroupName("");
                              setNewGroupUrl("");
                              setSelectedGroupEpgFileIds([]);
                            }}
                            disabled={epgLoading}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={
                              epgLoading ||
                              !newGroupName ||
                              !newGroupUrl ||
                              selectedGroupEpgFileIds.length === 0
                            }
                          >
                            {epgLoading ? "Creating..." : "Create Group"}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}

                  <div
                    className="playlists-list"
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fill, minmax(450px, 1fr))",
                      gap: "1rem",
                    }}
                  >
                    {epgFiles.map((epgFile) => (
                      <div
                        key={epgFile.id}
                        data-epg-id={epgFile.id}
                        className="playlist-drag-item"
                      >
                        <button
                          className="btn-icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetDefaultEpg(epgFile);
                          }}
                          title={
                            epgFile.isDefault
                              ? "This is the default EPG"
                              : "Set as default EPG"
                          }
                          style={{
                            fontSize: "1.2rem",
                            cursor: epgFile.isDefault ? "default" : "pointer",
                            opacity: epgFile.isDefault ? 1 : 0.4,
                          }}
                        >
                          {epgFile.isDefault ? "⭐" : "☆"}
                        </button>
                        <div className="playlist-info" style={{ flex: 1 }}>
                          <div className="playlist-header-row">
                            <div className="playlist-name">{epgFile.name}</div>
                            <div style={{ display: "flex", gap: "0.25rem" }}>
                              <button
                                className="btn-icon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSyncEpgFile(epgFile.id!);
                                }}
                                title="Sync/Refresh EPG"
                                disabled={syncingEpgId === epgFile.id}
                              >
                                {syncingEpgId === epgFile.id ? "⏳" : "🔄"}
                              </button>
                              <button
                                className="btn-icon btn-edit"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditEpgFile(epgFile);
                                }}
                                title="Edit EPG file"
                              >
                                ✏️
                              </button>
                              <button
                                className="btn-icon btn-delete"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteEpgFile(epgFile.id!);
                                }}
                                title="Delete EPG file"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                          <div className="playlist-details-grid">
                            <div className="playlist-detail-item">
                              <span className="detail-label">Channels:</span>
                              <span className="detail-value">
                                {epgFile.channelCount}
                              </span>
                            </div>
                            <div className="playlist-detail-item">
                              <span className="detail-label">Last Synced:</span>
                              <span
                                className="detail-value"
                                style={{ fontSize: "0.85em" }}
                              >
                                {formatLastSynced(epgFile.lastSyncedAt)}
                              </span>
                            </div>
                            <div
                              className="playlist-detail-item"
                              style={{ gridColumn: "span 2" }}
                            >
                              <span className="detail-label">Source:</span>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "0.5rem",
                                  flex: 1,
                                  minWidth: 0,
                                }}
                              >
                                <span
                                  className="detail-value"
                                  style={{
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                    flex: 1,
                                    minWidth: 0,
                                  }}
                                >
                                  {epgFile.url}
                                </span>
                                <button
                                  className="btn-icon"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopyEpgUrl(epgFile.url);
                                  }}
                                  title="Copy EPG URL"
                                  style={{ flexShrink: 0 }}
                                >
                                  📋
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {epgGroups.length > 0 && (
                    <>
                      <h3 style={{ marginTop: "2rem", marginBottom: "1rem" }}>
                        EPG Groups
                      </h3>
                      <div
                        className="playlists-list"
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fill, minmax(450px, 1fr))",
                          gap: "1rem",
                        }}
                      >
                        {epgGroups.map((epgGroup) => (
                          <div
                            key={epgGroup.id}
                            className="playlist-drag-item"
                            style={{
                              borderLeft: "3px solid var(--primary-color)",
                            }}
                          >
                            <button
                              className="btn-icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSetDefaultEpgGroup(epgGroup);
                              }}
                              title={
                                epgGroup.isDefault
                                  ? "This is the default EPG"
                                  : "Set as default EPG"
                              }
                              style={{
                                fontSize: "1.2rem",
                                cursor: epgGroup.isDefault
                                  ? "default"
                                  : "pointer",
                                opacity: epgGroup.isDefault ? 1 : 0.4,
                              }}
                            >
                              {epgGroup.isDefault ? "⭐" : "☆"}
                            </button>
                            <div className="playlist-info" style={{ flex: 1 }}>
                              <div className="playlist-header-row">
                                <div className="playlist-name">
                                  🗂️ {epgGroup.name}
                                </div>
                                <div
                                  style={{ display: "flex", gap: "0.25rem" }}
                                >
                                  <button
                                    className="btn-icon btn-edit"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleEditEpgGroup(epgGroup);
                                    }}
                                    title="Edit EPG group"
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    className="btn-icon btn-delete"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteEpgGroup(epgGroup.id!);
                                    }}
                                    title="Delete EPG group"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </div>
                              <div className="playlist-details-grid">
                                <div className="playlist-detail-item">
                                  <span className="detail-label">
                                    Total Channels:
                                  </span>
                                  <span className="detail-value">
                                    {epgGroup.totalChannelCount || 0}
                                  </span>
                                </div>
                                <div className="playlist-detail-item">
                                  <span className="detail-label">
                                    EPG Files:
                                  </span>
                                  <span className="detail-value">
                                    {epgGroup.epgFileIds?.length || 0}
                                  </span>
                                </div>
                                <div
                                  className="playlist-detail-item"
                                  style={{ gridColumn: "span 2" }}
                                >
                                  <span className="detail-label">Source:</span>
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "0.5rem",
                                      flex: 1,
                                      minWidth: 0,
                                    }}
                                  >
                                    <span
                                      className="detail-value"
                                      style={{
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        flex: 1,
                                        minWidth: 0,
                                      }}
                                    >
                                      {epgGroup.url}
                                    </span>
                                    <button
                                      className="btn-icon"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleCopyEpgUrl(epgGroup.url);
                                      }}
                                      title="Copy EPG URL"
                                      style={{ flexShrink: 0 }}
                                    >
                                      📋
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === "schedule" && (
            <div className="tab-content">
              <div className="settings-section">
                <h3>Schedule Playlist Sync</h3>
                <p className="setting-description">
                  Enable daily auto-sync per playlist. Jobs run sequentially (lowest
                  playlist ID first) and will skip UI popups while running on a
                  schedule.
                </p>
                <div className="schedule-list">
                  {schedule.map((item) => {
                    const pl = playlists.find((p) => p.id === item.playlistId);
                    return (
                      <div key={item.playlistId} className="schedule-row">
                        <div className="schedule-name">
                          {pl?.name || `Playlist ${item.playlistId}`}
                        </div>
                        <label className="schedule-toggle">
                          <input
                            type="checkbox"
                            checked={item.enabled}
                            onChange={(e) =>
                              updateScheduleItem(item.playlistId, {
                                enabled: e.target.checked,
                              })
                            }
                          />
                          <span>Enable</span>
                        </label>
                        <input
                          type="time"
                          value={item.time || "02:00"}
                          onChange={(e) =>
                            updateScheduleItem(item.playlistId, {
                              time: e.target.value,
                            })
                          }
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="schedule-actions">
                  <button
                    className="btn btn-primary"
                    onClick={handleSaveSchedule}
                    disabled={savingSchedule}
                  >
                    {savingSchedule ? "Saving..." : "Save Schedule"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "users" && isAdmin && (
            <div className="tab-content">
              <div className="settings-section">
                <h3>Security Settings</h3>
                <div className="setting-item">
                  <label className="setting-label">
                    <input
                      type="checkbox"
                      checked={bypass2FA}
                      onChange={(e) => handleSaveBypass2FA(e.target.checked)}
                      disabled={savingSettings}
                    />
                    <span className="setting-text">
                      Bypass 2FA for Testing (Admin Only)
                    </span>
                  </label>
                  <p className="setting-description">
                    2FA is mandatory for all users. When this bypass is enabled,
                    admin users can login without 2FA for automated testing
                    purposes.
                    <strong>
                      {" "}
                      🔒 This ONLY works for admin users when running locally
                      (NODE_ENV !== "production").
                    </strong>{" "}
                    Member users will always require 2FA regardless of this
                    setting. The bypass is automatically disabled in
                    cloud/production environments for security.
                  </p>
                </div>
              </div>

              <div className="settings-section">
                <div className="section-header-with-button">
                  <h3>User Management</h3>
                  <button
                    className="btn btn-primary"
                    onClick={() => setShowAddUserForm(!showAddUserForm)}
                  >
                    {showAddUserForm ? "Cancel" : "+ Add User"}
                  </button>
                </div>

                {showAddUserForm && (
                  <div className="add-user-form">
                    <form onSubmit={handleAddUser}>
                      <div className="form-row">
                        <div className="form-group">
                          <label htmlFor="newUserEmail">Email</label>
                          <input
                            type="email"
                            id="newUserEmail"
                            value={newUserEmail}
                            onChange={(e) => setNewUserEmail(e.target.value)}
                            placeholder="user@example.com"
                            required
                          />
                        </div>
                        <div className="form-group">
                          <label htmlFor="newUserPassword">Password</label>
                          <input
                            type="password"
                            id="newUserPassword"
                            value={newUserPassword}
                            onChange={(e) => setNewUserPassword(e.target.value)}
                            placeholder="Min 8 characters"
                            required
                            minLength={8}
                          />
                        </div>
                        <div className="form-group">
                          <label htmlFor="newUserRole">Role</label>
                          <select
                            id="newUserRole"
                            value={newUserRole}
                            onChange={(e) => setNewUserRole(e.target.value)}
                            className="user-role-select"
                          >
                            <option value={UserRole.MEMBER}>Member</option>
                            <option value={UserRole.ADMIN}>Admin</option>
                          </select>
                        </div>
                        <div className="form-group form-group-button">
                          <button type="submit" className="btn btn-primary">
                            Create User
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                )}

                {loading ? (
                  <div className="loading-state">Loading users...</div>
                ) : (
                  <div className="users-list">
                    {users.map((u) => (
                      <div key={u.id} className="user-item">
                        <div className="user-avatar-small">
                          {u.email.charAt(0).toUpperCase()}
                        </div>
                        <div className="user-details">
                          <div className="user-email-text">{u.email}</div>
                          <div className="user-meta">
                            <span
                              className={`user-role-badge ${
                                u.role === UserRole.ADMIN ? "admin" : "member"
                              }`}
                            >
                              {u.role}
                            </span>
                            {u.twoFactorEnabled && (
                              <span className="user-2fa-badge">🔐 2FA</span>
                            )}
                          </div>
                        </div>
                        <div className="user-actions">
                          {u.id !== user.id && (
                            <>
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() =>
                                  handleOpenRoleChangeModal(u.id, u.role)
                                }
                                title="Change user role"
                              >
                                Role
                              </button>

                              <button
                                className="btn btn-sm btn-secondary"
                                onClick={() => handleResetUser2FA(u.id)}
                                title="Reset 2FA - User will be prompted to set up 2FA on next login"
                              >
                                Reset 2FA
                              </button>

                              <button
                                className="btn btn-sm btn-danger"
                                onClick={() => handleDeleteUser(u.id)}
                                title="Delete user"
                              >
                                🗑️ Delete
                              </button>
                            </>
                          )}
                          {u.id === user.id && (
                            <span className="user-current-badge">You</span>
                          )}
                        </div>
                      </div>
                    ))}

                    {users.length === 0 && (
                      <div className="empty-state">No users found</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Edit EPG Modal */}
      {showEditEpgModal && (
        <div
          className="modal-overlay"
          onClick={() => !epgLoading && setShowEditEpgModal(false)}
        >
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "500px" }}
          >
            <div className="modal-header">
              <h2>Edit EPG File</h2>
              <button
                className="btn-close"
                onClick={() => setShowEditEpgModal(false)}
                disabled={epgLoading}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="edit-epg-name">EPG Name *</label>
                <input
                  type="text"
                  id="edit-epg-name"
                  value={editEpgName}
                  onChange={(e) => setEditEpgName(e.target.value)}
                  placeholder="e.g., Main EPG, Sports EPG"
                  required
                  disabled={epgLoading}
                />
              </div>
              <div className="form-group">
                <label htmlFor="edit-epg-url">EPG File URL *</label>
                <input
                  type="url"
                  id="edit-epg-url"
                  value={editEpgUrl}
                  onChange={(e) => setEditEpgUrl(e.target.value)}
                  placeholder="https://example.com/epg.xml"
                  required
                  disabled={epgLoading}
                />
                <small className="form-help">
                  If you change the URL, the EPG will be automatically synced to
                  update channels.
                </small>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowEditEpgModal(false)}
                disabled={epgLoading}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveEditEpg}
                disabled={epgLoading || !editEpgName || !editEpgUrl}
              >
                {epgLoading ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditGroupModal && (
        <div
          className="modal-overlay"
          onClick={() => !epgLoading && setShowEditGroupModal(false)}
        >
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "500px" }}
          >
            <div className="modal-header">
              <h2>Edit EPG Group</h2>
              <button
                className="btn-close"
                onClick={() => setShowEditGroupModal(false)}
                disabled={epgLoading}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="edit-group-name">Group Name *</label>
                <input
                  type="text"
                  id="edit-group-name"
                  value={editGroupName}
                  onChange={(e) => setEditGroupName(e.target.value)}
                  placeholder="e.g., Combined EPG, Regional Sources"
                  required
                  disabled={epgLoading}
                />
              </div>
              <div className="form-group">
                <label htmlFor="edit-group-url">Merged EPG File URL *</label>
                <input
                  type="url"
                  id="edit-group-url"
                  value={editGroupUrl}
                  onChange={(e) => setEditGroupUrl(e.target.value)}
                  placeholder="https://example.com/merged-epg.xml"
                  required
                  disabled={epgLoading}
                />
              </div>
              <div className="form-group">
                <label>Select EPG Files to Include *</label>
                <div
                  style={{
                    marginTop: "0.5rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                    maxHeight: "200px",
                    overflowY: "auto",
                    padding: "0.5rem",
                    border: "1px solid var(--border-color)",
                    borderRadius: "4px",
                  }}
                >
                  {epgFiles
                    .filter(
                      (f) =>
                        !f.epgGroupId || f.epgGroupId === editingEpgGroup?.id
                    )
                    .map((epgFile) => (
                      <label
                        key={epgFile.id}
                        className="epg-file-checkbox-item"
                        style={{
                          backgroundColor: editGroupEpgFileIds.includes(
                            epgFile.id!
                          )
                            ? "var(--primary-color-alpha)"
                            : "transparent",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={editGroupEpgFileIds.includes(epgFile.id!)}
                          onChange={() =>
                            toggleGroupEpgFile(epgFile.id!, false)
                          }
                          disabled={epgLoading}
                        />
                        <div className="epg-file-checkbox-label">
                          <span className="epg-file-checkbox-name">
                            {epgFile.name}
                          </span>
                          <span className="epg-file-checkbox-count">
                            ({epgFile.channelCount} channels)
                          </span>
                        </div>
                      </label>
                    ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowEditGroupModal(false)}
                disabled={epgLoading}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveEditGroup}
                disabled={
                  epgLoading ||
                  !editGroupName ||
                  !editGroupUrl ||
                  editGroupEpgFileIds.length === 0
                }
              >
                {epgLoading ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {importProgress && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: "500px" }}>
            <div className="modal-header">
              <h2>📥 Importing EPG: {importProgress.name}</h2>
            </div>
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {(() => {
                const status = importProgress.status;
                const msg = importProgress.message?.trim();
                const showMsg = msg && !msg.toLowerCase().startsWith("status:");
                return (
                  <>
                    <div
                      style={{
                        fontSize: "0.95rem",
                        color: "var(--text-secondary)",
                        marginBottom: showMsg ? "0.25rem" : "0.5rem",
                        fontWeight: 600,
                      }}
                    >
                      Status: {status}
                    </div>
                    {showMsg && (
                      <div
                        style={{
                          fontSize: "0.9rem",
                          color: "var(--text-secondary)",
                          marginBottom: "0.75rem",
                        }}
                      >
                        {msg}
                      </div>
                    )}
                  </>
                );
              })()}

              <div className="loader-container">
                <div
                  className={`loader-bar ${
                    importProgress.status === "failed" ? "loader-error" : ""
                  }`}
                >
                  <div className="loader-pulse" />
                </div>
                <div className="loader-hint">
                  Working... this can take a few minutes. Do not close this window.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Role Change Modal */}
      {showRoleChangeModal && (
        <div className="modal-overlay" onClick={handleCancelRoleChange}>
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "400px" }}
          >
            <div className="modal-header">
              <h2>Change User Role</h2>
            </div>
            <div className="modal-body">
              <p
                style={{
                  marginBottom: "1.5rem",
                  color: "var(--text-secondary)",
                }}
              >
                Select the new role for this user:
              </p>
              <div className="role-radio-group">
                <label className="role-radio-option">
                  <input
                    type="radio"
                    name="role"
                    value={UserRole.ADMIN}
                    checked={roleChangeNewRole === UserRole.ADMIN}
                    onChange={(e) => setRoleChangeNewRole(e.target.value)}
                  />
                  <div className="role-radio-label">
                    <span className="role-radio-title">Admin</span>
                    <span className="role-radio-description">
                      Full access to all features and settings
                    </span>
                  </div>
                </label>
                <label className="role-radio-option">
                  <input
                    type="radio"
                    name="role"
                    value={UserRole.MEMBER}
                    checked={roleChangeNewRole === UserRole.MEMBER}
                    onChange={(e) => setRoleChangeNewRole(e.target.value)}
                  />
                  <div className="role-radio-label">
                    <span className="role-radio-title">Member</span>
                    <span className="role-radio-description">
                      Can manage playlists and channels
                    </span>
                  </div>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={handleCancelRoleChange}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleConfirmRoleChange}
              >
                Change Role
              </button>
            </div>
          </div>
        </div>
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

export default AdminModal;
