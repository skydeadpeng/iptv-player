// src/auto/manager.ts
import { Channel } from '../types';
import * as store from '../storage/store';
import * as autoStore from '../storage/autoStore';
import { fetchBridge } from '../bridge/native';
import { fetchAndParseAll, dedupeByUrl, filterOk, pickFastestByName, buildAutoSource, SourceSpec } from './merge';
import { probeChannels } from './probe';
import { detectGeo, geoSourcesFor } from './geo';

export interface AutoProgress {
  phase: 'fetching' | 'probing' | 'done';
  /** 人读的进度描述，如「测速 123/1619」或「可用 520/1619」 */
  detail: string;
}

export interface AutoResult { ok: number; total: number }

let aborted = false;
let abortProbing: (() => void) | null = null;

export function cancelAutoFetch(): void {
  aborted = true;
  abortProbing?.();
}

/**
 * 自动获取频道全链路：拉取 → URL 去重 → 测速（24h 缓存）→ 筛选 → 同名取最快 → 入库。
 * 全部源失败或用户取消返回 null（不入库，保留旧 auto 源）。
 */
export async function runAutoFetch(
  onProgress: (p: AutoProgress) => void,
): Promise<AutoResult | null> {
  aborted = false; // 每次启动清除上一次的取消状态

  // 1) 组装源清单：自定义/内置公共源 + IP 归属省的运营商源（若能检测到且已收录）。
  //    归属省源与公共源一起测速——地域/运营商不适用的会被自然淘汰。
  const publicSources = autoStore.loadAutoSources();
  let geoSources: SourceSpec[] = [];
  try {
    const geo = await detectGeo(u => fetchBridge.fetchText(u));
    if (geo) {
      geoSources = geoSourcesFor(geo);
      onProgress({ phase: 'fetching', detail: `IP 归属 ${geo.province}/${geo.isp}，并入 ${geoSources.length} 个省源` });
    }
  } catch { /* 归属检测失败静默退回公共源 */ }
  const sources = [...publicSources, ...geoSources.filter(g => !publicSources.some(p => p.url === g.url))];
  onProgress({ phase: 'fetching', detail: `拉取 ${sources.length} 个源…` });
  const { channels, errors } = await fetchAndParseAll(sources, u => fetchBridge.fetchText(u));
  if (aborted) return null;
  if (channels.length === 0) {
    onProgress({ phase: 'done', detail: `拉取失败：${errors.map(e => `${e.name}: ${e.message}`).join('；') || '0 个频道'}` });
    return null;
  }

  // 2) URL 去重
  const deduped = dedupeByUrl(channels);

  // 3) 测速（缓存命中的直接用，未命中的才探测）
  const cache = autoStore.loadProbeCache();
  const cached = new Map(Object.entries(cache.results).map(([u, e]) => [u, e] as const));
  const needProbe = deduped.filter(c => !cached.has(c.url));
  const probe = new Map(cached);
  if (needProbe.length > 0) {
    onProgress({ phase: 'probing', detail: `测速 0/${needProbe.length}` });
    const ctrl = probeChannels(needProbe, {
      concurrency: 16,
      timeoutMs: 5000,
      onProgress: (done, total) => {
        if (done % 20 === 0 || done === total) onProgress({ phase: 'probing', detail: `测速 ${done}/${total}` });
      },
    });
    abortProbing = ctrl.abort;
    const fresh = await ctrl.done;
    abortProbing = null;
    if (aborted) return null;
    for (const [u, e] of fresh) probe.set(u, e);
    // 测速结果写缓存（含历史条目与 unknown 标记）——必须在 fresh 合并进 probe 之后
    autoStore.saveProbeCache({
      at: Date.now(),
      results: Object.fromEntries([...probe.entries()].map(([u, e]) => [u, { ok: e.ok, latencyMs: e.latencyMs, unknown: e.unknown }])),
    });
  }

  // 4) 筛选 + 同名裁决
  const usable = pickFastestByName(filterOk(deduped, probe), probe);

  // 5) 入库（覆盖旧 auto 源）
  if (usable.length === 0) {
    onProgress({ phase: 'done', detail: `全部频道测速失败（共 ${deduped.length} 个），保留原有频道列表` });
    return null;
  }
  store.saveSource(buildAutoSource(usable));
  onProgress({ phase: 'done', detail: `可用 ${usable.length} / 共 ${deduped.length} 个频道${errors.length ? `；${errors.length} 个源拉取失败` : ''}` });
  return { ok: usable.length, total: deduped.length };
}
