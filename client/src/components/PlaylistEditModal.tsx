import { useState, useEffect } from "react";
import { Playlist, Category, Channel, EpgFile, EpgGroup } from "../types";
import { api } from "../api";
import "./PlaylistEditModal.css";

interface Props {
  playlist: Playlist;
  onClose: () => void;
  onSave: () => void;
}

type TabType = "general" | "categories" | "excluded-channels" | "identifier";

function PlaylistEditModal({ playlist, onClose, onSave }: Props) {
  const initialTab = (playlist as any).initialTab as TabType | undefined;
  const [activeTab, setActiveTab] = useState<TabType>(
    initialTab &&
      ["general", "categories", "excluded-channels", "identifier"].includes(
        initialTab
      )
      ? initialTab
      : "general"
  );
  const [formData, setFormData] = useState({
    name: playlist.name,
    url: playlist.url,
    username: playlist.username || "",
    password: playlist.password || "",
    identifierSource: playlist.identifierSource || "channel-name",
    identifierRegex: playlist.identifierRegex || "",
    identifierMetadataKey: playlist.identifierMetadataKey || "tvg-id",
    externalAccessEnabled: playlist.externalAccessEnabled || false,
    externalAccessToken: playlist.externalAccessToken || "",
    epgFileId: playlist.epgFileId || null,
    epgGroupId: playlist.epgGroupId || null,
  });
  const [epgFiles, setEpgFiles] = useState<EpgFile[]>([]);
  const [epgGroups, setEpgGroups] = useState<EpgGroup[]>([]);
  const [loadingEpg, setLoadingEpg] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [hiddenCategories] = useState<Set<string>>(
    new Set(playlist.hiddenCategories || [])
  );
  const [syncSelection, setSyncSelection] = useState<Set<string>>(new Set());
  const [channels, setChannels] = useState<Channel[]>([]);
  const [excludedChannels, setExcludedChannels] = useState<Set<string>>(
    new Set(playlist.excludedChannels || [])
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [includeUncategorized, setIncludeUncategorized] = useState(
    playlist.includeUncategorizedChannels !== false
  );

  // Regex generator states
  const [sampleUrl, setSampleUrl] = useState("");
  const [expectedIdentifier, setExpectedIdentifier] = useState("");
  const [generatingRegex, setGeneratingRegex] = useState(false);
  const [regexResult, setRegexResult] = useState<{
    regex: string;
    explanation: string;
  } | null>(null);

  useEffect(() => {
    // Load EPG files when modal opens
    loadEpgFiles();
    // Preload categories so selection persists even if Categories tab is never opened
    loadCategories({ silent: true });
  }, []);

  useEffect(() => {
    if (activeTab === "categories") {
      if (!categoriesLoaded) {
        loadCategories();
      }
    } else if (activeTab === "excluded-channels") {
      loadChannels();
    } else if (
      activeTab === "identifier" &&
      formData.identifierSource === "stream-url"
    ) {
      // Auto-populate sample URL when identifier tab is opened
      loadFirstChannelUrl();
    }
  }, [activeTab]);

  const loadEpgFiles = async () => {
    try {
      setLoadingEpg(true);
      const [files, groups] = await Promise.all([
        api.getEpgFiles(),
        api.getEpgGroups(),
      ]);
      setEpgFiles(files);
      setEpgGroups(groups);
    } catch (err) {
      console.error("Failed to load EPG files:", err);
    } finally {
      setLoadingEpg(false);
    }
  };

  // Load first channel URL for sample
  useEffect(() => {
    if (
      formData.identifierSource === "stream-url" &&
      activeTab === "identifier"
    ) {
      loadFirstChannelUrl();
    }
  }, [formData.identifierSource]);

  const loadFirstChannelUrl = async () => {
    if (sampleUrl) return; // Don't override if user already has a sample URL

    try {
      const data = await api.getChannels(playlist.id!);
      if (data && data.length > 0) {
        const firstChannel = data[0];
        setSampleUrl(firstChannel.streamUrl || "");
      }
    } catch (err: any) {
      console.error("Failed to load first channel URL:", err);
    }
  };

  const loadCategories = async (options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) {
        setLoadingCategories(true);
      }
      const data = await api.getCategories(playlist.id!, { full: true });
      setCategories(data);
      setSyncSelection(
        new Set(
          data
            .filter((c) => c.isSelected === 1 || c.isSelected === true)
            .map((c) => c.categoryId)
        )
      );
      setCategoriesLoaded(true);
    } catch (err: any) {
      setError("Failed to load categories");
    } finally {
      if (!options?.silent) {
        setLoadingCategories(false);
      }
    }
  };

  const loadChannels = async () => {
    try {
      setLoadingChannels(true);
      const data = await api.getChannels(playlist.id!);
      setChannels(data);
    } catch (err: any) {
      setError("Failed to load channels");
    } finally {
      setLoadingChannels(false);
    }
  };

  const selectAllCategories = () => {
    setSyncSelection(new Set(categories.map((c) => c.categoryId)));
  };

  const unselectAllCategories = () => {
    setSyncSelection(new Set());
  };

  const toggleSyncSelection = (categoryId: string) => {
    const next = new Set(syncSelection);
    if (next.has(categoryId)) {
      next.delete(categoryId);
    } else {
      next.add(categoryId);
    }
    setSyncSelection(next);
  };

  const getFilteredCategories = () => {
    if (!categorySearch.trim()) {
      return categories;
    }
    const searchLower = categorySearch.toLowerCase();
    return categories.filter((cat) =>
      cat.categoryName.toLowerCase().includes(searchLower)
    );
  };

  const toggleExcludedChannel = (streamId: string) => {
    const newExcluded = new Set(excludedChannels);
    if (newExcluded.has(streamId)) {
      newExcluded.delete(streamId);
    } else {
      newExcluded.add(streamId);
    }
    setExcludedChannels(newExcluded);
  };

  const handleGenerateRegex = async () => {
    if (!sampleUrl || !expectedIdentifier) {
      setError("Please provide both sample URL and expected identifier");
      return;
    }

    try {
      setGeneratingRegex(true);
      setError(null);
      const result = await api.generateRegex(sampleUrl, expectedIdentifier);
      setRegexResult({
        regex: result.regex,
        explanation: result.explanation,
      });
      // Auto-fill the regex field
      setFormData({
        ...formData,
        identifierRegex: result.regex,
      });
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to generate regex");
      setRegexResult(null);
    } finally {
      setGeneratingRegex(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);

      // Validate M3U token if external access is enabled
      if (
        formData.externalAccessEnabled &&
        playlist.type === "m3u" &&
        !formData.externalAccessToken
      ) {
        setError(
          "Access token is required for M3U playlists with external access enabled"
        );
        return;
      }

      await api.updatePlaylist(playlist.id!, {
        name: formData.name,
        url: formData.url,
        username: formData.username || undefined,
        password: formData.password || undefined,
        identifierSource: formData.identifierSource || undefined,
        identifierRegex: formData.identifierRegex || undefined,
        identifierMetadataKey: formData.identifierMetadataKey || undefined,
        hiddenCategories: Array.from(hiddenCategories),
        excludedChannels: Array.from(excludedChannels),
        includeUncategorizedChannels: includeUncategorized,
        externalAccessEnabled: formData.externalAccessEnabled,
        externalAccessToken: formData.externalAccessToken || undefined,
        epgFileId: formData.epgFileId,
        epgGroupId: formData.epgGroupId,
      });

      // Persist category selection for Xtream channel syncs
      await api.setCategorySelection(
        playlist.id!,
        Array.from(syncSelection)
      );

      onSave();
      onClose();
    } catch (err: any) {
      setError(
        err.response?.data?.error || err.message || "Failed to update playlist"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>✏️ Edit Playlist</h2>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-tabs">
          <button
            className={`tab-btn ${activeTab === "general" ? "active" : ""}`}
            onClick={() => setActiveTab("general")}
          >
            General
          </button>
          <button
            className={`tab-btn ${activeTab === "categories" ? "active" : ""}`}
            onClick={() => setActiveTab("categories")}
          >
            Categories
          </button>
          <button
            className={`tab-btn ${
              activeTab === "excluded-channels" ? "active" : ""
            }`}
            onClick={() => setActiveTab("excluded-channels")}
          >
            Excluded Channels
          </button>
          <button
            className={`tab-btn ${activeTab === "identifier" ? "active" : ""}`}
            onClick={() => setActiveTab("identifier")}
          >
            Identifier
          </button>
        </div>

        <div className="modal-body">
          {error && <div className="error-message">{error}</div>}

          {activeTab === "general" && (
            <div className="tab-content">
              <div className="form-group">
                <label htmlFor="name">Playlist Name *</label>
                <input
                  type="text"
                  id="name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="url">URL *</label>
                <input
                  type="text"
                  id="url"
                  value={formData.url}
                  onChange={(e) =>
                    setFormData({ ...formData, url: e.target.value })
                  }
                  placeholder={
                    playlist.type === "xtream"
                      ? "http://example.com:8080"
                      : "http://example.com/playlist.m3u"
                  }
                  required
                />
              </div>

              {playlist.type === "xtream" && (
                <>
                  <div className="form-group">
                    <label htmlFor="username">Username</label>
                    <input
                      type="text"
                      id="username"
                      value={formData.username}
                      onChange={(e) =>
                        setFormData({ ...formData, username: e.target.value })
                      }
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="password">Password</label>
                    <input
                      type="password"
                      id="password"
                      value={formData.password}
                      onChange={(e) =>
                        setFormData({ ...formData, password: e.target.value })
                      }
                    />
                  </div>
                </>
              )}

              <div className="form-section">
                <h3 className="form-section-title">📺 EPG Selection</h3>
                <p className="form-section-description">
                  Choose which Electronic Program Guide (EPG) to use for this playlist.
                  The EPG provides channel information and program schedules.
                </p>

                {loadingEpg ? (
                  <div className="form-hint">Loading EPG files...</div>
                ) : epgFiles.length === 0 && epgGroups.length === 0 ? (
                  <div className="info-box" style={{ marginTop: "1rem" }}>
                    <strong>⚠️ No EPG Files Available</strong>
                    <p>
                      You haven't added any EPG files yet. EPG files provide channel
                      information and program guides for your IPTV channels.
                    </p>
                    <p>
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          onClose();
                          // Signal to open Settings modal on EPG tab
                          setTimeout(() => {
                            const settingsBtn = document.querySelector('[title="Settings"]') as HTMLElement;
                            if (settingsBtn) {
                              settingsBtn.click();
                              // Wait for modal to open, then switch to EPG tab
                              setTimeout(() => {
                                const epgTabBtn = document.querySelector('.tab-btn:nth-child(3)') as HTMLElement;
                                if (epgTabBtn) epgTabBtn.click();
                              }, 100);
                            }
                          }, 100);
                        }}
                        style={{ color: "var(--primary-color)", textDecoration: "underline" }}
                      >
                        Click here to add an EPG file in Settings →  EPG tab
                      </a>
                    </p>
                  </div>
                ) : (
                  <div className="form-group">
                    <label htmlFor="epgSource">EPG Source</label>
                    <select
                      id="epgSource"
                      value={
                        formData.epgGroupId
                          ? `group-${formData.epgGroupId}`
                          : formData.epgFileId
                          ? `file-${formData.epgFileId}`
                          : ""
                      }
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value.startsWith("file-")) {
                          setFormData({
                            ...formData,
                            epgFileId: parseInt(value.replace("file-", "")),
                            epgGroupId: null,
                          });
                        } else if (value.startsWith("group-")) {
                          setFormData({
                            ...formData,
                            epgFileId: null,
                            epgGroupId: parseInt(value.replace("group-", "")),
                          });
                        } else {
                          setFormData({
                            ...formData,
                            epgFileId: null,
                            epgGroupId: null,
                          });
                        }
                      }}
                    >
                      <option value="">
                        Use Default EPG (⭐{" "}
                        {epgFiles.find(f => f.isDefault)?.name || 
                         epgGroups.find(g => g.isDefault)?.name || 
                         epgFiles[0]?.name || 
                         epgGroups[0]?.name || 
                         "None"})
                      </option>
                      {epgFiles.length > 0 && <optgroup label="EPG Files">
                        {epgFiles.map((epgFile) => (
                          <option key={`file-${epgFile.id}`} value={`file-${epgFile.id}`}>
                            {epgFile.isDefault ? "⭐ " : ""}
                            {epgFile.name}
                          </option>
                        ))}
                      </optgroup>}
                      {epgGroups.length > 0 && <optgroup label="EPG Groups">
                        {epgGroups.map((epgGroup) => (
                          <option key={`group-${epgGroup.id}`} value={`group-${epgGroup.id}`}>
                            {epgGroup.isDefault ? "⭐ " : ""}
                            🗂️ {epgGroup.name}
                          </option>
                        ))}
                      </optgroup>}
                    </select>
                    <small className="form-hint">
                      {formData.epgGroupId
                        ? `Using EPG group "${epgGroups.find((g) => g.id === formData.epgGroupId)?.name}" for channel information.`
                        : formData.epgFileId
                        ? `Using "${epgFiles.find((f) => f.id === formData.epgFileId)?.name}" for channel information.`
                        : `Using the default EPG (${
                            epgFiles.find(f => f.isDefault)?.name || 
                            epgGroups.find(g => g.isDefault)?.name || 
                            epgFiles[0]?.name || 
                            epgGroups[0]?.name
                          }) for channel information. This EPG will be used for exports and external access.`}
                    </small>
                  </div>
                )}
              </div>

              <div className="form-section">
                <h3 className="form-section-title">🌐 External Access</h3>
                <p className="form-section-description">
                  Enable external access to allow IPTV players to stream
                  directly from this playlist without downloading files.
                </p>

                <div className="form-group">
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={formData.externalAccessEnabled}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          externalAccessEnabled: e.target.checked,
                        })
                      }
                    />
                    <span className="toggle-text">Enable External Access</span>
                  </label>
                  <small className="form-hint">
                    When enabled, IPTV players can access your playlist using a
                    secure link. Disable this to prevent external access.
                  </small>
                </div>

                {formData.externalAccessEnabled && playlist.type === "m3u" && (
                  <div className="form-group">
                    <label htmlFor="externalAccessToken">
                      M3U Access Token *
                    </label>
                    <input
                      type="text"
                      id="externalAccessToken"
                      value={formData.externalAccessToken}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          externalAccessToken: e.target.value,
                        })
                      }
                      placeholder="Enter the token provided by your IPTV provider"
                      required
                    />
                    <small className="form-hint">
                      This token is required to authenticate access to your M3U
                      playlist. Get this from your IPTV provider.
                    </small>
                  </div>
                )}

                {formData.externalAccessEnabled &&
                  playlist.type === "xtream" && (
                    <div className="info-box">
                      <strong>ℹ️ Xtream Codes Authentication</strong>
                      <p>
                        Your existing username and password will be used for
                        authentication. No additional token is needed.
                      </p>
                    </div>
                  )}
              </div>
            </div>
          )}

          {activeTab === "categories" && (
            <div className="tab-content">
              <p className="tab-description">
                Hide categories to exclude their channels from the channel list
                and exports.
              </p>

              <div className="uncategorized-option">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={includeUncategorized}
                    onChange={(e) => setIncludeUncategorized(e.target.checked)}
                  />
                  <span className="uncategorized-label">
                    Include uncategorized channels in filtered results
                  </span>
                </label>
                <p className="uncategorized-hint">
                  When enabled, channels without a category will be shown even
                  when category filters are active.
                </p>
              </div>

              {loadingCategories ? (
                <div className="loading">Loading categories...</div>
              ) : categories.length === 0 ? (
                <div className="empty-message">
                  No categories found. Sync the playlist first.
                </div>
              ) : (
                <>
                  <div className="category-search-container">
                    <input
                      type="text"
                      className="category-search-input"
                      placeholder="🔍 Search categories..."
                      value={categorySearch}
                      onChange={(e) => setCategorySearch(e.target.value)}
                    />
                    {categorySearch && (
                      <button
                        type="button"
                        className="btn-clear-search"
                        onClick={() => setCategorySearch("")}
                        title="Clear search"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="category-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={selectAllCategories}
                    >
                      ✓ Select All
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={unselectAllCategories}
                    >
                      ✗ Unselect All
                    </button>
                    <span className="category-count">
                      {categories.length - hiddenCategories.size} of{" "}
                      {categories.length} visible
                      {categorySearch && (
                        <span className="search-results-count">
                          {" "}
                          ({getFilteredCategories().length} found)
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="category-list">
                    {getFilteredCategories().map((category) => (
                      <div key={category.categoryId} className="category-item">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={syncSelection.has(category.categoryId)}
                            onChange={() =>
                              toggleSyncSelection(category.categoryId)
                            }
                          />
                          <span className="category-name">
                            {category.categoryName}
                          </span>
                        </label>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "excluded-channels" && (
            <div className="tab-content">
              <p className="tab-description">
                Manage channels that are excluded from the main view and
                exports. Click "Include" to remove a channel from the exclusion
                list.
              </p>

              {loadingChannels ? (
                <div className="loading">Loading channels...</div>
              ) : (
                <>
                  <div className="excluded-channels-header">
                    <span className="excluded-count">
                      {excludedChannels.size} channel(s) excluded
                    </span>
                  </div>

                  {excludedChannels.size === 0 ? (
                    <div className="empty-message">
                      No channels excluded. You can exclude channels from the
                      main channel view.
                    </div>
                  ) : (
                    <div className="excluded-channels-list">
                      {channels
                        .filter((ch) => excludedChannels.has(ch.streamId))
                        .map((channel) => (
                          <div
                            key={channel.streamId}
                            className="excluded-channel-item"
                          >
                            <div className="excluded-channel-info">
                              {channel.streamIcon && (
                                <img
                                  src={channel.streamIcon}
                                  alt={channel.name}
                                  className="excluded-channel-icon"
                                />
                              )}
                              <div className="excluded-channel-details">
                                <div className="excluded-channel-name">
                                  {channel.name}
                                </div>
                                {channel.categoryName && (
                                  <div className="excluded-channel-category">
                                    {channel.categoryName}
                                  </div>
                                )}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() =>
                                toggleExcludedChannel(channel.streamId)
                              }
                            >
                              ✓ Include
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {activeTab === "identifier" && (
            <div className="tab-content">
              <p className="tab-description">
                Configure the parameter that can identify each channel
                individually. This will be helpful when you define multiple
                playlists from the same provider to copy channel mapping between
                them.
              </p>

              <div className="form-group">
                <label>Identifier Source</label>
                <div className="radio-group">
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="identifierSource"
                      value="channel-name"
                      checked={formData.identifierSource === "channel-name"}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          identifierSource: e.target.value as any,
                        })
                      }
                    />
                    <span>Extract Channel Name</span>
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="identifierSource"
                      value="stream-url"
                      checked={formData.identifierSource === "stream-url"}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          identifierSource: e.target.value as any,
                        })
                      }
                    />
                    <span>Extract from Stream URL</span>
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="identifierSource"
                      value="metadata"
                      checked={formData.identifierSource === "metadata"}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          identifierSource: e.target.value as any,
                        })
                      }
                    />
                    <span>Extract from Metadata Tag</span>
                  </label>
                </div>
              </div>

              {formData.identifierSource === "channel-name" && (
                <div className="identifier-info">
                  <div className="info-box">
                    <strong>ℹ️ Channel Name Identifier</strong>
                    <p>
                      The full channel name will be used as the unique
                      identifier for mapping. No regex extraction is needed.
                    </p>
                  </div>
                </div>
              )}

              {formData.identifierSource === "stream-url" && (
                <>
                  <div className="regex-generator">
                    <h4>🎯 Regex Generator Helper</h4>
                    <p className="helper-description">
                      Provide the identifier value you want to extract from the
                      stream URL below, and we'll generate the regex for you!
                    </p>

                    <div className="form-group">
                      <label htmlFor="sampleUrl">Sample Stream URL</label>
                      <input
                        type="text"
                        id="sampleUrl"
                        value={sampleUrl}
                        onChange={(e) => setSampleUrl(e.target.value)}
                        placeholder="e.g., http://example.com/play/12345/video.m3u8"
                      />
                      <small className="form-hint">
                        Automatically loaded from first channel in playlist
                      </small>
                    </div>

                    <div className="form-group">
                      <label htmlFor="expectedIdentifier">
                        Expected Identifier Value
                      </label>
                      <input
                        type="text"
                        id="expectedIdentifier"
                        value={expectedIdentifier}
                        onChange={(e) => setExpectedIdentifier(e.target.value)}
                        placeholder="e.g., 12345"
                      />
                      <small className="form-hint">
                        Enter the exact value you want to extract from the URL
                        above.
                      </small>
                    </div>

                    <div className="regex-generator-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={handleGenerateRegex}
                        disabled={
                          generatingRegex || !sampleUrl || !expectedIdentifier
                        }
                      >
                        {generatingRegex
                          ? "Generating..."
                          : "✨ Generate Regex"}
                      </button>
                      {regexResult && (
                        <button
                          type="button"
                          className="btn btn-outline"
                          onClick={() => {
                            setRegexResult(null);
                            setFormData({
                              ...formData,
                              identifierRegex: "",
                            });
                          }}
                        >
                          🔄 Reset
                        </button>
                      )}
                    </div>

                    {regexResult && (
                      <div className="regex-result">
                        <div className="result-success">
                          ✓ Regex generated successfully!
                        </div>
                        <div className="result-explanation">
                          {regexResult.explanation}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <label htmlFor="identifierRegex">Extraction Regex</label>
                    <input
                      type="text"
                      id="identifierRegex"
                      value={formData.identifierRegex}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          identifierRegex: e.target.value,
                        })
                      }
                      placeholder="e.g., /(\d+)\\.m3u8 or /play/(\\d+)/"
                      readOnly={!!regexResult}
                      className={regexResult ? "readonly-input" : ""}
                    />
                    <small className="form-hint">
                      {regexResult
                        ? "Generated regex (locked). Clear the helper above to edit manually."
                        : "Use capturing groups () to extract the identifier. The first captured group will be used as the identifier."}
                    </small>
                  </div>
                </>
              )}

              {formData.identifierSource === "metadata" && (
                <div className="form-group">
                  <label htmlFor="identifierMetadataKey">Metadata Key</label>
                  <select
                    id="identifierMetadataKey"
                    value={formData.identifierMetadataKey}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        identifierMetadataKey: e.target.value,
                      })
                    }
                  >
                    <option value="tvg-id">tvg-id</option>
                    <option value="tvg-name">tvg-name</option>
                    <option value="tvg-logo">tvg-logo</option>
                    <option value="group-title">group-title</option>
                    <option value="tvg-rec">tvg-rec</option>
                    <option value="tvg-chno">tvg-chno</option>
                    <option value="timeshift">timeshift</option>
                    <option value="catchup">catchup</option>
                    <option value="catchup-days">catchup-days</option>
                    <option value="catchup-source">catchup-source</option>
                    <option value="catchup-correction">
                      catchup-correction
                    </option>
                    <option value="xui-id">xui-id</option>
                  </select>
                  <small className="form-hint">
                    Select which M3U metadata tag to use as the identifier.
                  </small>
                </div>
              )}

              <div className="regex-examples">
                <h4>Examples:</h4>
                <ul>
                  <li>
                    <strong>Channel Name:</strong> <code>^([A-Z]+)</code> -
                    Extracts uppercase letters at the start
                  </li>
                  <li>
                    <strong>Stream URL:</strong> <code>/(\d+)\.m3u8</code> -
                    Extracts numbers before .m3u8
                  </li>
                  <li>
                    <strong>Metadata:</strong> Use tvg-id or tvg-name for unique
                    channel identifiers
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || !formData.name || !formData.url}
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PlaylistEditModal;
