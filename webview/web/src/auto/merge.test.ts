// src/auto/merge.test.ts
import { describe, it, expect } from 'vitest';
import { dedupeByUrl, filterOk, pickFastestByName, buildAutoSource, fetchAndParseAll } from './merge';
import { Channel } from '../types';

const ch = (name: string, url: string, group = 'g'): Channel => ({ name, url, group });

describe('dedupeByUrl', () => {
  it('相同 URL 只保留第一个', () => {
    const out = dedupeByUrl([ch('A', 'http://x/1'), ch('B', 'http://x/2'), ch('C', 'http://x/1')]);
    expect(out.map(c => c.name)).toEqual(['A', 'B']);
  });
  it('不同 URL 同名共存（测速阶段再裁决）', () => {
    expect(dedupeByUrl([ch('A', 'http://x/1'), ch('A', 'http://x/2')])).toHaveLength(2);
  });
});

describe('filterOk', () => {
  it('只保留测速通过的频道（未测到的视为不可用）', () => {
    const chans = [ch('A', 'http://x/1'), ch('B', 'http://x/2'), ch('C', 'http://x/3')];
    const probe = new Map([
      ['http://x/1', { ok: true, latencyMs: 100 }],
      ['http://x/2', { ok: false, latencyMs: 5000 }],
    ]);
    expect(filterOk(chans, probe).map(c => c.name)).toEqual(['A']);
  });
});

describe('pickFastestByName', () => {
  it('同名频道保留延迟最小的一个', () => {
    const chans = [ch('CCTV-1', 'http://x/slow'), ch('CCTV-1', 'http://x/fast'), ch('CCTV-2', 'http://x/only')];
    const probe = new Map([
      ['http://x/slow', { ok: true, latencyMs: 800 }],
      ['http://x/fast', { ok: true, latencyMs: 120 }],
      ['http://x/only', { ok: true, latencyMs: 300 }],
    ]);
    expect(pickFastestByName(chans, probe).map(c => c.url)).toEqual(['http://x/fast', 'http://x/only']);
  });
  it('无测速数据（异常路径）保留首个，不丢频道', () => {
    expect(pickFastestByName([ch('A', 'http://x/1'), ch('A', 'http://x/2')], new Map()).map(c => c.url))
      .toEqual(['http://x/1']);
  });
});

describe('buildAutoSource', () => {
  it('生成固定 id 的 PlaylistSource（重复导入覆盖旧版）', () => {
    const s = buildAutoSource([ch('A', 'http://x/1')]);
    expect(s.id).toBe('auto');
    expect(s.name).toBe('自动源');
    expect(s.channels).toHaveLength(1);
    expect(s.importedAt).toBeGreaterThan(0);
  });
});

describe('fetchAndParseAll', () => {
  const M3U_A = '#EXTM3U\n#EXTINF:-1 group-title="央视",CCTV-1\nhttp://a/1';
  const M3U_B = '#EXTM3U\n#EXTINF:-1 group-title="卫视",湖南卫视\nhttp://b/1';

  it('多源合并解析', async () => {
    const r = await fetchAndParseAll(
      [{ name: 'A', url: 'http://a.m3u' }, { name: 'B', url: 'http://b.m3u' }],
      async (url) => (url.includes('a.') ? M3U_A : M3U_B),
    );
    expect(r.channels).toHaveLength(2);
    expect(r.errors).toEqual([]);
  });

  it('单源失败跳过并记录错误，其他源不受影响', async () => {
    const r = await fetchAndParseAll(
      [{ name: '好源', url: 'http://good.m3u' }, { name: '坏源', url: 'http://bad.m3u' }],
      async (url) => { if (url.includes('bad')) throw new Error('HTTP 503'); return M3U_A; },
    );
    expect(r.channels).toHaveLength(1);
    expect(r.errors).toEqual([{ name: '坏源', message: 'HTTP 503' }]);
  });
});
