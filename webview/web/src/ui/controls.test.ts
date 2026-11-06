// src/ui/controls.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createControls } from './controls';
import { setupImportDialog } from './importDialog';
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
    c.setKeyword('');                     // 重置模块级 keyword（用例 1 残留 '湖南' 会缩小匹配集）
    c.toggleFavorite(chs[2]);
    const out = c.filter(chs);
    expect(out[0].name).toBe('湖南卫视');  // 收藏的排最前
    expect(c.favorites()).toEqual(['http://u/hn']);
    // 对照鉴别：关键字过滤后，收藏的 CCTV-5 仍应置顶（真正检验 sort 置顶逻辑）
    c.toggleFavorite(chs[1]);             // 收藏 CCTV-5
    c.setKeyword('cctv');
    expect(c.filter(chs).map(x => x.name)).toEqual(['CCTV-5', 'CCTV-1']);
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

  it('顶栏「添加源」按钮打开导入对话框（导入功能的唯一 UI 入口）', () => {
    setupImportDialog({ onImported: () => null });
    createControls(document.body, () => {});
    const btn = document.querySelector<HTMLButtonElement>('#btn-add-source');
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe('添加源');
    btn!.click();
    expect(document.getElementById('import-dialog')).not.toBeNull();
    // 对照鉴别：此前 showImportDialog 无任何调用点 → 对话框根本打不开
    document.querySelector<HTMLButtonElement>('#import-cancel')!.click();
    expect(document.getElementById('import-dialog')).toBeNull();
  });
});
