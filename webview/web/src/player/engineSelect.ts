export type EngineName = 'hls' | 'mpegts';

/** 按 URL 扩展名选择引擎；无法判断时默认 hls（互联网源 HLS 占绝对多数）。 */
export function selectEngine(url: string): EngineName {
  const clean = url.split(/[?#]/)[0].toLowerCase();
  if (clean.endsWith('.ts') || clean.endsWith('.flv')) return 'mpegts';
  return 'hls';
}
