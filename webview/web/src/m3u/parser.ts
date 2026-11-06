// src/m3u/parser.ts
import { Channel, UNGROUPED } from '../types';

/**
 * 解析 M3U 文本为频道数组。
 * 规则：#EXTINF 属性取 tvg-id/tvg-logo/group-title；其后第一个非注释非空行为 URL。
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
        name: pending.name ?? '未知频道',
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
  // #EXTINF:-1 attrs,显示名
  const commaIdx = line.indexOf(',');
  const name = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : '未知频道';
  const attrs = commaIdx >= 0 ? line.slice(0, commaIdx) : '';
  const attr = (key: string): string | undefined =>
    attrs.match(new RegExp(`${key}="([^"]*)"`))?.[1] || undefined;
  return { name, tvgId: attr('tvg-id'), logo: attr('tvg-logo'), group: attr('group-title') };
}
