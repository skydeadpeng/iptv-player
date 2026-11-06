// src/ui/controls.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createControls } from './controls';
import { Channel } from '../types';

const chs: Channel[] = [
  { name: 'CCTV-1', url: 'http://u/1', group: '央视' },
  { name: 'CCTV-5', url: 'http://u/5', group: '央视' },
  { name: '湖南卫视', url: 'http://u/hn', group: '卫视' },
];

beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

describe('controls', () => {
  it('搜索过滤不区分大小写', () => {
    const c = createControls(document.body, () => {});
    c.setKeyword('cctv');
    expect(c.filter(chs)).toHaveLength(2);
    c.setKeyword('湖南');
    expect(c.filter(chs)).toHaveLength(1);
  });

  it('收藏置顶 + 收藏切换', () => {
    const c = createControls(document.body, () => {});
    c.toggleFavorite(chs[2]);
    const out = c.filter(chs);
    expect(out[0].name).toBe('湖南卫视');  // 收藏的排最前
    expect(c.favorites()).toEqual(['http://u/hn']);
  });

  it('键盘上下换台调用 play', () => {
    const c = createControls(document.body, () => {});
    let played = null as Channel | null;  // 显式联合类型，避免 TS 收窄为 null 导致 as 报错
    c.setPlay(ch => { played = ch; });
    c.setChannelList(chs);
    c.stepChannel(1);                     // 下一个：从 -1 起步，+1 → index 0
    expect((played as Channel)!.name).toBe('CCTV-1');
    c.stepChannel(1);
    expect((played as Channel).name).toBe('CCTV-5');
    c.stepChannel(-1);                    // 回退
    expect((played as Channel).name).toBe('CCTV-1');
  });
});
