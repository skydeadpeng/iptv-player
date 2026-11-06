// tests/app.test.ts
/**
 * main.ts 装配层集成测试（DOM 级）。
 *
 * 为什么要这层：Task 9 发现「添加源」「收藏」两个功能在单测里全是绿的，
 * 但真实用户点不到——showImportDialog()/toggleFavorite() 没有 UI 调用点。
 * 只有把 main.ts 真正跑起来（挂 DOM → 导入模块 → 点真实按钮）才能挡住这类回归。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const CHANNELS = [
  { name: '湖南卫视', url: 'http://u/hn', group: '卫视' },
  { name: 'CCTV-1', url: 'http://u/1', group: '央视' },
  { name: 'CCTV-5', url: 'http://u/5', group: '央视' },
];

function mountDom(): void {
  document.body.innerHTML = `
    <div id="app">
      <nav id="groups"></nav>
      <main id="stage"><video id="video" playsinline></video></main>
      <aside id="channels"></aside>
    </div>`;
}

/** 挂 DOM → 重置模块注册表 → 动态导入 main.ts（重新执行其顶层装配代码） */
async function boot(): Promise<void> {
  vi.resetModules();
  await import('../src/main');
}

function seedSource(): void {
  localStorage.setItem('iptv:sources', JSON.stringify([
    { id: 'src-1', name: 'test', importedAt: 1, channels: CHANNELS },
  ]));
}

function rowNames(): string[] {
  return Array.from(document.querySelectorAll('#channels .row .ch-name')).map(n => n.textContent!);
}

beforeEach(() => {
  mountDom();
  localStorage.clear();
  // jsdom 未实现 HTMLMediaElement.load/play：静音掉，避免 jsdomError 噪声
  window.HTMLMediaElement.prototype.load = () => {};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
});

describe('main.ts 装配层', () => {
  it('顶栏「添加源」按钮能打开导入对话框（导入功能可达）', async () => {
    await boot();
    const btn = document.querySelector<HTMLButtonElement>('#btn-add-source');
    expect(btn).not.toBeNull();
    btn!.click();
    expect(document.getElementById('import-dialog')).not.toBeNull();
    expect(document.querySelector<HTMLTextAreaElement>('#import-url')).not.toBeNull();
  });

  it('频道行收藏按钮写入 localStorage 并把该频道置顶', async () => {
    seedSource();
    await boot();
    expect(rowNames()).toEqual(['湖南卫视', 'CCTV-1', 'CCTV-5']);

    // 点第三行（CCTV-5）的收藏按钮
    const favBtns = document.querySelectorAll<HTMLButtonElement>('#channels .row .ch-fav');
    expect(favBtns.length).toBe(3);
    favBtns[2].click();

    expect(JSON.parse(localStorage.getItem('iptv:favorites')!)).toEqual(['http://u/5']);
    expect(rowNames()[0]).toBe('CCTV-5');           // 收藏置顶
    expect(favBtns[0].textContent).toBe('☆');        // 旧按钮节点已随列表重建
    const newFavBtns = document.querySelectorAll<HTMLButtonElement>('#channels .row .ch-fav');
    expect(newFavBtns[0].textContent).toBe('★');     // 置顶那行显示 ★
  });

  it('搜索过滤后 ↑↓ 换台作用在过滤后的列表（不是过滤前的全量列表）', async () => {
    seedSource();
    await boot();

    const input = document.querySelector<HTMLInputElement>('input[placeholder="搜索频道…"]')!;
    input.value = 'CCTV';
    input.dispatchEvent(new Event('input'));
    expect(rowNames()).toEqual(['CCTV-1', 'CCTV-5']);

    // 焦点不在输入框时按 ↓ 换台：应落在过滤后的第一个（CCTV-1），而不是全量列表第一个（湖南卫视）
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(JSON.parse(localStorage.getItem('iptv:recent')!)[0]).toBe('http://u/1');
  });
});
