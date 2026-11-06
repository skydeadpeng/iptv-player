// src/m3u/parser.ts
import { Channel, UNGROUPED } from '../types';

/**
 * 解析 M3U 文本为频道数组。
 * 规则：#EXTINF 属性取 tvg-id/tvg-logo/group-title；其后第一个非注释非空行为 URL。
 * 属性区与显示名以"最后一个不在双引号内的逗号"为界（属性值可含逗号）。
 */
export function parseM3U(text: string): Channel[] {
  const lines = text.split(/\r?\n/);
  const channels: Channel[] = [];
  let pending: Partial<Channel> | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#EXTM3U') || (line.startsWith('#') && !line.startsWith('#EXTINF'))) continue;
    if (line.startsWith('#EXTINF')) {
      pending = parseExtInf(line);
      continue;
    }
    if (pending) {
      channels.push({
        name: pending.name || '未知频道',
        url: line,
        group: pending.group ?? UNGROUPED,
        logo: pending.logo,
        tvgId: pending.tvgId,
      });
      pending = null;
    }
    // 无 EXTINF 前缀的孤立 URL：忽略
  }
  return channels;
}

function parseExtInf(line: string): Partial<Channel> {
  // #EXTINF:-1 attrs,显示名 —— 从右向左找第一个不在双引号内的逗号作为分界
  const rest = line.replace(/^#EXTINF:\s*/, '');
  let splitIdx = -1, inQuotes = false;
  for (let i = rest.length - 1; i >= 0; i--) {
    const c = rest[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ',' && !inQuotes) { splitIdx = i; break; }
  }
  const attrs = splitIdx >= 0 ? rest.slice(0, splitIdx) : rest;
  const name = splitIdx >= 0 ? rest.slice(splitIdx + 1).trim() : '未知频道';
  const attr = (key: string): string | undefined =>
    attrs.match(new RegExp(`${key}="([^"]*)"`))?.[1] || undefined;
  return { name, tvgId: attr('tvg-id'), logo: attr('tvg-logo'), group: attr('group-title') };
}
