// src/m3u/parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseM3U } from './parser';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('parseM3U', () => {
  it('解析标准条目含分组与台标', () => {
    const text = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="cctv1" tvg-logo="http://x/1.png" group-title="央视",CCTV-1 综合',
      'http://example.com/cctv1.m3u8',
    ].join('\n');
    expect(parseM3U(text)).toEqual([{
      name: 'CCTV-1 综合',
      url: 'http://example.com/cctv1.m3u8',
      group: '央视',
      logo: 'http://x/1.png',
      tvgId: 'cctv1',
    }]);
  });

  it('无分组归入未分组', () => {
    const text = '#EXTINF:-1,测试台\nhttp://example.com/a.ts';
    const ch = parseM3U(text)[0];
    expect(ch.group).toBe('未分组');
    expect(ch.logo).toBeUndefined();
  });

  it('跳过注释行与空行；URL 行前必须有 EXTINF', () => {
    const text = '#EXTM3U\n\n# 普通注释\nhttp://orphan.com/x.m3u8\n#EXTINF:-1,正常台\nhttp://ok.com/a.m3u8';
    const chs = parseM3U(text);
    expect(chs).toHaveLength(1);
    expect(chs[0].url).toBe('http://ok.com/a.m3u8');
  });

  it('多个条目与多行空白', () => {
    const text = [
      '#EXTM3U',
      '#EXTINF:-1 group-title="A",台1', '',
      'http://1.m3u8',
      '#EXTINF:-1 group-title="B",台2',
      'http://2.m3u8',
    ].join('\n');
    expect(parseM3U(text)).toHaveLength(2);
  });

  it('fixture 文件解析出 2 个频道', () => {
    const fixture = readFileSync(join(__dirname, '../../tests/fixtures/sample.m3u'), 'utf-8');
    expect(parseM3U(fixture)).toHaveLength(2);
  });

  it('空输入返回空数组', () => {
    expect(parseM3U('')).toEqual([]);
  });
});
