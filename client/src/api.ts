import axios from "axios";
import { Playlist, Channel, Category, EpgFile, EpgGroup, ImportJob } from "./types";

const API_BASE = "/api";

// Local mode: no authentication cookies required
axios.defaults.withCredentials = false;

export const api = {
  // Playlists
  getPlaylists: async (): Promise<Playlist[]> => {
    const response = await axios.get(`${API_BASE}/playlists`);
    return response.data;
  },

  getPlaylist: async (id: number): Promise<Playlist> => {
    const response = await axios.get(`${API_BASE}/playlists/${id}`);
    return response.data;
  },

  createPlaylist: async (playlist: Playlist): Promise<Playlist> => {
    const response = await axios.post(`${API_BASE}/playlists`, playlist);
    return response.data;
  },

  updatePlaylist: async (
    id: number,
    playlist: Partial<Playlist>
  ): Promise<Playlist> => {
    const response = await axios.put(`${API_BASE}/playlists/${id}`, playlist);
    return response.data;
  },

  deletePlaylist: async (id: number): Promise<void> => {
    await axios.delete(`${API_BASE}/playlists/${id}`);
  },

  reorderPlaylists: async (
    playlists: Array<{ id: number; sortOrder: number }>
  ): Promise<void> => {
    await axios.put(`${API_BASE}/playlists/reorder`, { playlists });
  },

  syncPlaylist: async (
    id: number
  ): Promise<{
    success: boolean;
    jobId: number;
    message: string;
  }> => {
    const response = await axios.post(`${API_BASE}/playlists/${id}/sync`);
    return response.data;
  },

  getPlaylistSyncJob: async (
    playlistId: number,
    jobId: number
  ): Promise<any> => {
    const response = await axios.get(
      `${API_BASE}/playlists/${playlistId}/sync/job/${jobId}`
    );
    return response.data;
  },

  cleanupStuckSyncJobs: async (
    playlistId: number
  ): Promise<{
    success: boolean;
    cleaned: number;
    message: string;
  }> => {
    const response = await axios.delete(
      `${API_BASE}/playlists/${playlistId}/sync/cleanup`
    );
    return response.data;
  },

  // Categories
  getCategories: async (
    playlistId: number,
    options?: { full?: boolean }
  ): Promise<Category[]> => {
    const params = options?.full ? { full: "true" } : {};
    const response = await axios.get(
      `${API_BASE}/playlists/${playlistId}/categories`,
      { params }
    );
    return response.data;
  },

  // Channels
  getChannels: async (
    playlistId: number,
    categoryId?: string,
    search?: string,
    options?: { includeExcluded?: boolean }
  ): Promise<Channel[]> => {
    const params = new URLSearchParams();
    if (categoryId) params.append("categoryId", categoryId);
    if (search) params.append("search", search);
    if (options?.includeExcluded) params.append("includeExcluded", "true");
    // Skip pagination to get all channels (for backward compatibility)
    params.append("skipPagination", "true");

    const response = await axios.get(
      `${API_BASE}/playlists/${playlistId}/channels?${params}`
    );
    // Handle new pagination response format
    return response.data.channels || response.data;
  },

  updateChannelFlags: async (
    playlistId: number,
    streamId: string,
    flags: { isOperational?: boolean; hasArchive?: boolean }
  ): Promise<{ success: boolean }> => {
    const response = await axios.put(
      `${API_BASE}/playlists/${playlistId}/channels/${streamId}/flags`,
      flags
    );
    return response.data;
  },

  // Export
  exportPlaylist: async (playlistId: number): Promise<Blob> => {
    const response = await axios.get(
      `${API_BASE}/playlists/${playlistId}/export`,
      { responseType: "blob" }
    );
    return response.data;
  },

  exportCustom: async (
    playlistId: number,
    channelIds?: string[],
    categoryIds?: string[]
  ): Promise<Blob> => {
    const response = await axios.post(
      `${API_BASE}/playlists/${playlistId}/export-custom`,
      { channelIds, categoryIds },
      { responseType: "blob" }
    );
    return response.data;
  },

  exportPlaylistJSON: async (playlistId: number): Promise<Blob> => {
    const response = await axios.get(
      `${API_BASE}/playlists/${playlistId}/export-json`,
      { responseType: "blob" }
    );
    return response.data;
  },

  exportCustomJSON: async (
    playlistId: number,
    channelIds?: string[],
    categoryIds?: string[]
  ): Promise<Blob> => {
    const response = await axios.post(
      `${API_BASE}/playlists/${playlistId}/export-json-custom`,
      { channelIds, categoryIds },
      { responseType: "blob" }
    );
    return response.data;
  },

  // Channel Lineup
  getChannelLineup: async (
    params?: { epgFileId?: number; epgGroupId?: number }
  ): Promise<
    Array<{ name: string; logo: string; tvgId?: string; extGrp?: string }>
  > => {
    const response = await axios.get(`${API_BASE}/channel-lineup`, {
      params: params || {},
    });
    return response.data;
  },

  // Channel Mapping
  updateChannelMapping: async (
    playlistId: number,
    streamId: string,
    mapping: { name: string; logo: string; tvgId?: string; extGrp?: string }
  ): Promise<void> => {
    await axios.put(
      `${API_BASE}/playlists/${playlistId}/channels/${streamId}/mapping`,
      mapping
    );
  },

  removeChannelMapping: async (
    playlistId: number,
    streamId: string
  ): Promise<void> => {
    await axios.delete(
      `${API_BASE}/playlists/${playlistId}/channels/${streamId}/mapping`
    );
  },

  // Admin Channel Lineup Management
  getAdminChannelLineup: async (
    epgFileId?: number
  ): Promise<
    Array<{
      id: number;
      name: string;
      tvgLogo: string | null;
      tvgId: string | null;
      extGrp: string | null;
      sortOrder: number;
      epgFileId: number | null;
    }>
  > => {
    const params = epgFileId ? { epgFileId } : {};
    const response = await axios.get(`${API_BASE}/channel-lineup/admin`, {
      params,
    });
    return response.data;
  },

  getChannelLineupCategories: async (
    epgFileId?: number
  ): Promise<Array<{ name: string }>> => {
    const params = epgFileId ? { epgFileId } : {};
    const response = await axios.get(`${API_BASE}/channel-lineup/categories`, {
      params,
    });
    return response.data;
  },

  createChannelLineup: async (channel: {
    name: string;
    tvgLogo?: string;
    tvgId?: string;
    extGrp?: string;
  }): Promise<any> => {
    const response = await axios.post(`${API_BASE}/channel-lineup`, channel);
    return response.data;
  },

  updateChannelLineup: async (
    id: number,
    channel: {
      name: string;
      tvgLogo?: string;
      tvgId?: string;
      extGrp?: string;
    }
  ): Promise<any> => {
    const response = await axios.put(
      `${API_BASE}/channel-lineup/${id}`,
      channel
    );
    return response.data;
  },

  deleteChannelLineup: async (id: number): Promise<void> => {
    await axios.delete(`${API_BASE}/channel-lineup/${id}`);
  },

  reorderChannelLineup: async (
    channels: Array<{ id: number; sortOrder: number }>
  ): Promise<void> => {
    await axios.put(`${API_BASE}/channel-lineup/reorder`, { channels });
  },

  renameCategory: async (
    oldName: string,
    newName: string
  ): Promise<{ success: boolean; updatedCount: number; message: string }> => {
    const response = await axios.put(
      `${API_BASE}/channel-lineup/category/rename`,
      {
        oldName,
        newName,
      }
    );
    return response.data;
  },

  importPlaylistChannels: async (
    playlistId: number,
    channels: any[]
  ): Promise<{
    success: boolean;
    jobId: number;
    message: string;
  }> => {
    const response = await axios.post(
      `${API_BASE}/playlists/${playlistId}/import`,
      { channels }
    );
    return response.data;
  },

  getImportJob: async (playlistId: number, jobId: number): Promise<ImportJob> => {
    const response = await axios.get(
      `${API_BASE}/playlists/${playlistId}/import/job/${jobId}`
    );
    return response.data;
  },

  copyPlaylistMappings: async (
    sourcePlaylistId: number,
    targetPlaylistId: number
  ): Promise<{
    success: boolean;
    updated: number;
    mapped: number;
    notFound: number;
    notFoundChannels: Array<{ channelName: string; channelId: any }>;
    message: string;
  }> => {
    const response = await axios.post(
      `${API_BASE}/playlists/${targetPlaylistId}/copy-mappings`,
      { sourcePlaylistId }
    );
    return response.data;
  },

  // Settings API
  getSettings: async (): Promise<{
    debugMode: boolean;
    bypass2FA: boolean;
    syncTimeout: number;
    telegramBotToken?: string;
    telegramChatId?: string;
    telegramSendSummaries?: boolean;
  }> => {
    const response = await axios.get(`${API_BASE}/settings`);
    return response.data;
  },

  updateSettings: async (settings: {
    debugMode?: boolean;
    bypass2FA?: boolean;
    syncTimeout?: number;
    telegramBotToken?: string;
    telegramChatId?: string;
    telegramSendSummaries?: boolean;
  }): Promise<{ success: boolean }> => {
    const response = await axios.put(`${API_BASE}/settings`, settings);
    return response.data;
  },

  // Auth API
  login: async (credentials: { email: string; password: string }) => {
    const response = await axios.post(`${API_BASE}/auth/login`, credentials, {
      withCredentials: true,
    });
    return response.data;
  },

  verify2FA: async (token: string) => {
    const response = await axios.post(
      `${API_BASE}/auth/2fa/verify`,
      { token },
      {
        withCredentials: true,
      }
    );
    return response.data;
  },

  setup2FA: async (email: string) => {
    const response = await axios.post(
      `${API_BASE}/auth/2fa/setup`,
      { email },
      {
        withCredentials: true,
      }
    );
    return response.data;
  },

  getCurrentUser: async () => {
    const response = await axios.get(`${API_BASE}/auth/me`, {
      withCredentials: true,
    });
    return response.data;
  },

  logout: async () => {
    const response = await axios.post(
      `${API_BASE}/auth/logout`,
      {},
      {
        withCredentials: true,
      }
    );
    return response.data;
  },

  // User Management API
  getUsers: async () => {
    const response = await axios.get(`${API_BASE}/users`, {
      withCredentials: true,
    });
    return response.data;
  },

  createUser: async (userData: {
    email: string;
    password: string;
    role: string;
  }) => {
    const response = await axios.post(`${API_BASE}/users`, userData, {
      withCredentials: true,
    });
    return response.data;
  },

  updateUser: async (
    id: number,
    userData: { email?: string; role?: string }
  ) => {
    const response = await axios.put(`${API_BASE}/users/${id}`, userData, {
      withCredentials: true,
    });
    return response.data;
  },

  deleteUser: async (id: number) => {
    const response = await axios.delete(`${API_BASE}/users/${id}`, {
      withCredentials: true,
    });
    return response.data;
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    const response = await axios.put(
      `${API_BASE}/auth/change-password`,
      { currentPassword, newPassword },
      {
        withCredentials: true,
      }
    );
    return response.data;
  },

  reset2FA: async (userId: number) => {
    const response = await axios.post(
      `${API_BASE}/users/${userId}/reset-2fa`,
      {},
      {
        withCredentials: true,
      }
    );
    return response.data;
  },

  updateUserRole: async (userId: number, role: string) => {
    const response = await axios.put(
      `${API_BASE}/users/${userId}`,
      { role },
      {
        withCredentials: true,
      }
    );
    return response.data;
  },

  updateUserPassword: async (userId: number, newPassword: string) => {
    const response = await axios.put(
      `${API_BASE}/users/${userId}/password`,
      { password: newPassword },
      {
        withCredentials: true,
      }
    );
    return response.data;
  },

  generateRegex: async (sampleUrl: string, expectedIdentifier: string) => {
    const response = await axios.post(
      `${API_BASE}/playlists/generate-regex`,
      { sampleUrl, expectedIdentifier },
      {
        withCredentials: true,
      }
    );
    return response.data;
  },

  syncPlaylistWithCategories: async (
    playlistId: number,
    categoryIds: string[]
  ) => {
    const response = await axios.post(
      `${API_BASE}/playlists/${playlistId}/sync`,
      { categoryIds },
      {
        withCredentials: true,
      }
    );
    return response.data;
  },

  syncCategories: async (playlistId: number) => {
    const response = await axios.post(
      `${API_BASE}/playlists/${playlistId}/sync-categories`,
      {},
      {
        withCredentials: true,
      }
    );
    return response.data;
  },

  // Schedule
  getSchedule: async (): Promise<
    Array<{ playlistId: number; enabled: boolean; time: string }>
  > => {
    const response = await axios.get(`${API_BASE}/schedule`, {
      withCredentials: true,
    });
    return response.data.schedule || [];
  },

  saveSchedule: async (
    schedule: Array<{ playlistId: number; enabled: boolean; time: string }>
  ): Promise<void> => {
    await axios.post(
      `${API_BASE}/schedule`,
      { schedule },
      { withCredentials: true }
    );
  },

  // Telegram test
  testTelegram: async (params: { botToken: string; chatId: string }) => {
    const response = await axios.post(
      `${API_BASE}/settings/telegram/test`,
      params,
      { withCredentials: true }
    );
    return response.data;
  },

  setCategorySelection: async (
    playlistId: number,
    categoryIds: string[]
  ) => {
    const response = await axios.post(
      `${API_BASE}/playlists/${playlistId}/categories/select`,
      { categoryIds },
      {
        withCredentials: true,
      }
    );
    return response.data;
  },

  // EPG Files API
  getEpgFiles: async () => {
    const response = await axios.get(`${API_BASE}/epg`);
    return response.data;
  },

  createEpgFile: async (
    name: string,
    url: string
  ): Promise<{
    success: boolean;
    jobId: number;
    status: string;
    progress: number;
    message: string;
  }> => {
    const response = await axios.post(`${API_BASE}/epg`, { name, url });
    return response.data;
  },

  getEpgImportJob: async (jobId: number): Promise<any> => {
    const response = await axios.get(`${API_BASE}/epg/job/${jobId}`);
    return response.data;
  },

  updateEpgFile: async (
    id: number,
    data: { name?: string; url?: string }
  ): Promise<any> => {
    const response = await axios.put(`${API_BASE}/epg/${id}`, data);
    return response.data;
  },

  deleteEpgFile: async (id: number): Promise<void> => {
    await axios.delete(`${API_BASE}/epg/${id}`);
  },

  importEpgJson: async (id: number, data: any): Promise<{ success: boolean; updated: number }> => {
    const response = await axios.post(`${API_BASE}/epg/${id}/import-json`, data);
    return response.data;
  },

  exportEpgJson: async (id: number, filtered: boolean): Promise<Blob> => {
    const response = await axios.get(`${API_BASE}/epg/${id}/export-json`, {
      params: { filtered },
      responseType: "blob",
    });
    return response.data;
  },

  exportEpgXmltv: async (id: number, filtered: boolean): Promise<Blob> => {
    const response = await axios.get(`${API_BASE}/epg/${id}/export-xmltv`, {
      params: { filtered },
      responseType: "blob",
    });
    return response.data;
  },

  syncEpgFile: async (
    id: number
  ): Promise<{
    success: boolean;
    jobId: number;
    status: string;
    progress: number;
    message: string;
  }> => {
    const response = await axios.post(`${API_BASE}/epg/${id}/sync`);
    return response.data;
  },

  setDefaultEpgFile: async (id: number): Promise<EpgFile> => {
    const response = await axios.put(`${API_BASE}/epg/${id}/set-default`);
    return response.data;
  },

  // EPG Groups
  getEpgGroups: async (): Promise<EpgGroup[]> => {
    const response = await axios.get(`${API_BASE}/epg/groups`);
    return response.data;
  },

  createEpgGroup: async (data: {
    name: string;
    url: string;
    epgFileIds: number[];
  }): Promise<EpgGroup> => {
    const response = await axios.post(`${API_BASE}/epg/groups`, data);
    return response.data;
  },

  updateEpgGroup: async (
    id: number,
    data: {
      name?: string;
      url?: string;
      epgFileIds?: number[];
    }
  ): Promise<EpgGroup> => {
    const response = await axios.put(`${API_BASE}/epg/groups/${id}`, data);
    return response.data;
  },

  deleteEpgGroup: async (id: number): Promise<void> => {
    await axios.delete(`${API_BASE}/epg/groups/${id}`);
  },

  setDefaultEpgGroup: async (id: number): Promise<EpgGroup> => {
    const response = await axios.put(
      `${API_BASE}/epg/groups/${id}/set-default`
    );
    return response.data;
  },
};
