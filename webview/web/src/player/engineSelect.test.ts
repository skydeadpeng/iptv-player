import { describe, it, expect } from 'vitest';
import { selectEngine } from './engineSelect';

describe('selectEngine', () => {
  it('m3u8/mpd 走 hls', () => {
    expect(selectEngine('http://a/b.m3u8')).toBe('hls');
    expect(selectEngine('http://a/b.M3U8?token=1')).toBe('hls');
  });
  it('ts/flv 走 mpegts', () => {
    expect(selectEngine('http://a/b.ts')).toBe('mpegts');
    expect(selectEngine('http://a/b.flv')).toBe('mpegts');
    expect(selectEngine('http://a/live.ts?auth=x')).toBe('mpegts');
  });
  it('无扩展名默认 hls', () => {
    expect(selectEngine('http://a/channel')).toBe('hls');
  });
});
