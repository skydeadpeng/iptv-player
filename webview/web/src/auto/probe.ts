// src/auto/probe.ts
import { Channel } from '../types';
import { fetchBridge } from '../bridge/native';

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  /**
   * true = 结果未知（浏览器内 fetch 抛 TypeError：可能是 CORS 拦截也可能是真断网，
   * 浏览器故意不区分）。unknown 频道保守保留、排后；仅在壳内（hasNative）才确定性判死。
   * 明确失败（4xx/5xx、伪 HLS、壳内 TypeError）不算 unknown。
   */
  unknown?: boolean;
}
export type ProbeMap = Map<string, ProbeResult>;

interface ProbeOpts {
  concurrency?: number;
  timeoutMs?: number;
  onProgress?: (done: number, total: number) => void;
}

const DEFAULT_CONCURRENCY = 16;
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * 单频道测速：GET + 收到响应头即测 TTFB，随即 abort（不下载媒体数据）。
 * .m3u8 额外校验响应体含 #EXTM3U（读前 1KB，防伪 HLS）。
 */
export async function probeOne(ch: Channel, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ProbeResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(ch.url, { signal: ctrl.signal, redirect: 'follow' });
    const latencyMs = Date.now() - t0;
    if (!res.ok) return { ok: false, latencyMs };
    if (ch.url.split(/[?#]/)[0].toLowerCase().endsWith('.m3u8')) {
      const reader = res.body?.getReader();
      let head = '';
      if (reader) {
        const { value } = await reader.read(); // 前 1KB 内必有 #EXTM3U
        head = new TextDecoder().decode(value ?? new Uint8Array());
        try { await reader.cancel(); } catch { /* 已 abort，忽略 */ }
      }
      if (!head.includes('#EXTM3U')) return { ok: false, latencyMs };
    }
    return { ok: true, latencyMs };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    if (aborted) return { ok: false, latencyMs: Date.now() - t0 };          // 超时：确定性失败
    // TypeError：网络层失败。壳内（file:// 全权限）= 真断网；纯浏览器 = CORS 拦截或断网，无法区分。
    return fetchBridge.hasNative()
      ? { ok: false, latencyMs: Date.now() - t0 }
      : { ok: true, latencyMs: -1, unknown: true };                          // 保守保留，排后
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 批量测速：固定并发池；onProgress 逐频道回调；返回可继续 abort 的句柄。
 */
export function probeChannels(
  channels: Channel[],
  opts: ProbeOpts = {},
): { done: Promise<ProbeMap>; abort: () => void } {
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const results: ProbeMap = new Map();
  let done = 0;
  let aborted = false;
  let next = 0;

  const worker = async (): Promise<void> => {
    while (!aborted) {
      const i = next++;
      if (i >= channels.length) return;
      const ch = channels[i];
      results.set(ch.url, await probeOne(ch, timeoutMs));
      done++;
      opts.onProgress?.(done, channels.length);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, channels.length) }, () => worker());
  return {
    done: Promise.all(workers).then(() => results),
    abort: () => { aborted = true; },
  };
}
