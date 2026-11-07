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
 * 媒体元素探测：媒体加载不受 CORS 限制，可区分「流真的可达」与「fetch 被 CORS 拦截」。
 * 仅对 .m3u8 可靠（Chrome 原生 HLS）；裸 .ts/.flv 媒体元素解析不了，不能用此法。
 * videoProbe 可注入以便测试（jsdom 无媒体实现）。
 */
export function probeViaVideo(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    v.style.display = 'none';
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.removeEventListener('loadedmetadata', okHandler);
      v.removeEventListener('error', errHandler);
      v.removeAttribute('src');
      try { v.load(); } catch { /* jsdom 可能抛 not implemented */ }
      v.remove();
      resolve(ok);
    };
    const okHandler = (): void => done(true);
    const errHandler = (): void => done(false);
    const timer = setTimeout(() => done(false), timeoutMs);
    v.addEventListener('loadedmetadata', okHandler, { once: true });
    v.addEventListener('error', errHandler, { once: true });
    v.src = url;
    try { v.load(); } catch { /* 同上 */ }
  });
}

/** fetch 失败后的兜底策略由调用环境决定；videoProbe 注入点（测试传 stub） */
export async function probeOne(
  ch: Channel,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  videoProbe: (url: string, timeoutMs: number) => Promise<boolean> = probeViaVideo,
): Promise<ProbeResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  const isM3u8 = ch.url.split(/[?#]/)[0].toLowerCase().endsWith('.m3u8');
  try {
    const res = await fetch(ch.url, { signal: ctrl.signal, redirect: 'follow' });
    const latencyMs = Date.now() - t0;
    if (!res.ok) return { ok: false, latencyMs };
    if (isM3u8) {
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
    // TypeError：网络层失败。壳内（file:// 全权限，无 CORS）= 真断网 → 判死。
    if (fetchBridge.hasNative()) return { ok: false, latencyMs: Date.now() - t0 };
    // 纯浏览器：CORS 拦截或断网，fetch 无法区分。m3u8 可用媒体元素二次探测（不受 CORS 限制）；
    // 非 m3u8（裸 TS/FLV 媒体元素解析不了）保持 unknown 保守保留。
    if (isM3u8) {
      const mediaOk = await videoProbe(ch.url, timeoutMs);
      return mediaOk ? { ok: true, latencyMs: -1 } : { ok: false, latencyMs: Date.now() - t0 };
    }
    return { ok: true, latencyMs: -1, unknown: true };
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
