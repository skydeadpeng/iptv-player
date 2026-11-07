// src/storage/autoStore.ts
import { SourceSpec } from '../auto/merge';

/** 内置公开源清单（可在对话框中增删，自定义清单存 localStorage） */
export const BUILTIN_SOURCES: SourceSpec[] = [
  { name: 'Guovin IPTV-API', url: 'https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/result.m3u' },
  { name: 'Fanmingming Live', url: 'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv6.m3u' },
];

const K_AUTO_SOURCES = 'iptv:autoSources';
const K_PROBE_CACHE = 'iptv:autoProbe';

export interface ProbeCacheEntry { ok: boolean; latencyMs: number; unknown?: boolean }
export interface ProbeCache { at: number; results: Record<string, ProbeCacheEntry> }

const PROBE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h 内复用测速结果

export function loadAutoSources(): SourceSpec[] {
  try {
    const raw = localStorage.getItem(K_AUTO_SOURCES);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((s): s is SourceSpec =>
          s && typeof s.name === 'string' && typeof s.url === 'string');
      }
    }
  } catch { /* 坏数据走默认 */ }
  return [...BUILTIN_SOURCES];
}

export function saveAutoSources(specs: SourceSpec[]): void {
  localStorage.setItem(K_AUTO_SOURCES, JSON.stringify(specs));
}

export function resetAutoSources(): void {
  localStorage.removeItem(K_AUTO_SOURCES);
}

export function loadProbeCache(): ProbeCache {
  try {
    const raw = localStorage.getItem(K_PROBE_CACHE);
    if (raw) {
      const parsed = JSON.parse(raw) as ProbeCache;
      if (parsed && typeof parsed.at === 'number' && parsed.results && typeof parsed.results === 'object') {
        if (Date.now() - parsed.at < PROBE_CACHE_TTL_MS) return parsed;
      }
    }
  } catch { /* 坏数据走空缓存 */ }
  return { at: 0, results: {} };
}

export function saveProbeCache(cache: ProbeCache): void {
  try {
    localStorage.setItem(K_PROBE_CACHE, JSON.stringify(cache));
  } catch { /* 配额超限不影响主流程 */ }
}
