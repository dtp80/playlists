// Re-export Prisma types
export type {
  Playlist,
  Channel,
  Category,
  User,
  ChannelLineup,
  EpgFile,
  EpgGroup,
} from "@prisma/client";

// Playlist types
export type PlaylistType = "m3u" | "xtream";

// User types
export enum UserRole {
  USER = "USER",
  ADMIN = "ADMIN",
}

// User response type (without sensitive data)
export interface UserResponse {
  id: number;
  email: string;
  role: UserRole;
  createdAt: Date | string;
}

// Auth request types
export interface LoginRequest {
  email: string;
  password: string;
}

export interface TwoFactorVerifyRequest {
  token: string;
}

// XtreamCodes types
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
  xui_id?: number;
  stream_icon: string;
  epg_channel_id: string;
  added: string;
  category_id: string;
  custom_sid: string;
  tv_archive: number;
  direct_source: string;
  tv_archive_duration: number;
}
