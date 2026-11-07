// src/auto/manager.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runAutoFetch, cancelAutoFetch } from './manager';
import * as store from '../storage/store';
import * as autoStore from '../storage/autoStore';

const M3U = (entries: [string, string][]): string =>
  ['#EXTM3U', ...entries.map(([n, u]) => `#EXTINF:-1 group-title="测试",${n}\n${u}`)].join('\n');

describe('runAutoFetch', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    cancelAutoFetch();
  });

  it('全链路：拉取→去重→测速→同名裁决→入库 auto 源', async () => {
    autoStore.saveAutoSources([{ name: 'S1', url: 'http://s1.m3u' }]);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'http://s1.m3u') return { ok: true, status: 200, text: async () => M3U([['A', 'http://c/1'], ['B', 'http://c/2']]) } as unknown as Response;
      // 频道测速：c/1 通，c/2 确定性失败（404）
      if (url === 'http://c/1') return { ok: true, status: 200, body: { getReader: () => ({ read: async () => ({ done: false, value: new TextEncoder().encode('#EXTM3U') }), cancel: async () => {} }) } } as unknown as Response;
      return { ok: false, status: 404 } as unknown as Response;
    }));
    const phases: string[] = [];
    const r = await runAutoFetch(p => { if (!phases.includes(p.phase)) phases.push(p.phase); });
    expect(r).not.toBeNull();
    expect(r!.ok).toBe(1);                          // B 断线被剔除
    expect(r!.total).toBe(2);
    const src = store.loadSources().find(s => s.id === 'auto')!;
    expect(src.channels.map(c => c.name)).toEqual(['A']);
  });

  it('全部源拉取失败 → 返回 null 且不入库', async () => {
    autoStore.saveAutoSources([{ name: 'S1', url: 'http://s1.m3u' }]);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down'); }));
    const r = await runAutoFetch(() => {});
    expect(r).toBeNull();
    expect(store.loadSources().find(s => s.id === 'auto')).toBeUndefined();
  });

  it('24h 内的测速缓存命中则跳过重测', async () => {
    autoStore.saveAutoSources([{ name: 'S1', url: 'http://s1.m3u' }]);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'http://s1.m3u') return { ok: true, status: 200, text: async () => M3U([['A', 'http://c/1']]) } as unknown as Response;
      throw new Error('should not probe: cache hit');
    }));
    autoStore.saveProbeCache({ at: Date.now(), results: { 'http://c/1': { ok: true, latencyMs: 50 } } });
    const r = await runAutoFetch(() => {});
    expect(r!.ok).toBe(1);
  });

  it('取消 → 返回 null，不写 auto 源', async () => {
    autoStore.saveAutoSources([{ name: 'S1', url: 'http://s1.m3u' }]);
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      await new Promise((res, rej) => {
        const t = setTimeout(res, 100);
        init?.signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('x', 'AbortError')); }, { once: true });
      });
      return { ok: true, status: 200, text: async () => M3U([['A', 'http://c/1']]) } as unknown as Response;
    }));
    const p = runAutoFetch(() => {});
    cancelAutoFetch();
    expect(await p).toBeNull();
    expect(store.loadSources().find(s => s.id === 'auto')).toBeUndefined();
  });
});
