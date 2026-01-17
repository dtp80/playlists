export enum PlaylistType {
  XTREAM = "xtream",
  M3U = "m3u",
}

export enum UserRole {
  ADMIN = "ADMIN",
  USER = "USER",
  // Keep MEMBER as alias for backwards compatibility
  MEMBER = "USER",
}

export interface Playlist {
  id?: number;
  name: string;
  type: PlaylistType;
  url: string;
  username?: string;
  password?: string;
  createdAt?: string;
  updatedAt?: string;
  lastSyncedAt?: string;
  lastCategoriesSyncedAt?: string;
  lastChannelsSyncedAt?: string;
  channelCount?: number;
  filteredChannelCount?: number;
  categoryCount?: number;
  filteredCategoryCount?: number;
  identifierSource?: "channel-name" | "stream-url" | "metadata";
  identifierRegex?: string;
  identifierMetadataKey?: string;
  hiddenCategories?: string[];
  excludedChannels?: string[]; // Array of channel streamIds
  includeUncategorizedChannels?: boolean;
  externalAccessEnabled?: boolean;
  externalAccessToken?: string;
  uniqueId?: string;
  epgFileId?: number | null;
  epgGroupId?: number | null;
}

export interface EpgFile {
  id?: number;
  userId?: number;
  epgGroupId?: number | null;
  name: string;
  url: string;
  channelCount: number;
  isDefault: boolean;
  lastSyncedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface EpgGroup {
  id?: number;
  userId?: number;
  name: string;
  url: string;
  isDefault: boolean;
  epgFileIds?: number[]; // IDs of EPG files in this group
  totalChannelCount?: number; // Sum of all EPG files' channel counts
  createdAt?: string;
  updatedAt?: string;
}

export interface EpgImportJob {
  id: number;
  userId: number;
  epgFileId: number | null;
  name: string;
  url: string;
  status: string; // "pending", "downloading", "parsing", "importing", "completed", "failed"
  progress: number; // 0-100
  message: string | null;
  totalChannels: number;
  importedChannels: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportJob {
  id: number;
  userId: number;
  playlistId: number;
  status: string; // "pending", "processing", "completed", "failed"
  progress: number; // 0-100
  message: string | null;
  totalMappings: number;
  processedMappings: number;
  mapped: number;
  notFound: number;
  channelsInJsonNotInPlaylist: string | null; // JSON array
  channelsInPlaylistNotInJson: string | null; // JSON array
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Channel {
  id?: number;
  playlistId: number;
  streamId: string;
  name: string;
  streamUrl: string;
  streamIcon?: string;
  epgChannelId?: string;
  categoryId?: string;
  categoryName?: string;
  added?: string;
  duration?: string;
  tvgId?: string;
  tvgName?: string;
  tvgLogo?: string;
  groupTitle?: string;
  timeshift?: string;
  tvgRec?: string;
  tvgChno?: string;
  catchup?: string;
  catchupDays?: string;
  catchupSource?: string;
  catchupCorrection?: string;
  cuid?: string;
  xuiId?: string;
  channelMapping?: string; // JSON: { name: string, logo: string }
  isOperational?: boolean;
  isOperationalManual?: boolean;
  hasArchive?: boolean;
  hasArchiveManual?: boolean;
}

export interface Category {
  id?: number;
  playlistId: number;
  categoryId: string;
  categoryName: string;
  parentId?: number;
  isSelected?: number | boolean;
}

export interface User {
  id: number;
  email: string;
  role: UserRole;
  twoFactorEnabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthResponse {
  message?: string;
  requiresTwoFactor?: boolean;
  requires2FASetup?: boolean;
  user?: User;
}

export interface SettingsResponse {
  debugMode: boolean;
  bypass2FA: boolean;
  syncTimeout: number;
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramSendSummaries?: boolean;
}
