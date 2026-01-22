import { useState, useEffect, useRef } from "react";
import { Playlist, Channel, Category } from "../types";
import { api } from "../api";
import ChannelList from "./ChannelList";
import ChannelMappingModal from "./ChannelMappingModal";
import ConfirmModal from "./ConfirmModal";
import PlaylistSelectionModal from "./PlaylistSelectionModal";
import "./PlaylistViewer.css";

interface Props {
  playlist: Playlist;
  onSync: () => void;
  onEditPlaylist: (tab: string) => void;
}

function PlaylistViewer({ playlist, onSync, onEditPlaylist }: Props) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [cooldownMessage, setCooldownMessage] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<{
    addedChannels: Array<{ name: string; streamId: string }>;
    removedChannels: Array<{ name: string; streamId: string }>;
    addedCount: number;
    removedCount: number;
  } | null>(null);

  // Import progress state
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [operationalFilter, setOperationalFilter] = useState<
    "all" | "on" | "off"
  >("all");
  const [archiveFilter, setArchiveFilter] = useState<"all" | "on" | "off">(
    "all"
  );
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showPlaylistSelectionModal, setShowPlaylistSelectionModal] =
    useState(false);
  const [allPlaylists, setAllPlaylists] = useState<Playlist[]>([]);
  const [mappingChannel, setMappingChannel] = useState<Channel | null>(null);
  const [mappingFilter, setMappingFilter] = useState<
    "all" | "mapped" | "unmapped"
  >("all");
  const [currentTime, setCurrentTime] = useState(new Date());
  const [confirmModal, setConfirmModal] = useState<{
    message: string;
    onConfirm?: () => void;
    title?: string;
    confirmText?: string;
    cancelText?: string;
    confirmVariant?: "danger" | "primary" | "warning" | "success";
  } | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalChannels, setTotalChannels] = useState(0);
  const CHANNELS_PER_PAGE = 500;

  // Category selection for Xtream sync
  const [showCategorySyncModal, setShowCategorySyncModal] = useState(false);
  const [categorySyncSelection, setCategorySyncSelection] = useState<
    Set<string>
  >(new Set());

  // Local playlist state that gets updated during sync
  // Used to display correct counts immediately after sync
  const [localPlaylist, setLocalPlaylist] = useState<Playlist>(playlist);

  const COOLDOWN_DURATION = 3 * 60 * 1000; // 3 minutes in milliseconds

  // Ref to prevent redundant reloads immediately after sync completes
  // When sync finishes, we've already loaded all data, so we don't want
  // the parent's onSync() call to trigger useEffect hooks that reload again
  const justSyncedRef = useRef(false);

  // Ref to track last sync progress to prevent progress bar from going backwards
  const lastProgressRef = useRef(0);

  // Sync local playlist with prop when it changes (except during/after sync)
  useEffect(() => {
    if (!syncing && !justSyncedRef.current) {
      setLocalPlaylist(playlist);
    }
  }, [playlist, syncing]);

  // When a new playlist is selected, default to "All Categories"
  useEffect(() => {
    if (!justSyncedRef.current) {
      setSelectedCategory(null);
    }
  }, [playlist.id]);

  // Update current time every 30 seconds to refresh "last synced" display
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, []);

  // Debug: Verify file input exists in DOM
  useEffect(() => {
    console.log(
      "🔍 PlaylistViewer mounted/updated for playlist:",
      playlist.name
    );
    const input = document.getElementById("import-file-input");
    console.log("📂 File input in DOM:", input ? "✅ YES" : "❌ NO");
    if (input) {
      console.log("📂 File input properties:", {
        id: input.id,
        type: (input as HTMLInputElement).type,
        accept: (input as HTMLInputElement).accept,
        hasOnChange: !!(input as any).onchange,
      });
    }
  });

  const formatLastSync = (lastSyncedAt?: string): string => {
    if (!lastSyncedAt) return "Never";

    // Parse the date - SQLite returns "YYYY-MM-DD HH:mm:ss" format
    // Replace space with 'T' for ISO format compatibility
    const isoDate = lastSyncedAt.replace(" ", "T");
    const date = new Date(isoDate);

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return "Invalid date";
    }

    const diffMs = currentTime.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    // For older dates, show the date
    return date.toLocaleDateString();
  };

  const buildSyncSummaryMessage = (summary: {
    addedChannels: Array<{ name: string }>;
    removedChannels: Array<{ name: string }>;
    addedCount: number;
    removedCount: number;
  }) => {
    const lines: string[] = [
      `Added: ${summary.addedCount}`,
      `Removed: ${summary.removedCount}`,
    ];

    if (summary.addedChannels.length > 0) {
      lines.push("", "Added channels:");
      summary.addedChannels.slice(0, 20).forEach((ch) => {
        lines.push(`+ ${ch.name}`);
      });
      if (summary.addedCount > 20) {
        lines.push(`... and ${summary.addedCount - 20} more`);
      }
    }

    if (summary.removedChannels.length > 0) {
      lines.push("", "Removed channels:");
      summary.removedChannels.slice(0, 20).forEach((ch) => {
        lines.push(`- ${ch.name}`);
      });
      if (summary.removedCount > 20) {
        lines.push(`... and ${summary.removedCount - 20} more`);
      }
    }

    return lines.join("\n");
  };

  const handleSyncSummaryOk = async () => {
    try {
      justSyncedRef.current = false;
      await loadData();
      await loadChannels(1);
      const freshPlaylist = await api.getPlaylist(playlist.id!);
      setLocalPlaylist(freshPlaylist);
      onSync();
    } catch (err) {
      console.error("Failed to refresh after sync summary:", err);
    }
  };

  // Get per-playlist sync cooldown key
  const getSyncCooldownKey = () => `sync_cooldown_${playlist.id}`;

  // Get last sync time for this specific playlist
  const getLastSyncTime = (): number | null => {
    const stored = localStorage.getItem(getSyncCooldownKey());
    return stored ? parseInt(stored, 10) : null;
  };

  // Set last sync time for this specific playlist
  const setLastSyncTime = (timestamp: number) => {
    localStorage.setItem(getSyncCooldownKey(), timestamp.toString());
  };

  useEffect(() => {
    // Skip reload if we just completed a sync (data is already fresh)
    if (justSyncedRef.current) {
      console.log("⏭️ Skipping loadData() - data just synced and loaded");
      return;
    }
    loadData();
  }, [playlist.id, playlist.hiddenCategories, playlist.excludedChannels]);

  useEffect(() => {
    // Skip reload if we just completed a sync (channels are already loaded)
    if (justSyncedRef.current) {
      console.log(
        "⏭️ Skipping loadChannels() - channels just synced and loaded"
      );
      return;
    }
    // Reset to page 1 when filters change
    setCurrentPage(1);
    loadChannels(1);
  }, [
    playlist.id,
    selectedCategory,
    searchTerm,
    playlist.hiddenCategories,
    playlist.excludedChannels,
    mappingFilter,
    operationalFilter,
    archiveFilter,
  ]);

  // Close export menu on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showExportMenu) {
        setShowExportMenu(false);
      }
      if (e.key === "Escape" && showImportMenu) {
        setShowImportMenu(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showExportMenu, showImportMenu]);

  // Load all playlists for import source selection
  useEffect(() => {
    const loadAllPlaylists = async () => {
      try {
        const playlists = await api.getPlaylists();
        setAllPlaylists(playlists);
      } catch (err: any) {
        console.error("Failed to load playlists:", err);
      }
    };
    loadAllPlaylists();
  }, []);

  const loadData = async () => {
    try {
      console.log("📂 Loading categories...");
      setError(null);

      // Only load categories initially (fast)
      // Channels will be loaded separately by loadChannels()
      // Note: We don't manage loading state here to avoid conflicts with loadChannels()
      const categoriesData = await api.getCategories(playlist.id!);

      // Apply allowlist (isSelected) and hidden categories automatically
      const hiddenCategoryIds = new Set(playlist.hiddenCategories || []);
      const selectedCategoryIds = categoriesData
        .filter((c) => Number(c.isSelected) === 1 || c.isSelected === true)
        .map((c) => c.categoryId);

      const filteredForSelection =
        selectedCategoryIds.length > 0
          ? categoriesData.filter((cat) =>
              selectedCategoryIds.includes(cat.categoryId)
            )
          : categoriesData;

      const visibleCategories = filteredForSelection.filter(
        (cat) => !hiddenCategoryIds.has(cat.categoryId)
      );

      setCategories(visibleCategories);
      // Preload selection state for Xtream category modal
      const initiallySelected =
        selectedCategoryIds.length > 0
          ? selectedCategoryIds
          : visibleCategories
              .filter((c) => !!c.isSelected)
              .map((c) => c.categoryId);
      setCategorySyncSelection(new Set(initiallySelected));
      console.log(
        `✅ Loaded ${visibleCategories.length} categories (${hiddenCategoryIds.size} hidden, ${selectedCategoryIds.length} selected)`
      );

      // Clear selected category if it's no longer visible
      const hasSelected =
        selectedCategory &&
        visibleCategories.some((c) => c.categoryId === selectedCategory);
      if (!hasSelected) {
        setSelectedCategory(null);
      }
    } catch (err: any) {
      console.error("❌ Failed to load categories:", err);
      setError(err.message || "Failed to load data");
    }
  };

  const loadChannels = async (page: number = 1) => {
    // Ensure loading indicator shows for at least 300ms (better UX)
    const minLoadTime = new Promise((resolve) => setTimeout(resolve, 300));

    try {
      console.log("=".repeat(80));
      console.log("📡 CHANNEL LOAD STARTED");
      console.log("=".repeat(80));
      console.log("Playlist Info:", {
        id: playlist.id,
        name: playlist.name,
        type: playlist.type,
        channelCount: playlist.channelCount,
        filteredChannelCount: playlist.filteredChannelCount,
        categoryCount: playlist.categoryCount,
      });
      console.log("Filter State:", {
        selectedCategory,
        searchTerm,
        hiddenCategories: playlist.hiddenCategories?.length ?? 0,
        excludedChannels: playlist.excludedChannels?.length ?? 0,
        includeUncategorized: playlist.includeUncategorizedChannels,
        page,
      });

      console.log("🔄 Setting loading to TRUE");
      setLoading(true);
      setError(null); // Clear any previous errors

      // Force a tiny delay to ensure React updates the DOM
      await new Promise((resolve) => setTimeout(resolve, 10));
      console.log(
        "✅ Loading state should now be TRUE, loading banner should be visible"
      );

      // Check if pagination is needed
      const totalCount = playlist.channelCount ?? 0;
      const filteredCount = playlist.filteredChannelCount ?? totalCount;
      const hasActiveFilters =
        (playlist.hiddenCategories && playlist.hiddenCategories.length > 0) ||
        (playlist.excludedChannels && playlist.excludedChannels.length > 0) ||
        filteredCount !== totalCount;

      // If filters are active, use filteredChannelCount instead of total
      const effectiveChannelCount = hasActiveFilters
        ? filteredCount
        : totalCount;

      console.log("📊 Channel Load Config:", {
        totalCount,
        filteredChannelCount: playlist.filteredChannelCount,
        effectiveChannelCount,
        hasActiveFilters,
        selectedCategory: selectedCategory || "NONE",
        searchTerm: searchTerm || "NONE",
        requestedPage: page,
      });

      // Calculate if pagination is needed (>500 channels to display)
      const needsPagination = effectiveChannelCount > CHANNELS_PER_PAGE;

      if (needsPagination) {
        console.log(
          `📄 Pagination enabled: ${effectiveChannelCount} channels, ${CHANNELS_PER_PAGE} per page`
        );
        setTotalChannels(effectiveChannelCount);
        setTotalPages(Math.ceil(effectiveChannelCount / CHANNELS_PER_PAGE));
        setCurrentPage(page);
      } else {
        setTotalChannels(effectiveChannelCount);
        setTotalPages(1);
        setCurrentPage(1);
      }

      console.log("🔄 Fetching channels from API...");
      console.log("API Request:", {
        playlistId: playlist.id,
        category: selectedCategory || "ALL",
        search: searchTerm || "NONE",
      });

      const channelsData = await api.getChannels(
        playlist.id!,
        selectedCategory || undefined,
        searchTerm || undefined
      );

      console.log(
        `✅ API Response: Received ${
          Array.isArray(channelsData) ? channelsData.length : 0
        } channels`
      );
      if (Array.isArray(channelsData) && channelsData.length > 0) {
        console.log(
          "Sample channels (first 3):",
          channelsData.slice(0, 3).map((ch) => ({
            name: ch.name,
            streamId: ch.streamId,
            categoryId: ch.categoryId,
            categoryName: ch.categoryName,
            hasMappng: !!ch.channelMapping,
          }))
        );
      } else {
        console.warn(
          "⚠️ No channels received or invalid data format:",
          channelsData
        );
      }

      const hiddenCategoryIds = new Set(playlist.hiddenCategories || []);
      const excludedChannelIds = new Set(playlist.excludedChannels || []);
      console.log("Filtering Config:", {
        hiddenCategories: hiddenCategoryIds.size,
        excludedChannels: excludedChannelIds.size,
      });

      // Ensure channelsData is an array
      let visibleChannels = Array.isArray(channelsData) ? channelsData : [];

      // When searching, show all results regardless of hidden categories
      // Otherwise, filter out channels from hidden categories
      if (!searchTerm) {
        // Filter out channels from hidden categories and excluded channels
        visibleChannels = visibleChannels.filter(
          (channel) =>
            !excludedChannelIds.has(channel.streamId) &&
            (!channel.categoryId || !hiddenCategoryIds.has(channel.categoryId))
        );

        // Filter out uncategorized channels if setting is disabled and we're viewing filtered results
        // (i.e., when a specific category is selected OR when viewing all but some categories are hidden)
        const includeUncategorized =
          playlist.includeUncategorizedChannels !== false;
        const isFilteredView =
          selectedCategory ||
          (playlist.hiddenCategories && playlist.hiddenCategories.length > 0);

        if (!includeUncategorized && isFilteredView) {
          visibleChannels = visibleChannels.filter(
            (channel) => channel.categoryId && channel.categoryId.trim() !== ""
          );
        }
      } else {
        // When searching, only filter out excluded channels
        visibleChannels = visibleChannels.filter(
          (channel) => !excludedChannelIds.has(channel.streamId)
        );
      }

      // Apply mapping filter
      if (mappingFilter === "mapped") {
        const beforeMappingFilter = visibleChannels.length;
        visibleChannels = visibleChannels.filter(
          (channel) => channel.channelMapping
        );
        console.log(
          `🔍 Mapping filter (mapped only): ${beforeMappingFilter} → ${visibleChannels.length} channels`
        );
      } else if (mappingFilter === "unmapped") {
        const beforeMappingFilter = visibleChannels.length;
        visibleChannels = visibleChannels.filter(
          (channel) => !channel.channelMapping
        );
        console.log(
          `🔍 Mapping filter (unmapped only): ${beforeMappingFilter} → ${visibleChannels.length} channels`
        );
      }

      // Apply operational filter
      if (operationalFilter === "on") {
        visibleChannels = visibleChannels.filter(
          (channel) => channel.isOperational !== false
        );
      } else if (operationalFilter === "off") {
        visibleChannels = visibleChannels.filter(
          (channel) => channel.isOperational === false
        );
      }

      // Apply archive filter
      if (archiveFilter === "on") {
        visibleChannels = visibleChannels.filter((channel) => channel.hasArchive);
      } else if (archiveFilter === "off") {
        visibleChannels = visibleChannels.filter((channel) => !channel.hasArchive);
      }

      // Apply pagination if needed
      const totalFiltered = visibleChannels.length;
      setTotalChannels(totalFiltered);

      let paginatedChannels = visibleChannels;
      if (totalFiltered > CHANNELS_PER_PAGE) {
        const totalPagesCalculated = Math.ceil(
          totalFiltered / CHANNELS_PER_PAGE
        );
        setTotalPages(totalPagesCalculated);
        setCurrentPage(page);

        const startIndex = (page - 1) * CHANNELS_PER_PAGE;
        const endIndex = startIndex + CHANNELS_PER_PAGE;
        paginatedChannels = visibleChannels.slice(startIndex, endIndex);

        console.log(
          `📄 Pagination applied: Showing ${startIndex + 1}-${Math.min(
            endIndex,
            totalFiltered
          )} of ${totalFiltered} channels (page ${page}/${totalPagesCalculated})`
        );
      } else {
        setTotalPages(1);
        setCurrentPage(1);
      }

      console.log("=" + "=".repeat(80));
      console.log("✅ CHANNEL LOAD COMPLETE");
      console.log(`   Total received from API: ${channelsData.length}`);
      console.log(`   After filtering: ${totalFiltered}`);
      console.log(
        `   Displaying: ${paginatedChannels.length} channels (page ${page})`
      );
      console.log("=".repeat(80));

      setChannels(paginatedChannels);

      // Wait for minimum load time to ensure indicator is visible
      console.log("⏳ Waiting for minimum load time (300ms)...");
      await minLoadTime;
      console.log("✅ Minimum load time complete");

      // Add extra delay to ensure React finishes rendering channels
      console.log("⏳ Waiting for React to render channels...");
      await new Promise((resolve) => setTimeout(resolve, 200));
      console.log("✅ Channels should now be rendered in DOM");
    } catch (err: any) {
      console.log("=".repeat(80));
      console.error("❌ ERROR LOADING CHANNELS");
      console.error("Error details:", err);
      console.error("Error message:", err.message);
      console.error("Error response:", err.response?.data);
      console.error("Error status:", err.response?.status);
      console.log("=".repeat(80));
      setError(err.message || "Failed to load channels");
      await minLoadTime; // Ensure min time even on error
    } finally {
      console.log("🔄 Setting loading to FALSE");
      setLoading(false);
      console.log("✅ Loading banner should now be hidden");
    }
  };

  const startSync = async (selectedCategoryIds?: string[]) => {
    // Check cooldown for this specific playlist
    const lastSync = getLastSyncTime();
    if (lastSync) {
      const timeSinceLastSync = Date.now() - lastSync;
      const remainingTime = COOLDOWN_DURATION - timeSinceLastSync;

      if (remainingTime > 0) {
        const minutes = Math.floor(remainingTime / 60000);
        const seconds = Math.floor((remainingTime % 60000) / 1000);
        setCooldownMessage(
          `Please wait ${minutes}:${seconds
            .toString()
            .padStart(2, "0")} before syncing "${
            playlist.name
          }" again to avoid being banned by your IPTV provider.`
        );
        return;
      }
    }

    console.log("=".repeat(80));
    console.log("🔄 SYNC PROCESS STARTED");
    console.log("=".repeat(80));

    let pollInterval: NodeJS.Timeout | null = null;
    let isCompleted = false; // Flag to prevent multiple completions

    try {
      // PHASE 1: Initialize sync (Progress: 0%)
      console.log("📝 Phase 1: Initializing sync...");
      setSyncing(true); // Block all user interaction
      setSyncProgress(0);
      lastProgressRef.current = 0; // Reset progress tracking
      setError(null);
      setSyncMessage("Starting sync...");
      setCooldownMessage(null);

      // Start async sync and get job ID (with optional category filters)
      const { jobId } =
        selectedCategoryIds && selectedCategoryIds.length > 0
          ? await api.syncPlaylistWithCategories(
              playlist.id!,
              selectedCategoryIds
            )
          : await api.syncPlaylist(playlist.id!);
      console.log(`✅ Sync job created: ${jobId}`);

      // PHASE 2: Poll for backend sync progress (Progress: 0-75%)
      console.log("📝 Phase 2: Syncing from provider...");
      setSyncMessage("Downloading playlist from provider...");

      pollInterval = setInterval(async () => {
        // If already completed, don't poll again
        if (isCompleted) {
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
          return;
        }

        try {
          const job = await api.getPlaylistSyncJob(playlist.id!, jobId);
          console.log(
            `📊 Job status: ${job.status}, progress: ${job.progress}%`
          );

          // Scale backend progress to 0-75% range
          const scaledProgress = Math.floor((job.progress || 0) * 0.75);

          // Ensure progress never decreases (prevents flickering/jumping backwards)
          if (scaledProgress > lastProgressRef.current) {
            lastProgressRef.current = scaledProgress;
            setSyncProgress(scaledProgress);
          } else {
            console.log(
              `  ⚠️ Skipping progress update (${scaledProgress}% <= ${lastProgressRef.current}%)`
            );
          }

          if (job.message) {
            setSyncMessage(job.message);
          }

          // Check if backend sync completed
          if (job.status === "completed") {
            isCompleted = true;

            // Clear interval first
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }

            console.log("✅ Backend sync completed");
            console.log(
              `   Channels: ${job.totalChannels}, Categories: ${job.totalCategories}`
            );

            // PHASE 3: Update UI with synced data (Progress: 75-100%)
            console.log("📝 Phase 3: Preparing UI data behind overlay...");

            try {
              // Step 1: Reload playlist metadata (75-85%)
              lastProgressRef.current = 75;
              setSyncProgress(75);
              setSyncMessage("Updating playlist information...");
              console.log("🔄 Reloading playlist metadata...");

              await loadData(); // Reload categories and playlist info

              console.log("✅ Playlist metadata reloaded");

              // Step 2: Reload channels with current filters (85-95%)
              lastProgressRef.current = 85;
              setSyncProgress(85);
              setSyncMessage("Loading channels with filters...");
              console.log("🔄 Reloading channels with current filters...");
              console.log("   Current filters:", {
                selectedCategory,
                searchTerm,
                mappingFilter,
                hiddenCategories: playlist.hiddenCategories?.length,
                excludedChannels: playlist.excludedChannels?.length,
              });

              await loadChannels(1); // Reload channels respecting current filters

              console.log("✅ Channels reloaded");

              // Step 3: Fetch fresh playlist with correct filtered counts (95-98%)
              lastProgressRef.current = 95;
              setSyncProgress(95);
              setSyncMessage("Updating playlist information...");

              console.log("🔄 Fetching fresh playlist data from backend...");
              const freshPlaylist = await api.getPlaylist(playlist.id!);
              setLocalPlaylist(freshPlaylist);
              console.log("✅ Fresh playlist data loaded:", {
                totalChannels: freshPlaylist.channelCount,
                filteredChannels: freshPlaylist.filteredChannelCount,
              });

              // Step 4: Finalize (98-100%)
              lastProgressRef.current = 98;
              setSyncProgress(98);
              setSyncMessage("Finalizing...");

              await new Promise((resolve) => setTimeout(resolve, 300));

              lastProgressRef.current = 100;
              setSyncProgress(100);
              setSyncMessage(
                `Sync complete! ${job.totalChannels} channels and ${job.totalCategories} categories imported.`
              );

              setLastSyncTime(Date.now());

              console.log("=".repeat(80));
              console.log("✅ SYNC PROCESS COMPLETED SUCCESSFULLY");
              console.log("   All data loaded and ready to display");
              console.log("=".repeat(80));

              // Finalize while keeping the overlay up until all work is done
              console.log("📡 Starting final update sequence...");

              // Prevent effects from reloading while we finish updates
              justSyncedRef.current = true;

              // Notify parent while overlay remains
              onSync();

              // Give React a brief tick to apply state changes
              await new Promise((resolve) => setTimeout(resolve, 150));

              // Dismiss overlay only after everything is done
              setSyncMessage(null);
              setSyncProgress(0);
              setSyncing(false); // Unblock user interaction

              if (job.summary) {
                setSyncSummary({
                  addedChannels: job.summary.addedChannels || [],
                  removedChannels: job.summary.removedChannels || [],
                  addedCount: job.summary.addedCount || 0,
                  removedCount: job.summary.removedCount || 0,
                });
              }

              console.log("✅ User interaction enabled");
              console.log("✅ Sync sequence complete - UI showing final state");
              console.log("🛡️ Redundant reload protection active");

              // Reset the protection flag shortly after dismissal
              setTimeout(() => {
                justSyncedRef.current = false;
                console.log(
                  "🔓 Reload protection deactivated - ready for next sync"
                );
              }, 1000);
            } catch (reloadErr: any) {
              console.log("=".repeat(80));
              console.error("❌ POST-SYNC UI UPDATE FAILED");
              console.error("Error:", reloadErr);
              console.log("=".repeat(80));

              lastProgressRef.current = 0;
              setSyncProgress(0);
              setSyncing(false); // Unblock even on error
              justSyncedRef.current = false; // Reset flag on error
              setError(reloadErr.message || "Failed to update UI after sync");
            }
          } else if (job.status === "failed") {
            isCompleted = true;

            // Clear interval first
            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }

            console.log("=".repeat(80));
            console.error("❌ SYNC PROCESS FAILED");
            console.error("Error:", job.error);
            console.log("=".repeat(80));

            lastProgressRef.current = 0;
            setSyncProgress(0);
            setSyncing(false); // Unblock user interaction
            justSyncedRef.current = false; // Reset flag on failure
            setError(job.error || "Sync failed");
          }
        } catch (pollErr: any) {
          console.error("⚠️ Poll error (will retry):", pollErr.message);
          // Don't stop polling on transient errors
        }
      }, 1500); // Poll every 1.5 seconds
    } catch (err: any) {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }

      console.log("=".repeat(80));
      console.error("❌ SYNC INITIALIZATION FAILED");
      console.error("Error:", err);
      console.log("=".repeat(80));

      lastProgressRef.current = 0;
      setSyncProgress(0);
      setSyncing(false); // Unblock user interaction
      justSyncedRef.current = false; // Reset flag on error
      setError(
        err.response?.data?.error || err.message || "Failed to start sync"
      );
    }
  };

  const handleSyncCategories = async () => {
    if (playlist.type !== "xtream") {
      await startSync();
      return;
    }

    try {
      setLoading(true);
      const result = await api.syncCategories(playlist.id!);

      setCategorySyncSummary({
        total: result.categoriesCount ?? 0,
        added: result.added || [],
        removed: result.removed || [],
        isFirstSync: !!result.isFirstSync,
      });

      // Refresh categories and playlist metadata (timestamps)
      await loadData();
      const updatedPlaylist = await api.getPlaylist(playlist.id!);
      setLocalPlaylist(updatedPlaylist);
    } catch (err: any) {
      setError(err.message || "Failed to sync categories");
    } finally {
      setLoading(false);
    }
  };

  const handleSyncChannels = async () => {
    if (playlist.type === "xtream") {
      // Always refresh categories to pick up latest selections from settings
      const categoriesData = await api.getCategories(playlist.id!);

      // Determine selected from the full list (do not filter out hidden for selection logic)
      const selected = categoriesData
        .filter((c) => Number(c.isSelected) === 1 || c.isSelected === true)
        .map((c) => c.categoryId);

      // Update visible categories for UI (respect hidden categories)
      const hiddenCategoryIds = new Set(playlist.hiddenCategories || []);
      const visibleCategories = categoriesData.filter(
        (cat) => !hiddenCategoryIds.has(cat.categoryId)
      );
      setCategories(visibleCategories);

      if (selected.length === 0) {
        setConfirmModal({
          title: "Select Categories First",
          message:
            "No categories are selected for channel sync. Please select one or more categories in playlist settings (Categories tab), then try syncing channels again.",
          confirmText: "Open Categories",
          confirmVariant: "primary",
          onConfirm: () => {
            setConfirmModal(null);
            onEditPlaylist("Categories");
          },
        });
        return;
      }
      await startSync(selected);
      return;
    }
    await startSync();
  };

  const handleCleanupSync = async () => {
    if (!playlist.id) return;

    try {
      setLoading(true);
      console.log(
        `🧹 Cleaning up stuck sync jobs for playlist ${playlist.id}...`
      );

      const result = await api.cleanupStuckSyncJobs(playlist.id);

      console.log(`✅ Cleanup result:`, result);

      if (result.cleaned > 0) {
        setSyncMessage(
          `Cleaned up ${result.cleaned} stuck sync job(s). You can now sync again.`
        );
      } else {
        setSyncMessage("No stuck sync jobs found.");
      }

      setError(null);

      // Clear message after 3 seconds
      setTimeout(() => {
        setSyncMessage(null);
      }, 3000);
    } catch (err: any) {
      console.error("❌ Cleanup error:", err);
      setError(
        err.response?.data?.error ||
          err.message ||
          "Failed to cleanup stuck jobs"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleExportFull = async () => {
    try {
      // Export full playlist without any filters
      const blob = await api.exportPlaylist(playlist.id!);

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${playlist.name}.m3u`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError("Failed to export: " + err.message);
    }
  };

  const handleExportFiltered = async () => {
    try {
      // Get all visible channel IDs after applying all filters
      const visibleChannelIds = channels.map((ch) => ch.streamId);

      // Export only the visible channels
      const blob = await api.exportCustom(
        playlist.id!,
        visibleChannelIds,
        undefined
      );

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${playlist.name}-filtered.m3u`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError("Failed to export: " + err.message);
    }
  };

  const handleExportFullJSON = async () => {
    try {
      const blob = await api.exportPlaylistJSON(playlist.id!);

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${playlist.name}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError("Failed to export: " + err.message);
    }
  };

  const handleExportFilteredJSON = async () => {
    try {
      const visibleChannelIds = channels.map((ch) => ch.streamId);

      const blob = await api.exportCustomJSON(
        playlist.id!,
        visibleChannelIds,
        undefined
      );

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${playlist.name}-filtered.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError("Failed to export: " + err.message);
    }
  };

  const [importResults, setImportResults] = useState<{
    updated: number;
    mapped: number;
    notFound: number;
    channelsInJsonNotInPlaylist: Array<{ channelName: string; channelId: any }>;
    channelsInPlaylistNotInJson: Array<{ channelName: string; channelId: any }>;
  } | null>(null);

  const [categorySyncSummary, setCategorySyncSummary] = useState<{
    total: number;
    added: string[];
    removed: string[];
    isFirstSync: boolean;
  } | null>(null);

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    console.log("🔔 handleImport TRIGGERED!", {
      hasFiles: !!event.target.files,
      fileCount: event.target.files?.length || 0,
    });

    const file = event.target.files?.[0];
    if (!file) {
      console.warn("⚠️ No file selected in handleImport");
      return;
    }

    console.log("📥 Import started:", file.name);

    let pollInterval: NodeJS.Timeout | null = null;
    let isCompleted = false;

    try {
      // Show import progress modal
      setImporting(true);
      setImportProgress(0);
      setImportMessage("Reading file...");
      setError(null);

      const text = await file.text();
      const data = JSON.parse(text);

      console.log("📄 Parsed JSON, found", data.length, "entries");

      if (!Array.isArray(data)) {
        setImporting(false);
        setConfirmModal({
          title: "Invalid Format",
          message: "Invalid JSON format. Expected an array of channels.",
          confirmVariant: "warning",
        });
        return;
      }

      setImportProgress(10);
      setImportMessage("Starting import...");

      console.log("🔄 Sending import request to server...");
      const result = await api.importPlaylistChannels(playlist.id!, data);
      console.log("✅ Import job created:", result);

      setImportProgress(20);
      setImportMessage("Processing mappings...");

      // Poll for job status
      pollInterval = setInterval(async () => {
        if (isCompleted) {
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
          return;
        }

        try {
          const job = await api.getImportJob(playlist.id!, result.jobId);
          console.log(`📊 Import job status: ${job.status} (${job.progress}%)`);

          // Scale progress from 20-90% during processing
          const scaledProgress = 20 + Math.floor(job.progress * 0.7);
          setImportProgress(scaledProgress);

          if (job.message) {
            setImportMessage(job.message);
            console.log(`💬 ${job.message}`);
          }

          if (job.status === "completed") {
            isCompleted = true;

            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }

            setImportProgress(90);
            setImportMessage("Reloading channels...");
            console.log("✅ Import completed successfully");

            // Reload channels
            await loadChannels(1);

            setImportProgress(100);
            setImportMessage(
              `Import complete! ${job.mapped} channels mapped, ${job.notFound} not found.`
            );

            // Show success message briefly
            setTimeout(() => {
              setImporting(false);
              setImportProgress(0);
              setImportMessage(null);

              // Parse the detailed channel lists from job
              let channelsInJsonNotInPlaylist: Array<{
                channelName: string;
                channelId: any;
              }> = [];
              let channelsInPlaylistNotInJson: Array<{
                channelName: string;
                channelId: any;
              }> = [];

              try {
                if (job.channelsInJsonNotInPlaylist) {
                  channelsInJsonNotInPlaylist = JSON.parse(
                    job.channelsInJsonNotInPlaylist
                  );
                }
                if (job.channelsInPlaylistNotInJson) {
                  channelsInPlaylistNotInJson = JSON.parse(
                    job.channelsInPlaylistNotInJson
                  );
                }
              } catch (parseError) {
                console.error("Failed to parse channel lists:", parseError);
              }

              // Show results modal
              setImportResults({
                updated: job.mapped,
                mapped: job.mapped,
                notFound: job.notFound,
                channelsInJsonNotInPlaylist,
                channelsInPlaylistNotInJson,
              });
            }, 1500);
          } else if (job.status === "failed") {
            isCompleted = true;

            if (pollInterval) {
              clearInterval(pollInterval);
              pollInterval = null;
            }

            setImporting(false);
            setImportProgress(0);
            setImportMessage(null);
            console.error("❌ Import failed:", job.error);

            setConfirmModal({
              title: "Import Failed",
              message: `Failed to import: ${job.error || "Unknown error"}`,
              confirmVariant: "danger",
            });
          }
        } catch (pollErr: any) {
          console.error("Poll error:", pollErr);
          // Don't stop polling on transient errors
        }
      }, 1500); // Poll every 1.5 seconds
    } catch (error: any) {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }

      console.error("❌ Import failed:", error);
      setImporting(false);
      setImportProgress(0);
      setImportMessage(null);
      setConfirmModal({
        title: "Import Failed",
        message: "Failed to start import: " + error.message,
        confirmVariant: "danger",
      });
    }

    // Reset the input
    event.target.value = "";
  };

  const handleImportFromPlaylist = async (sourcePlaylistId: number) => {
    const sourcePlaylist = allPlaylists.find((p) => p.id === sourcePlaylistId);
    if (!sourcePlaylist) return;

    // Check if identifier settings match
    const sourceIdentifier = `${
      sourcePlaylist.identifierSource || "streamId"
    }|${sourcePlaylist.identifierRegex || ""}|${
      sourcePlaylist.identifierMetadataKey || ""
    }`;
    const targetIdentifier = `${playlist.identifierSource || "streamId"}|${
      playlist.identifierRegex || ""
    }|${playlist.identifierMetadataKey || ""}`;

    if (sourceIdentifier !== targetIdentifier) {
      setConfirmModal({
        title: "Identifier Settings Mismatch",
        message: `Warning: The identifier settings for these playlists don't match.\n\nSource: ${
          sourcePlaylist.identifierSource || "streamId"
        }\nTarget: ${
          playlist.identifierSource || "streamId"
        }\n\nThe mapping may not work correctly. Do you want to continue anyway?`,
        confirmText: "Continue",
        cancelText: "Cancel",
        confirmVariant: "warning",
        onConfirm: async () => {
          await performImportFromPlaylist(sourcePlaylistId);
        },
      });
    } else {
      await performImportFromPlaylist(sourcePlaylistId);
    }
  };

  const performImportFromPlaylist = async (sourcePlaylistId: number) => {
    try {
      const result = await api.copyPlaylistMappings(
        sourcePlaylistId,
        playlist.id!
      );
      setImportResults({
        updated: result.updated,
        mapped: result.mapped,
        notFound: result.notFound,
        channelsInJsonNotInPlaylist: result.notFoundChannels || [],
        channelsInPlaylistNotInJson: [],
      });
      loadChannels(1);
    } catch (error: any) {
      setConfirmModal({
        title: "Import Failed",
        message: "Failed to import mappings: " + error.message,
        confirmVariant: "danger",
      });
    }
  };

  // Calculate active filters for display
  const getActiveFilters = () => {
    const filters: Array<{ label: string; tab?: string; action?: () => void }> =
      [];
    const hiddenCategoriesCount = playlist.hiddenCategories?.length || 0;
    const excludedChannelsCount = playlist.excludedChannels?.length || 0;

    if (hiddenCategoriesCount > 0) {
      filters.push({
        label: `${hiddenCategoriesCount} hidden ${
          hiddenCategoriesCount === 1 ? "category" : "categories"
        }`,
        tab: "categories",
      });
    }
    if (excludedChannelsCount > 0) {
      filters.push({
        label: `${excludedChannelsCount} excluded ${
          excludedChannelsCount === 1 ? "channel" : "channels"
        }`,
        tab: "excluded-channels",
      });
    }
    if (selectedCategory) {
      const cat = categories.find((c) => c.categoryId === selectedCategory);
      if (cat) {
        filters.push({
          label: `category: ${cat.categoryName}`,
          action: () => setSelectedCategory(null),
        });
      }
    }
    if (searchTerm) {
      filters.push({
        label: `search: "${searchTerm}"`,
        action: () => setSearchTerm(""),
      });
    }

    return filters;
  };

  const handleExcludeChannel = async (streamId: string) => {
    try {
      const currentExcluded = playlist.excludedChannels || [];
      const updatedExcluded = [...currentExcluded, streamId];

      await api.updatePlaylist(playlist.id!, {
        excludedChannels: updatedExcluded,
      });

      // Reload the playlist data
      onSync();
    } catch (err: any) {
      setError("Failed to exclude channel: " + err.message);
    }
  };

  const handleToggleOperational = async (channel: Channel) => {
    const nextValue = !(channel.isOperational ?? true);
    const prevChannels = channels;
    setChannels((prev) =>
      prev.map((ch) =>
        ch.streamId === channel.streamId
          ? { ...ch, isOperational: nextValue, isOperationalManual: true }
          : ch
      )
    );

    try {
      await api.updateChannelFlags(playlist.id!, channel.streamId, {
        isOperational: nextValue,
      });
      await loadChannels(currentPage);
    } catch (err: any) {
      setChannels(prevChannels);
      console.error("Failed to update operational status:", err);
    }
  };

  const handleToggleArchive = async (channel: Channel) => {
    const nextValue = !(channel.hasArchive ?? false);
    const prevChannels = channels;
    setChannels((prev) =>
      prev.map((ch) =>
        ch.streamId === channel.streamId
          ? { ...ch, hasArchive: nextValue, hasArchiveManual: true }
          : ch
      )
    );

    try {
      await api.updateChannelFlags(playlist.id!, channel.streamId, {
        hasArchive: nextValue,
      });
      await loadChannels(currentPage);
    } catch (err: any) {
      setChannels(prevChannels);
      console.error("Failed to update archive status:", err);
    }
  };

  // Channel count shown in header/dropdowns: prefer the latest loaded total, then filtered count, then raw count
  const displayedChannelCount =
    totalChannels ||
    localPlaylist.filteredChannelCount ||
    localPlaylist.channelCount ||
    0;

  return (
    <div className="playlist-viewer">
      {cooldownMessage && (
        <div className="cooldown-modal">
          <div className="cooldown-modal-content">
            <div className="cooldown-modal-header">
              <h3>⏱️ Sync Cooldown Active</h3>
              <button
                className="cooldown-modal-close"
                onClick={() => setCooldownMessage(null)}
              >
                ×
              </button>
            </div>
            <p>{cooldownMessage}</p>
            <button
              className="btn btn-primary"
              onClick={() => setCooldownMessage(null)}
            >
              OK
            </button>
          </div>
        </div>
      )}

      <div className="viewer-header">
        <div className="header-info">
          <h2>{localPlaylist.name}</h2>
          <div className="header-meta">
            <span className="badge">{localPlaylist.type.toUpperCase()}</span>
            <span className="text-secondary">
              {displayedChannelCount} channels
            </span>
          </div>
        </div>
        <div className="header-actions-wrapper">
          <div className="header-last-sync">
            {playlist.type === "xtream" ? (
              <>
                <div>
                  Last Categories sync:{" "}
                  {formatLastSync(localPlaylist.lastCategoriesSyncedAt)}
                </div>
                <div>
                  Last Channels sync:{" "}
                  {formatLastSync(localPlaylist.lastChannelsSyncedAt)}
                </div>
              </>
            ) : (
              <>Last synced: {formatLastSync(localPlaylist.lastSyncedAt)}</>
            )}
          </div>
          <div className="header-actions">
            {playlist.type === "xtream" ? (
              <>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleSyncCategories}
                  disabled={loading || syncing}
                >
                  📂 Sync Categories
                </button>
                <button
                  className={`btn btn-secondary btn-sm sync-btn ${
                    syncing ? "syncing" : ""
                  }`}
                  onClick={handleSyncChannels}
                  disabled={syncing || loading || categories.length === 0}
                  style={
                    {
                      "--sync-progress": `${syncProgress}%`,
                    } as React.CSSProperties
                  }
                >
                  <span className="sync-btn-text">
                    {syncing ? "⏳ Sync Channels..." : "🔄 Sync Channels"}
                  </span>
                </button>
              </>
            ) : (
              <button
                className={`btn btn-secondary btn-sm sync-btn ${
                  syncing ? "syncing" : ""
                }`}
                onClick={() => startSync()}
                disabled={syncing}
                style={
                  {
                    "--sync-progress": `${syncProgress}%`,
                  } as React.CSSProperties
                }
              >
                <span className="sync-btn-text">
                  {syncing ? "⏳ Syncing..." : "🔄 Sync"}
                </span>
              </button>
            )}
            <div className="export-dropdown">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowImportMenu(!showImportMenu)}
              >
                📤 Import ▾
              </button>
              {showImportMenu && (
                <>
                  <div
                    className="export-dropdown-overlay"
                    onClick={() => setShowImportMenu(false)}
                  />
                  <div className="export-dropdown-menu">
                    <button
                      className="export-dropdown-item"
                      onClick={() => {
                        setShowImportMenu(false);
                        setShowPlaylistSelectionModal(true);
                      }}
                    >
                      <span className="export-icon">📋</span>
                      <div className="export-details">
                        <div className="export-title">
                          Mapping from Another Playlist
                        </div>
                        <div className="export-description">
                          Copy channel mappings from another playlist
                        </div>
                      </div>
                    </button>
                    <button
                      className="export-dropdown-item"
                      onClick={() => {
                        console.log("🖱️ Import JSON button clicked");
                        setShowImportMenu(false);

                        // Use setTimeout to ensure state update completes first
                        setTimeout(() => {
                          const input =
                            document.getElementById("import-file-input");
                          console.log(
                            "📂 File input element:",
                            input ? "Found" : "NOT FOUND"
                          );
                          if (input) {
                            console.log("🎯 Triggering file picker...");
                            input.click();
                          } else {
                            console.error(
                              "❌ File input element not found in DOM!"
                            );
                          }
                        }, 100);
                      }}
                    >
                      <span className="export-icon">📄</span>
                      <div className="export-details">
                        <div className="export-title">
                          Mapping from a JSON File
                        </div>
                        <div className="export-description">
                          Import channel mappings from JSON file
                        </div>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className="export-dropdown">
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setShowExportMenu(!showExportMenu)}
              >
                📥 Export ▾
              </button>
              {showExportMenu && (
                <>
                  <div
                    className="export-dropdown-overlay"
                    onClick={() => setShowExportMenu(false)}
                  />
                  <div className="export-dropdown-menu">
                    <button
                      className="export-dropdown-item"
                      onClick={() => {
                        handleExportFull();
                        setShowExportMenu(false);
                      }}
                    >
                      <span className="export-icon">📄</span>
                      <div className="export-details">
                        <div className="export-title">
                          Full Playlist {"{m3u}"}
                        </div>
                        <div className="export-description">
                          Export complete playlist with all channels
                        </div>
                      </div>
                    </button>
                    <button
                      className="export-dropdown-item"
                      onClick={() => {
                        handleExportFiltered();
                        setShowExportMenu(false);
                      }}
                    >
                      <span className="export-icon">🔍</span>
                      <div className="export-details">
                        <div className="export-title">
                          Filtered Playlist ({channels.length} channels){" "}
                          {"{m3u}"}
                        </div>
                        <div className="export-description">
                          Export only visible channels (respects all filters)
                        </div>
                      </div>
                    </button>
                    <button
                      className="export-dropdown-item"
                      onClick={() => {
                        handleExportFullJSON();
                        setShowExportMenu(false);
                      }}
                    >
                      <span className="export-icon">📊</span>
                      <div className="export-details">
                        <div className="export-title">
                          Full Playlist {"{json}"}
                        </div>
                        <div className="export-description">
                          Export complete playlist as JSON
                        </div>
                      </div>
                    </button>
                    <button
                      className="export-dropdown-item"
                      onClick={() => {
                        handleExportFilteredJSON();
                        setShowExportMenu(false);
                      }}
                    >
                      <span className="export-icon">📈</span>
                      <div className="export-details">
                        <div className="export-title">
                          Filtered Playlist ({channels.length} channels){" "}
                          {"{json}"}
                        </div>
                        <div className="export-description">
                          Export visible channels as JSON
                        </div>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {!!playlist.externalAccessEnabled && playlist.uniqueId && (
        <div className="external-link-container">
          <span className="external-link-label">🌐 External Link:</span>
          <div className="external-link-wrapper">
            <input
              type="text"
              className="external-link-input"
              value={
                playlist.type === "xtream"
                  ? `${window.location.origin}/playlist/${playlist.uniqueId}?u=${playlist.username}&p=${playlist.password}`
                  : `${window.location.origin}/playlist/${playlist.uniqueId}?t=${playlist.externalAccessToken}`
              }
              readOnly
            />
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                const link =
                  playlist.type === "xtream"
                    ? `${window.location.origin}/playlist/${playlist.uniqueId}?u=${playlist.username}&p=${playlist.password}`
                    : `${window.location.origin}/playlist/${playlist.uniqueId}?t=${playlist.externalAccessToken}`;
                navigator.clipboard.writeText(link);
                setConfirmModal({
                  title: "Success",
                  message: "Link copied to clipboard!",
                  confirmVariant: "success",
                });
              }}
              title="Copy external link"
            >
              📋 Copy
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="error-message">
          {error}
          {error.toLowerCase().includes("already in progress") && (
            <>
              <br />
              <button
                className="btn btn-sm btn-danger"
                onClick={handleCleanupSync}
                style={{ marginTop: "8px" }}
              >
                🧹 Clean Up Stuck Sync
              </button>
            </>
          )}
        </div>
      )}
      {syncMessage && <div className="success-message">{syncMessage}</div>}

      <div className="active-filters-info">
        {getActiveFilters().length > 0 && (
          <>
            <span className="active-filters-label">🔍 Active Filters:</span>
            <div className="active-filters-tags">
              {getActiveFilters().map((filter, index) => (
                <button
                  key={index}
                  className={`filter-tag ${
                    filter.tab || filter.action ? "filter-tag-clickable" : ""
                  }`}
                  onClick={() => {
                    if (filter.tab) {
                      onEditPlaylist(filter.tab);
                    } else if (filter.action) {
                      filter.action();
                    }
                  }}
                  title={
                    filter.tab
                      ? "Click to manage in settings"
                      : filter.action
                      ? "Click to clear filter"
                      : ""
                  }
                >
                  {filter.label}
                  {filter.tab && <span className="filter-tag-icon">⚙️</span>}
                  {filter.action && <span className="filter-tag-icon">✕</span>}
                </button>
              ))}
            </div>
          </>
        )}
        <button
          className="mapping-filter-toggle-btn"
          onClick={() => {
            if (mappingFilter === "all") {
              setMappingFilter("mapped");
            } else if (mappingFilter === "mapped") {
              setMappingFilter("unmapped");
            } else {
              setMappingFilter("all");
            }
          }}
          title="Click to cycle: All → Mapped → Unmapped"
        >
          {mappingFilter === "all" && "🔘 All"}
          {mappingFilter === "mapped" && "✓ Mapped"}
          {mappingFilter === "unmapped" && "○ Unmapped"}
        </button>
      </div>

      <div className="viewer-controls">
        <div className="view-toggle">
          <button
            className={`view-toggle-btn ${viewMode === "grid" ? "active" : ""}`}
            onClick={() => setViewMode("grid")}
            title="Grid View"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
          </button>
          <button
            className={`view-toggle-btn ${
              viewMode === "table" ? "active" : ""
            }`}
            onClick={() => setViewMode("table")}
            title="Table View"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="15" x2="21" y2="15" />
              <rect x="3" y="3" width="18" height="18" />
            </svg>
          </button>
        </div>

        <div className="status-filter-toggle">
          <button
            className={`status-filter-btn ${
              operationalFilter !== "all" ? "active" : ""
            }`}
            onClick={() =>
              setOperationalFilter((prev) =>
                prev === "all" ? "on" : prev === "on" ? "off" : "all"
              )
            }
            title="Operational filter: All → Operational → Not operational"
            aria-label="Operational filter"
          >
            <span
              className={`status-filter-indicator status-filter-indicator--${operationalFilter}`}
            />
          </button>
          <button
            className={`status-filter-btn ${
              archiveFilter !== "all" ? "active" : ""
            }`}
            onClick={() =>
              setArchiveFilter((prev) =>
                prev === "all" ? "on" : prev === "on" ? "off" : "all"
              )
            }
            title="Archive filter: All → Enabled → Disabled"
            aria-label="Archive filter"
          >
            <span
              className={`archive-filter-indicator archive-filter-indicator--${archiveFilter}`}
            >
              <svg
                className="archive-filter-icon"
                viewBox="0 0 24 24"
                aria-hidden="true"
                focusable="false"
              >
                <path
                  d="M4 3h16a1 1 0 0 1 1 1v3H3V4a1 1 0 0 1 1-1Zm-1 6h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9Zm6 3a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2H9Z"
                  fill="currentColor"
                />
              </svg>
            </span>
          </button>
        </div>

        <div className="search-box">
          <input
            type="search"
            placeholder="🔍 Search channels..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="category-filter">
          <select
            id="category"
            value={selectedCategory || ""}
            onChange={(e) => setSelectedCategory(e.target.value || null)}
          >
            <option value="">
              All Categories ({displayedChannelCount})
            </option>
            {categories.map((cat) => (
              <option key={cat.categoryId} value={cat.categoryId}>
                {cat.categoryName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Loading banner - shown during channel loading */}
      {loading && !syncing && (
        <div className="loading-banner">
          <div className="loading-banner-content">
            <div className="loading-spinner-small"></div>
            <span>Loading channels...</span>
          </div>
        </div>
      )}

      <ChannelList
        channels={channels}
        viewMode={viewMode}
        identifierSource={playlist.identifierSource}
        identifierRegex={playlist.identifierRegex}
        identifierMetadataKey={playlist.identifierMetadataKey}
        playlistId={playlist.id}
        onExcludeChannel={handleExcludeChannel}
        onMapChannel={(channel) => setMappingChannel(channel)}
        onToggleOperational={handleToggleOperational}
        onToggleArchive={handleToggleArchive}
        isLargePlaylist={(playlist.channelCount ?? 0) > 10000}
        channelCount={playlist.channelCount}
      />

      {/* Pagination controls */}
      {totalPages > 1 && !loading && (
        <div className="pagination-controls">
          <div className="pagination-info">
            Showing {channels.length} of {totalChannels} channels (Page{" "}
            {currentPage} of {totalPages})
          </div>
          <div className="pagination-buttons">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => loadChannels(1)}
              disabled={currentPage === 1}
            >
              « First
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => loadChannels(currentPage - 1)}
              disabled={currentPage === 1}
            >
              ‹ Previous
            </button>
            <span className="pagination-current">
              Page {currentPage} of {totalPages}
            </span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => loadChannels(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              Next ›
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => loadChannels(totalPages)}
              disabled={currentPage === totalPages}
            >
              Last »
            </button>
          </div>
        </div>
      )}

      {/* Debug: Log loading state during render */}
      {(() => {
        console.log("🎨 RENDER - loading state:", loading);
        return null;
      })()}

      {loading && syncing && (
        <div className="loading-overlay">
          {(() => {
            console.log("🎨 RENDERING LOADING OVERLAY NOW!");
            return null;
          })()}
          <div className="loading-spinner-container">
            <div className="loading-spinner"></div>
            <p className="loading-text">Loading channels...</p>
          </div>
        </div>
      )}

      {mappingChannel && playlist.id && (
        <ChannelMappingModal
          channel={mappingChannel}
          playlistId={playlist.id}
          onClose={() => setMappingChannel(null)}
          onMapped={() => {
            loadChannels(currentPage);
          }}
        />
      )}

      {categorySyncSummary && (
        <div className="modal-overlay" onClick={() => setCategorySyncSummary(null)}>
          <div
            className="modal"
            style={{ maxWidth: "520px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>📂 Category Sync Summary</h2>
            </div>
            <div
              className="modal-body"
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <div>
                <strong>Total categories:</strong> {categorySyncSummary.total}
              </div>
              {categorySyncSummary.isFirstSync ? (
                <div>First sync for this playlist: all categories are new.</div>
              ) : (
                <>
                  <div>
                    <strong>Added:</strong>
                    {categorySyncSummary.added.length > 0 ? (
                      <div
                        style={{
                          maxHeight: "160px",
                          overflowY: "auto",
                          padding: "8px",
                          border: "1px solid var(--border-color, #333)",
                          borderRadius: "6px",
                          marginTop: "6px",
                        }}
                      >
                        <ul style={{ margin: 0, paddingLeft: "16px" }}>
                          {categorySyncSummary.added.map((c) => (
                            <li key={`added-${c}`}>{c}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      " None"
                    )}
                  </div>
                  <div>
                    <strong>Removed:</strong>
                    {categorySyncSummary.removed.length > 0 ? (
                      <div
                        style={{
                          maxHeight: "160px",
                          overflowY: "auto",
                          padding: "8px",
                          border: "1px solid var(--border-color, #333)",
                          borderRadius: "6px",
                          marginTop: "6px",
                        }}
                      >
                        <ul style={{ margin: 0, paddingLeft: "16px" }}>
                          {categorySyncSummary.removed.map((c) => (
                            <li key={`removed-${c}`}>{c}</li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      " None"
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setCategorySyncSummary(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {importResults && (
        <div className="modal-overlay" onClick={() => setImportResults(null)}>
          <div
            className="import-results-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="import-results-header">
              <h2>Import Results</h2>
            </div>
            <div className="import-results-body">
              <div className="import-summary">
                <div className="import-stat success">
                  <span className="import-stat-value">
                    {importResults.updated}
                  </span>
                  <span className="import-stat-label">Channels Updated</span>
                </div>
                <div className="import-stat success">
                  <span className="import-stat-value">
                    {importResults.mapped}
                  </span>
                  <span className="import-stat-label">Channels Mapped</span>
                </div>
                {importResults.notFound > 0 && (
                  <div className="import-stat warning">
                    <span className="import-stat-value">
                      {importResults.notFound}
                    </span>
                    <span className="import-stat-label">Not Found</span>
                  </div>
                )}
              </div>

              {importResults.channelsInJsonNotInPlaylist.length > 0 && (
                <div className="import-not-found">
                  <h3>
                    📄 Channels in JSON file but not found in playlist (
                    {importResults.channelsInJsonNotInPlaylist.length})
                  </h3>
                  <p className="import-not-found-description">
                    These channels exist in your import file but couldn't be
                    matched with channels in the playlist.
                  </p>
                  <div className="import-not-found-list">
                    {importResults.channelsInJsonNotInPlaylist.map(
                      (ch, index) => (
                        <div key={index} className="import-not-found-item">
                          <span className="not-found-name">
                            {ch.channelName}
                          </span>
                          <span className="not-found-id">
                            ID: {ch.channelId}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

              {importResults.channelsInPlaylistNotInJson.length > 0 && (
                <div className="import-not-found">
                  <h3>
                    📺 Channels in playlist but not in JSON file (
                    {importResults.channelsInPlaylistNotInJson.length})
                  </h3>
                  <p className="import-not-found-description">
                    These channels exist in your playlist but were not included
                    in the import file.
                  </p>
                  <div className="import-not-found-list">
                    {importResults.channelsInPlaylistNotInJson.map(
                      (ch, index) => (
                        <div key={index} className="import-not-found-item">
                          <span className="not-found-name">
                            {ch.channelName}
                          </span>
                          <span className="not-found-id">
                            ID: {ch.channelId}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="import-results-footer">
              <button
                className="btn btn-primary"
                onClick={() => setImportResults(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showPlaylistSelectionModal && (
        <PlaylistSelectionModal
          playlists={allPlaylists}
          currentPlaylistId={playlist.id!}
          onSelect={handleImportFromPlaylist}
          onClose={() => setShowPlaylistSelectionModal(false)}
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

      {syncSummary && (
        <ConfirmModal
          title="Sync Summary"
          message={buildSyncSummaryMessage(syncSummary)}
          confirmText="OK"
          confirmVariant="success"
          onConfirm={handleSyncSummaryOk}
          onCancel={() => setSyncSummary(null)}
        />
      )}

      {/* Category selection modal for Xtream sync */}
      {showCategorySyncModal && (
        <div className="sync-blocking-overlay">
          <div className="sync-progress-modal category-sync-modal">
            <div className="sync-progress-header">
              <h2>📂 Select Categories to Sync</h2>
              <p className="sync-playlist-name">{playlist.name}</p>
              <p className="helper-description">
                Select one or more categories to include in the sync. None are
                selected by default.
              </p>
            </div>
            <div className="sync-progress-body category-list-body">
              <div className="category-actions">
                <button
                  className="btn btn-outline"
                  onClick={() => setCategorySyncSelection(new Set())}
                >
                  Clear All
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() =>
                    setCategorySyncSelection(
                      new Set(categories.map((c) => c.categoryId))
                    )
                  }
                >
                  Select All
                </button>
              </div>
              <div className="category-checkbox-list">
                {categories.map((cat) => (
                  <label key={cat.categoryId} className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={categorySyncSelection.has(cat.categoryId)}
                      onChange={(e) => {
                        const next = new Set(categorySyncSelection);
                        if (e.target.checked) {
                          next.add(cat.categoryId);
                        } else {
                          next.delete(cat.categoryId);
                        }
                        setCategorySyncSelection(next);
                      }}
                    />
                    <span>{cat.categoryName}</span>
                  </label>
                ))}
                {categories.length === 0 && (
                  <div className="empty-state">
                    No categories found for this playlist.
                  </div>
                )}
              </div>
            </div>
            <div className="sync-progress-footer">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setCategorySyncSelection(new Set());
                  setShowCategorySyncModal(false);
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={categorySyncSelection.size === 0}
                onClick={async () => {
                  setShowCategorySyncModal(false);
                  const selectedIds = [...categorySyncSelection];
                  try {
                    await api.setCategorySelection(playlist.id!, selectedIds);
                  } catch (e) {
                    console.error("Failed to persist category selection", e);
                  }
                  await startSync(selectedIds);
                }}
              >
                Start Sync
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full-screen blocking overlay during sync */}
      {syncing && (
        <div className="sync-blocking-overlay">
          <div className="sync-progress-modal">
            <div className="sync-progress-header">
              <h2>🔄 Syncing Playlist</h2>
              <p className="sync-playlist-name">{playlist.name}</p>
            </div>
            <div className="sync-progress-body">
              <div className="sync-progress-bar-container">
                <div
                  className="sync-progress-bar-fill"
                  style={{ width: `${syncProgress}%` }}
                >
                  <span className="sync-progress-percentage">
                    {syncProgress}%
                  </span>
                </div>
              </div>
              {syncMessage && (
                <p className="sync-progress-message">{syncMessage}</p>
              )}
              <div className="sync-progress-steps">
                <div
                  className={`sync-step ${syncProgress >= 0 ? "active" : ""} ${
                    syncProgress > 75 ? "completed" : ""
                  }`}
                >
                  <span className="step-icon">
                    {syncProgress > 75 ? "✓" : "1"}
                  </span>
                  <span className="step-label">Downloading from provider</span>
                </div>
                <div
                  className={`sync-step ${syncProgress >= 75 ? "active" : ""} ${
                    syncProgress > 95 ? "completed" : ""
                  }`}
                >
                  <span className="step-icon">
                    {syncProgress > 95 ? "✓" : "2"}
                  </span>
                  <span className="step-label">Preparing filtered data</span>
                </div>
                <div
                  className={`sync-step ${syncProgress >= 95 ? "active" : ""} ${
                    syncProgress >= 100 ? "completed" : ""
                  }`}
                >
                  <span className="step-icon">
                    {syncProgress >= 100 ? "✓" : "3"}
                  </span>
                  <span className="step-label">Finalizing</span>
                </div>
              </div>
            </div>
            <div className="sync-progress-footer">
              <p className="sync-warning">
                ⚠️ Please do not close this page or navigate away
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Full-screen blocking overlay during import */}
      {importing && (
        <div className="sync-blocking-overlay">
          <div className="sync-progress-modal">
            <div className="sync-progress-header">
              <h2>📥 Importing Channel Mappings</h2>
              <p className="sync-playlist-name">{playlist.name}</p>
            </div>
            <div className="sync-progress-body">
              <div className="sync-progress-bar-container">
                <div
                  className="sync-progress-bar-fill"
                  style={{ width: `${importProgress}%` }}
                >
                  <span className="sync-progress-percentage">
                    {importProgress}%
                  </span>
                </div>
              </div>
              {importMessage && (
                <p className="sync-progress-message">{importMessage}</p>
              )}
              <div className="sync-progress-steps">
                <div
                  className={`sync-step ${
                    importProgress >= 0 ? "active" : ""
                  } ${importProgress > 20 ? "completed" : ""}`}
                >
                  <span className="step-icon">
                    {importProgress > 20 ? "✓" : "1"}
                  </span>
                  <span className="step-label">Reading file</span>
                </div>
                <div
                  className={`sync-step ${
                    importProgress >= 20 ? "active" : ""
                  } ${importProgress > 90 ? "completed" : ""}`}
                >
                  <span className="step-icon">
                    {importProgress > 90 ? "✓" : "2"}
                  </span>
                  <span className="step-label">Mapping channels</span>
                </div>
                <div
                  className={`sync-step ${
                    importProgress >= 90 ? "active" : ""
                  } ${importProgress >= 100 ? "completed" : ""}`}
                >
                  <span className="step-icon">
                    {importProgress >= 100 ? "✓" : "3"}
                  </span>
                  <span className="step-label">Finalizing</span>
                </div>
              </div>
            </div>
            <div className="sync-progress-footer">
              <p className="sync-warning">
                ⚠️ Please do not close this page or navigate away
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input for JSON import - must be outside dropdown to persist */}
      {(() => {
        console.log("🎨 RENDERING file input element");
        return null;
      })()}
      <input
        id="import-file-input"
        type="file"
        accept=".json"
        onChange={handleImport}
        style={{ display: "none" }}
        onClick={() => console.log("🖱️ File input CLICKED")}
      />
    </div>
  );
}

export default PlaylistViewer;
