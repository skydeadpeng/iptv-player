// src/main.ts
import { parseM3U } from './m3u/parser';
import { Channel, PlaylistSource } from './types';
import * as store from './storage/store';
import { createPlayer, Player } from './player/engine';
import { createVirtualList, VirtualList } from './ui/virtualList';
import { initControls } from './ui/controls';
import { setupImportDialog } from './ui/importDialog';

declare global {
  interface Window {
    /**
     * H5 启动完成标记：main.ts 全部启动流程跑完后置 true。
     * Android 壳的 onPageFinished 自检探针据此判断「页面真的跑起来了」——
     * 只探 localStorage/bridge 会把「ES module 被 file:// CORS 拦掉 → 整页空白」误判成启动成功。
     */
    __iptvBooted?: boolean;
    /** 启动异常信息（壳探针/日志用）；正常启动时不存在 */
    __iptvBootError?: string;
  }
}

const groupsEl = document.getElementById('groups')!;
const channelsEl = document.getElementById('channels')!;
const video = document.getElementById('video') as HTMLVideoElement;

let allChannels: Channel[] = [];
let currentGroup = '全部';
let vl: VirtualList;
let player: Player = createPlayer(video);

function allGroups(): string[] {
  const set = new Set<string>(['全部']);
  for (const c of allChannels) set.add(c.group);
  return [...set];
}

function filtered(): Channel[] {
  const byGroup = currentGroup === '全部' ? allChannels : allChannels.filter(c => c.group === currentGroup);
  // controls 单例在 reload() 内初始化；首次 reload 前不会被调用
  return initControls(document.body, () => vl.setItems(filtered())).filter(byGroup);
}

function renderGroups(): void {
  groupsEl.innerHTML = '';
  for (const g of allGroups()) {
    const btn = document.createElement('button');
    btn.textContent = `${g}`;
    btn.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 12px;background:none;border:none;color:inherit;cursor:pointer;';
    btn.onclick = () => { currentGroup = g; renderGroups(); vl.setItems(filtered()); };
    if (g === currentGroup) btn.style.background = '#333';
    groupsEl.appendChild(btn);
  }
}

function play(c: Channel): void {
  store.recordPlay(c.url);
  document.title = `${c.name} - IPTV 直播`;
  player.play(c.url);
}

/** 重新载入全部源后调用：汇总频道 → 渲染分组与列表 */
function reload(): void {
  allChannels = store.loadSources().flatMap((s: PlaylistSource) => s.channels);
  currentGroup = '全部';
  const ctrl = initControls(document.body, () => vl.setItems(filtered()));
  ctrl.setPlay(play);
  ctrl.setChannelList(filtered());
  renderGroups();
  vl.setItems(filtered());
}

try {
  vl = createVirtualList(channelsEl, {
    rowH: 48,
    renderItem: (el, c) => {
      el.textContent = `${store.loadFavorites().includes(c.url) ? '★ ' : ''}${c.name}`;
      el.onclick = () => play(c);
    },
  });

  player.onFatal(msg => { document.title = `播放失败：${msg}`; });

  setupImportDialog({
    onImported: (text: string, name: string) => {
      const channels = parseM3U(text);
      if (channels.length === 0) return '解析出 0 个频道，请检查文件格式';
      store.saveSource({ id: crypto.randomUUID(), name, importedAt: Date.now(), channels });
      reload();
      return null; // null = 成功
    },
  });

  reload();

  // 启动标记：壳侧探针据此确认 H5 真的跑起来了（而非整页空白）
  window.__iptvBooted = true;
} catch (err) {
  window.__iptvBootError = String(err);
  console.error('[iptv] bootstrap failed:', err);
}
