// src/auto/merge.ts
import { parseM3U } from '../m3u/parser';
import { Channel, PlaylistSource } from '../types';
import { ProbeMap } from './probe';

export const AUTO_SOURCE_ID = 'auto';
export const AUTO_SOURCE_NAME = '自动源';

export type FetchText = (url: string) => Promise<string>;

export interface SourceSpec { name: string; url: string }

/**
 * 拉取多个源并解析；单源失败跳过（不阻塞其他源），返回 per-source 错误供 UI 展示。
 */
export async function fetchAndParseAll(
  sources: SourceSpec[],
  fetchText: FetchText,
): Promise<{ channels: Channel[]; errors: { name: string; message: string }[] }> {
  const channels: Channel[] = [];
  const errors: { name: string; message: string }[] = [];
  await Promise.all(sources.map(async (s) => {
    try {
      channels.push(...parseM3U(await fetchText(s.url)));
    } catch (e) {
      errors.push({ name: s.name, message: e instanceof Error ? e.message : String(e) });
    }
  }));
  return { channels, errors };
}

/** URL 去重：相同 URL 只保留第一个出现者 */
export function dedupeByUrl(channels: Channel[]): Channel[] {
  const seen = new Set<string>();
  const out: Channel[] = [];
  for (const c of channels) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
  }
  return out;
}

/** 只保留测速通过的频道（未测到的视为不可用——abort 提前结束时不展示未知质量频道） */
export function filterOk(channels: Channel[], probe: ProbeMap): Channel[] {
  return channels.filter(c => probe.get(c.url)?.ok === true);
}

/** 同名频道保留测速延迟最小的一个（多源同台的冗余线路只留最快的） */
export function pickFastestByName(channels: Channel[], probe: ProbeMap): Channel[] {
  const best = new Map<string, { ch: Channel; latency: number }>();
  for (const c of channels) {
    const latency = probe.get(c.url)?.latencyMs ?? Number.MAX_SAFE_INTEGER;
    const cur = best.get(c.name);
    if (!cur || latency < cur.latency) best.set(c.name, { ch: c, latency });
  }
  return [...best.values()].map(b => b.ch);
}

/** 组装自动源（固定 id='auto'，重复导入时覆盖旧版本） */
export function buildAutoSource(channels: Channel[]): PlaylistSource {
  return { id: AUTO_SOURCE_ID, name: AUTO_SOURCE_NAME, importedAt: Date.now(), channels };
}
