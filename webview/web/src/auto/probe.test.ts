// src/auto/probe.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { probeChannels, probeOne } from './probe';
import { Channel } from '../types';

/** 模拟真实 fetch 的延迟：signal abort 时 reject（AbortError），与浏览器行为一致 */
function delayOrAbort(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
  });
}

/** 可编程 fetch mock：按 URL 返回状态/延迟/body 片段 */
function mockFetch(handler: (url: string) => { status: number; body?: string; delayMs?: number } | 'network-error'): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const r = handler(url);
    if (r === 'network-error') throw new TypeError('network error');
    if (r.delayMs) await delayOrAbort(r.delayMs, init?.signal);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      body: { getReader: () => ({ read: async () => ({ done: false, value: new TextEncoder().encode(r.body ?? '') }), cancel: async () => {} }) },
    } as unknown as Response;
  }));
}

const ch = (name: string, url: string): Channel => ({ name, url, group: 'g' });

describe('probeOne（单频道测速）', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('2xx 视为可用并记录延迟', async () => {
    mockFetch(() => ({ status: 200, body: '#EXTM3U' }));
    const r = await probeOne(ch('a', 'http://x/a.m3u8'));
    expect(r.ok).toBe(true);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('404 → 不可用；网络错误 → 见 unknown 用例（浏览器语义已改为保守保留）', async () => {
    mockFetch(() => ({ status: 404 }));
    expect((await probeOne(ch('a', 'http://x/a'))).ok).toBe(false);
  });

  it('.m3u8 响应体缺 #EXTM3U → 不可用（防伪 HLS）', async () => {
    mockFetch(() => ({ status: 200, body: '<html>not a playlist</html>' }));
    expect((await probeOne(ch('a', 'http://x/a.m3u8'))).ok).toBe(false);
  });

  it('非 .m3u8 的 2xx 不检查 body', async () => {
    mockFetch(() => ({ status: 200, body: '' }));
    expect((await probeOne(ch('a', 'http://x/a.ts'))).ok).toBe(true);
  });

  it('浏览器内 TypeError + 非 m3u8 → unknown（保守保留）', async () => {
    mockFetch(() => 'network-error');
    const r = await probeOne(ch('a', 'http://x/a.ts'));
    expect(r.ok).toBe(true);
    expect(r.unknown).toBe(true);
    expect(r.latencyMs).toBe(-1);
  });

  it('浏览器内 TypeError + m3u8 → 媒体元素二次探测裁决', async () => {
    mockFetch(() => 'network-error');
    const ok = await probeOne(ch('a', 'http://x/a.m3u8'), 5000, async () => true);
    expect(ok).toMatchObject({ ok: true, latencyMs: -1 });
    const dead = await probeOne(ch('b', 'http://x/b.m3u8'), 5000, async () => false);
    expect(dead.ok).toBe(false);
  });

  it('壳内 TypeError → 确定性失败（hasNative）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('net'); }));
    Object.defineProperty(window, 'IptvBridge', { value: { pickM3uFile: () => 'k' }, configurable: true });
    try {
      expect((await probeOne(ch('a', 'http://x/a'))).ok).toBe(false);
    } finally {
      delete (window as { IptvBridge?: unknown }).IptvBridge;
    }
  });

  it('5s 超时 → 不可用（fake timers）', async () => {
    vi.useFakeTimers();
    mockFetch(() => ({ status: 200, delayMs: 999_999 }));
    const p = probeOne(ch('a', 'http://x/a'));
    const assertion = expect(p).resolves.toMatchObject({ ok: false });
    await vi.advanceTimersByTimeAsync(5_001);
    await assertion;
    vi.useRealTimers();
  });
});

describe('probeChannels（批量测速）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('汇总每个频道的 ok 与延迟，进度回调逐频道递增', async () => {
    mockFetch((url) => (url.includes('slow') ? { status: 200, delayMs: 30 } : { status: 200, body: '#EXTM3U' }));
    const chans = [ch('1', 'http://x/1'), ch('2', 'http://x/2slow'), ch('3', 'http://x/3')];
    let done = 0;
    const results = await probeChannels(chans, { concurrency: 2, timeoutMs: 5_000, onProgress: () => done++ }).done;
    expect(results.size).toBe(3);
    expect([...results.values()].every(r => r.ok)).toBe(true);
    expect(done).toBe(3);
  });

  it('超过 concurrency 的频道排队执行', async () => {
    let inflight = 0, maxInflight = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      inflight++; maxInflight = Math.max(maxInflight, inflight);
      await delayOrAbort(20, init?.signal);
      inflight--;
      return { ok: true, status: 200, body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }), cancel: async () => {} }) } } as unknown as Response;
    }));
    const chans = Array.from({ length: 10 }, (_, i) => ch(`c${i}`, `http://x/${i}`));
    await probeChannels(chans, { concurrency: 3, timeoutMs: 5_000 }).done;
    expect(maxInflight).toBeLessThanOrEqual(3);
  });

  it('abort() 后立即停止，返回已完成部分', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      await delayOrAbort(10, init?.signal);
      return { ok: true, status: 200, body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }), cancel: async () => {} }) } } as unknown as Response;
    }));
    const chans = Array.from({ length: 100 }, (_, i) => ch(`c${i}`, `http://x/${i}`));
    const ctrl = probeChannels(chans, { concurrency: 2, timeoutMs: 5_000 });
    await new Promise(r => setTimeout(r, 40));
    ctrl.abort();
    const results = await ctrl.done;
    expect(results.size).toBeLessThan(100);
    expect(results.size).toBeGreaterThan(0);
  });
});
