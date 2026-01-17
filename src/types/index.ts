export enum PlaylistType {
  XTREAM = "xtream",
  M3U = "m3u",
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
  identifierSource?: string; // "channel-name" | "stream-url" | "metadata"
  identifierRegex?: string;
  identifierMetadataKey?: string; // "tvg-id" | "tvg-name" | etc.
  hiddenCategories?: string;
  excludedChannels?: string; // JSON array of channel streamIds
  includeUncategorizedChannels?: number; // 0 or 1 (boolean in SQLite)
  externalAccessEnabled?: number; // 0 or 1 (boolean in SQLite)
  externalAccessToken?: string;
  uniqueId?: string;
  epgFileId?: number | null; // Reference to EPG file (null = use default)
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
  duration?: string; // EXTINF duration value (e.g., "-1", "0")
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
}

export interface XtreamCredentials {
  url: string;
  username: string;
  password: string;
}

export interface XtreamAuthResponse {
  user_info: {
    username: string;
    password: string;
    message: string;
    auth: number;
    status: string;
    exp_date: string;
    is_trial: string;
    active_cons: string;
    created_at: string;
    max_connections: string;
    allowed_output_formats: string[];
  };
  server_info: {
    url: string;
    port: string;
    https_port: string;
    server_protocol: string;
    rtmp_port: string;
    timezone: string;
    timestamp_now: number;
    time_now: string;
  };
}

export interface XtreamCategory {
  category_id: string;
  category_name: string;
  parent_id: number;
}

export interface XtreamChannel {
  num: number;
  name: string;
  stream_type: string;
  stream_id: number;
  stream_icon: string;
  epg_channel_id: string;
  added: string;
  is_adult: string;
  category_id: string;
  custom_sid: string;
  tv_archive: number;
  direct_source: string;
  tv_archive_duration: number;
  category_ids: number[];
  xui_id?: string | number; // Some providers include this
}

export enum UserRole {
  ADMIN = "Admin",
  MEMBER = "Member",
}

export interface User {
  id?: number;
  email: string;
  password: string; // Hashed
  role: UserRole;
  twoFactorSecret?: string;
  twoFactorEnabled: boolean; // Converted from 0/1 in database
  createdAt?: string;
  updatedAt?: string;
}

export interface UserResponse {
  id: number;
  email: string;
  role: UserRole;
  twoFactorEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface TwoFactorSetupResponse {
  secret: string;
  qrCode: string;
}

export interface TwoFactorVerifyRequest {
  token: string;
}

export interface AuthResponse {
  user: UserResponse;
  requiresTwoFactor?: boolean;
  requires2FASetup?: boolean;
}
