// src/auto/geo.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { detectGeo, geoSourcesFor } from './geo';

function mockIpApi(response: object | 'error'): void {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (response === 'error') throw new TypeError('network');
    return { ok: true, status: 200, text: async () => JSON.stringify(response) } as unknown as Response;
  }));
}

const pass = (u: string) => async (url: string) => {
  void url;
  return JSON.stringify(u === 'GEO' ? {} : {});
};

describe('detectGeo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('成功解析省份与 ISP 归一化（Chinanet→telecom）', async () => {
    mockIpApi({ status: 'success', regionName: '江苏', isp: 'Chinanet' });
    const geo = await detectGeo(async (url) => {
      void url;
      return JSON.stringify({ status: 'success', regionName: '江苏', isp: 'Chinanet' });
    });
    expect(geo).toEqual({ province: '江苏', isp: 'telecom' });
  });

  it('江苏移动 CMCC→mobile；联通→unicom', async () => {
    mockIpApi({});
    const g1 = await detectGeo(async () => JSON.stringify({ status: 'success', regionName: '江苏', isp: 'China Mobile' }));
    expect(g1!.isp).toBe('mobile');
    const g2 = await detectGeo(async () => JSON.stringify({ status: 'success', regionName: '江苏', isp: 'China Unicom' }));
    expect(g2!.isp).toBe('unicom');
  });

  it('未收录省份返回 null（退回公共源）', async () => {
    const g = await detectGeo(async () => JSON.stringify({ status: 'success', regionName: '黑龙江', isp: 'China Mobile' }));
    expect(g).toBeNull();
  });

  it('网络失败 / 非 success 返回 null', async () => {
    mockIpApi('error');
    expect(await detectGeo(async () => { throw new Error('x'); })).toBeNull();
    expect(await detectGeo(async () => JSON.stringify({ status: 'fail' }))).toBeNull();
  });
});

describe('geoSourcesFor', () => {
  it('ISP 精确匹配（江苏移动 → 3 个移动源）', () => {
    const s = geoSourcesFor({ province: '江苏', isp: 'mobile' });
    expect(s).toHaveLength(3);
    expect(s.every(x => x.name.includes('移动'))).toBe(true);
  });

  it('ISP 未收录/other → 并入该省全部源（测速裁决）', () => {
    expect(geoSourcesFor({ province: '江苏', isp: 'other' })).toHaveLength(5);
  });

  it('未收录省返回空', () => {
    expect(geoSourcesFor({ province: '西藏', isp: 'telecom' })).toEqual([]);
  });
});
