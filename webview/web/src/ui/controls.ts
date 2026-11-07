// src/ui/controls.ts
import { Channel } from '../types';
import * as store from '../storage/store';
import { showImportDialog } from './importDialog';
import { showAutoDialog } from './autoDialog';

export interface Controls {
  filter(chs: Channel[]): Channel[];
  setKeyword(kw: string): void;
  setPlay(fn: (c: Channel) => void): void;
  setChannelList(chs: Channel[]): void;
  stepChannel(delta: 1 | -1): void;
  toggleFavorite(c: Channel): void;
  favorites(): string[];
  ratio: 'contain' | 'cover' | 'fill';
  cycleRatio(): void;
}

let playFn: ((c: Channel) => void) | null = null;
let list: Channel[] = [];
let idx = -1;
let keyword = '';

/** 装配顶栏与全局键盘；main.ts 调用一次并持有返回实例。 */
export function createControls(root: HTMLElement, refilter: () => void, onAutoDone?: () => void): Controls {
  const ctrl: Controls = {
    ratio: 'contain',
    filter(chs) {
      const kw = keyword.toLowerCase();
      const matched = kw ? chs.filter(c => c.name.toLowerCase().includes(kw)) : [...chs];
      const favs = store.loadFavorites();
      return matched.sort((a, b) => Number(favs.includes(b.url)) - Number(favs.includes(a.url)));
    },
    setKeyword(kw) { keyword = kw; },
    setPlay(fn) { playFn = fn; },
    setChannelList(chs) { list = chs; idx = -1; },
    stepChannel(delta) {
      if (list.length === 0) return;
      idx = (idx + delta + list.length) % list.length;
      playFn?.(list[idx]);
    },
    toggleFavorite(c) { store.toggleFavorite(c.url); },
    favorites() { return store.loadFavorites(); },
    cycleRatio() {
      ctrl.ratio = ctrl.ratio === 'contain' ? 'cover' : ctrl.ratio === 'cover' ? 'fill' : 'contain';
      const video = document.getElementById('video') as HTMLVideoElement;
      video.style.objectFit = ctrl.ratio === 'fill' ? 'fill' : ctrl.ratio;
    },
  };

  // 顶栏：搜索框 + 添加源按钮 + 比例按钮（DOM 装配在 ctrl 定义之后，避免引用未初始化变量）
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;top:0;left:160px;right:300px;display:flex;gap:8px;padding:8px;background:rgba(0,0,0,.7);z-index:10;';
  const input = document.createElement('input');
  input.placeholder = '搜索频道…';
  input.style.cssText = 'flex:1;padding:4px 8px;background:#111;border:1px solid #333;color:#eee;';
  input.addEventListener('input', () => { ctrl.setKeyword(input.value); refilter(); });
  const ratioBtn = document.createElement('button');
  ratioBtn.textContent = '比例';
  ratioBtn.onclick = () => ctrl.cycleRatio();
  // 「添加源」入口：showImportDialog() 此前只有定义、没有任何调用点，
  // 用户无法添加订阅源 → 整个 App 拿不到频道。importDialog 不 import controls，无循环依赖。
  const addBtn = document.createElement('button');
  addBtn.id = 'btn-add-source';
  addBtn.textContent = '添加源';
  addBtn.onclick = () => showImportDialog();
  // 「自动源」入口：内置公开源一键拉取+测速筛选（自动源设计 2026-11-07）
  const autoBtn = document.createElement('button');
  autoBtn.id = 'btn-auto-source';
  autoBtn.textContent = '自动源';
  autoBtn.onclick = () => showAutoDialog(() => (onAutoDone ?? refilter)());
  bar.append(input, addBtn, autoBtn, ratioBtn);
  root.appendChild(bar);

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return; // 搜索时不触发换台
    if (e.key === 'ArrowUp') { e.preventDefault(); ctrl.stepChannel(-1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); ctrl.stepChannel(1); }
  });

  return ctrl;
}

/** 模块级单例；main.ts 的 reload() 里初始化。 */
let singleton: Controls | null = null;
export function initControls(root: HTMLElement, refilter: () => void, onAutoDone?: () => void): Controls {
  return (singleton ??= createControls(root, refilter, onAutoDone));
}
export function currentControls(): Controls | null { return singleton; }
