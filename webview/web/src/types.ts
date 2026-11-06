// src/types.ts
export interface Channel {
  name: string;        // 频道名，如 CCTV-1
  url: string;         // 播放地址
  group: string;       // 分组名，无分组为 "未分组"
  logo?: string;       // tvg-logo
  tvgId?: string;      // tvg-id（二期 EPG 用，先保留）
}

export interface PlaylistSource {
  id: string;          // crypto.randomUUID()
  name: string;        // 源名称（用户输入或文件名）
  url?: string;        // URL 订阅地址（文件导入为空）
  importedAt: number;  // Date.now()
  channels: Channel[];
}

export const UNGROUPED = '未分组';
