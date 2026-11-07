// src/auto/geo.ts
import { SourceSpec } from './merge';

/**
 * IP 归属感知的省源注册表。
 *
 * 运营商 IPTV 单播/OTT 源有强地域+运营商限制（实测：江苏电信宽带下，江苏移动 OTT 源
 * 1/6 可用、江苏联通内网源 0/6；反之在对应网络下应可通）。策略：把归属省+ISP 的候选源
 * **与公共源一起**交给自动获取流程，由 App 内频道测速自然淘汰不适用的——
 * 测速是对「源是否适用当前网络」唯一可靠的裁决。
 *
 * ISP 归一化：ip-api 返回 Chinanet/China Telecom → telecom；China Unicom → unicom；
 * China Mobile/CMCC → mobile。
 */

export interface GeoInfo {
  province: string; // ip-api regionName，如「江苏」「上海」
  isp: 'telecom' | 'unicom' | 'mobile' | 'other';
}

/** 省份 → ISP → 候选源（全部为 http 单播/OTT；组播 rtp:// 明确不收录） */
export const PROVINCE_SOURCES: Record<string, Partial<Record<GeoInfo['isp'], SourceSpec[]>>> = {
  江苏: {
    mobile: [
      { name: '江苏移动(cicivi)', url: 'https://raw.githubusercontent.com/cicivi/jsyd-iptv/main/m3u/iptv.m3u8' },
      { name: '江苏移动(molu)', url: 'https://raw.githubusercontent.com/molu8072/IPTV/main/江苏移动.m3u' },
      { name: '江苏移动(0x13)', url: 'https://raw.githubusercontent.com/0x1301FDF/iptv/main/iptv.m3u8' },
    ],
    unicom: [
      { name: '江苏联通(lesca)', url: 'https://raw.githubusercontent.com/lesca/jiangsu-iptv/main/iptv_js_full-latest.m3u' },
    ],
    telecom: [
      { name: '江苏电信(ott)', url: 'https://raw.githubusercontent.com/beckjimmy1005-beep/jsiptv/main/JSIPTV.m3u' },
    ],
  },
};

const GEO_API = 'http://ip-api.com/json/?lang=zh-CN&fields=status,regionName,isp';
const GEO_TIMEOUT_MS = 5000;

function normalizeIsp(isp: string): GeoInfo['isp'] {
  const s = isp.toLowerCase();
  if (s.includes('telecom') || s.includes('chinanet') || s.includes('电信')) return 'telecom';
  if (s.includes('unicom') || s.includes('联通')) return 'unicom';
  if (s.includes('mobile') || s.includes('cmcc') || s.includes('移动')) return 'mobile';
  return 'other';
}

/**
 * 检测 IP 归属；任何失败（网络/限流/非中国）返回 null，调用方退回纯公共源。
 * ip-api 免费版为 http（无 key、45 req/min），壳内 cleartext 已允许。
 */
export async function detectGeo(fetchText: (url: string) => Promise<string>): Promise<GeoInfo | null> {
  try {
    const raw = await fetchText(GEO_API);
    const o = JSON.parse(raw);
    if (o.status !== 'success' || !o.regionName) return null;
    const province = String(o.regionName);
    if (!(province in PROVINCE_SOURCES)) return null; // 未收录省份不返回，退回公共源
    return { province, isp: normalizeIsp(String(o.isp ?? '')) };
  } catch {
    return null;
  }
}

/**
 * 归属省候选源：先 ISP 精确匹配，为空（ISP 未收录/other）则并入该省全部运营商源——
 * 让测速裁决而不是硬编码猜测。
 */
export function geoSourcesFor(geo: GeoInfo): SourceSpec[] {
  const table = PROVINCE_SOURCES[geo.province];
  if (!table) return [];
  const byIsp = table[geo.isp];
  if (byIsp && byIsp.length > 0) return byIsp;
  return Object.values(table).flat();
}
