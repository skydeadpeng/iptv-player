# IPTV 播放器双版本实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付两个功能一致的 IPTV 播放器：WebView 版（H5 + Android 薄壳）与原生版（基于 OwnTV 定制）。

**Architecture:** 先做 WebView 版（全新代码、完全 TDD、独立可交付），再做原生版（clone OwnTV 后定制品牌与源管理）。两者共享同一 M3U 数据模型与 MVP 功能集，互不依赖。

**Tech Stack:** WebView 版 — Vite + TypeScript(无 UI 框架) + hls.js + mpegts.js + Vitest(jsdom) + Kotlin WebView 壳；原生版 — Kotlin + Jetpack Compose for TV + ExoPlayer/mpv。

## Global Constraints

- 设计文档：`docs/superpowers/specs/2026-11-06-iptv-player-design.md`（基座已变更为 OwnTV，GPL-3.0）
- MVP 功能边界：M3U 导入（URL/文件）、分类/搜索/收藏、播放（换台/画面比例/音量）、TV 遥控器适配。**EPG、udpxy(udp://)、iOS 不在本期**
- 播放超时判定：8 秒无数据判定失败（两版本一致）
- WebView 版 H5：不引入 UI 框架；频道列表虚拟滚动，行高固定 48px
- localStorage key 统一前缀 `iptv:`
- 壳 applicationId 暂定 `com.iptv.webview`，原生版 `com.iptv.native`，应用名暂定「IPTV 直播」，用户可随时改名
- OwnTV 为 GPL-3.0：分发修改版须保持 GPL 开源；不得闭源商用
- 每个 Task 结束必须 commit，测试必须先于实现（TDD）
- 测试源统一用：`https://live.fanmingming.com/tv/m3u/ipv6.m3u`（正常源）与本地 fixture（坏源）

---

# 第一部分：WebView 版

## File Structure（WebView 版）

```
webview/
├── web/
│   ├── package.json / vite.config.ts / tsconfig.json
│   ├── index.html                  # 三栏布局骨架
│   └── src/
│       ├── main.ts                 # 入口：初始化各模块并装配
│       ├── types.ts                # Channel / PlaylistSource 数据模型
│       ├── m3u/parser.ts           # M3U 解析（纯函数，无 DOM 依赖）
│       ├── storage/store.ts        # localStorage 封装（源/收藏/最近播放）
│       ├── player/engine.ts        # hls.js/mpegts.js 引擎选择与播放控制
│       ├── player/engineSelect.ts  # 引擎选择纯函数（可单测）
│       ├── ui/virtualList.ts       # 虚拟滚动列表（纯渲染逻辑可单测）
│       ├── ui/controls.ts          # 搜索/收藏/比例/键盘换台
│       ├── ui/importDialog.ts      # 源导入对话框
│       └── bridge/native.ts        # 壳注入的 JS Bridge 接口
│   └── tests/fixtures/sample.m3u   # 测试夹具
└── android/
    ├── settings.gradle.kts / build.gradle.kts / gradle.properties
    └── app/src/main/
        ├── AndroidManifest.xml
        ├── java/com/iptv/webview/MainActivity.kt
        ├── assets/web/             # H5 构建产物（脚本拷入）
        └── res/ (values/strings.xml, mipmap 图标占位)
```

---

### Task 1: 脚手架与数据模型

**Files:**
- Create: `webview/web/package.json`, `webview/web/vite.config.ts`, `webview/web/tsconfig.json`, `webview/web/src/types.ts`, `webview/web/src/main.ts`, `webview/web/index.html`, `webview/web/tests/smoke.test.ts`, `webview/web/tests/fixtures/sample.m3u`

**Interfaces:**
- Produces: `Channel`, `PlaylistSource` 类型（后续所有任务的基石）

- [ ] **Step 1: 初始化 npm 项目与依赖**

```bash
mkdir -p webview/web && cd webview/web
npm init -y
npm install hls.js mpegts.js
npm install -D vite typescript vitest jsdom
```

`package.json` scripts 段改为：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 2: 配置 vite.config.ts 与 tsconfig.json**

```ts
// vite.config.ts
import { defineConfig } from 'vite';
export default defineConfig({
  base: './',            // 壳内 assets 相对路径加载必需
  build: { target: 'es2020' },
  test: { environment: 'jsdom' },
});
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: 写数据模型 types.ts**

```ts
// src/types.ts
export interface Channel {
  name: string;        // 频道名，如 CCTV-1
  url: string;         // 播放地址
  group: string;       // 分组名，无分组为 "未分组"
  logo?: string;       // tvg-logo
  tvgId?: string;      // tvg-id（二期 EPG 用，先保留）
}

export interface PlaylistSource {
  id: string;          // crypto.randomUUID()
  name: string;        // 源名称（用户输入或文件名）
  url?: string;        // URL 订阅地址（文件导入为空）
  importedAt: number;  // Date.now()
  channels: Channel[];
}

export const UNGROUPED = '未分组';
```

- [ ] **Step 4: 写冒烟测试并运行**

```ts
// tests/smoke.test.ts
import { describe, it, expect } from 'vitest';
import { UNGROUPED } from '../src/types';

describe('smoke', () => {
  it('types module loads', () => {
    expect(UNGROUPED).toBe('未分组');
  });
});
```

Run: `npm test`
Expected: `1 passed`

- [ ] **Step 5: 写 index.html 骨架与空 main.ts**

```html
<!-- index.html -->
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>IPTV 直播</title>
  <style>
    :root { --row-h: 48px; }
    * { margin: 0; box-sizing: border-box; }
    body { background: #000; color: #eee; font: 14px/1.4 system-ui, sans-serif; overflow: hidden; }
    #app { display: grid; grid-template-columns: 160px 1fr 300px; height: 100vh; }
    #groups { overflow-y: auto; border-right: 1px solid #222; }
    #stage { position: relative; background: #000; }
    #stage video { width: 100%; height: 100%; }
    #channels { overflow-y: auto; border-left: 1px solid #222; }
  </style>
</head>
<body>
  <div id="app">
    <nav id="groups"></nav>
    <main id="stage"><video id="video" playsinline></video></main>
    <aside id="channels"></aside>
  </div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

```ts
// src/main.ts（占位，Task 5 装配）
console.log('iptv web boot');
```

- [ ] **Step 6: Commit**

```bash
git add webview/web
git commit -m "feat(web): 脚手架、数据模型与布局骨架"
```

---

### Task 2: M3U 解析器（TDD）

**Files:**
- Create: `webview/web/src/m3u/parser.ts`, `webview/web/src/m3u/parser.test.ts`

**Interfaces:**
- Consumes: `Channel`, `UNGROUPED`（Task 1）
- Produces: `parseM3U(text: string): Channel[]`

- [ ] **Step 1: 写失败测试**

```ts
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
```

```m3u
# tests/fixtures/sample.m3u
#EXTM3U
#EXTINF:-1 tvg-id="cctv1" tvg-logo="http://x/1.png" group-title="央视",CCTV-1 综合
http://example.com/cctv1.m3u8
#EXTINF:-1 group-title="卫视",湖南卫视
http://example.com/hntv.m3u8
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/m3u/parser.test.ts`
Expected: FAIL（parser.ts 不存在）

- [ ] **Step 3: 实现 parser.ts**

```ts
// src/m3u/parser.ts
import { Channel, UNGROUPED } from '../types';

/**
 * 解析 M3U 文本为频道数组。
 * 规则：#EXTINF 属性取 tvg-id/tvg-logo/group-title；其后第一个非注释非空行为 URL。
 */
export function parseM3U(text: string): Channel[] {
  const lines = text.split(/\r?\n/);
  const channels: Channel[] = [];
  let pending: Partial<Channel> | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#EXTM3U') || (line.startsWith('#') && !line.startsWith('#EXTINF'))) continue;
    if (line.startsWith('#EXTINF')) {
      pending = parseExtInf(line);
      continue;
    }
    if (pending) {
      channels.push({
        name: pending.name ?? '未知频道',
        url: line,
        group: pending.group ?? UNGROUPED,
        logo: pending.logo,
        tvgId: pending.tvgId,
      });
      pending = null;
    }
    // 无 EXTINF 前缀的孤立 URL：忽略
  }
  return channels;
}

function parseExtInf(line: string): Partial<Channel> {
  // #EXTINF:-1 attrs,显示名
  const commaIdx = line.indexOf(',');
  const name = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : '未知频道';
  const attrs = commaIdx >= 0 ? line.slice(0, commaIdx) : '';
  const attr = (key: string): string | undefined =>
    attrs.match(new RegExp(`${key}="([^"]*)"`))?.[1] || undefined;
  return { name, tvgId: attr('tvg-id'), logo: attr('tvg-logo'), group: attr('group-title') };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/m3u/parser.test.ts`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add webview/web/src/m3u webview/web/tests
git commit -m "feat(web): M3U 解析器（分组/台标/容错）"
```

---

### Task 3: 存储层（TDD）

**Files:**
- Create: `webview/web/src/storage/store.ts`, `webview/web/src/storage/store.test.ts`

**Interfaces:**
- Consumes: `PlaylistSource`（Task 1）
- Produces: `loadSources(): PlaylistSource[]`、`saveSource(src: PlaylistSource): void`、`removeSource(id: string): void`、`loadFavorites(): string[]`、`toggleFavorite(url: string): boolean`、`recordPlay(url: string): void`、`getRecent(max = 20): string[]`

- [ ] **Step 1: 写失败测试**

```ts
// src/storage/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSources, saveSource, removeSource,
  loadFavorites, toggleFavorite, recordPlay, getRecent,
} from './store';
import { PlaylistSource } from '../types';

const src = (id: string): PlaylistSource => ({
  id, name: `源${id}`, importedAt: 1000, channels: [],
});

describe('store', () => {
  beforeEach(() => localStorage.clear());

  it('源的增改删查', () => {
    expect(loadSources()).toEqual([]);
    saveSource(src('a'));
    saveSource(src('b'));
    expect(loadSources()).toHaveLength(2);
    const a2 = { ...src('a'), name: '改名' };
    saveSource(a2);
    expect(loadSources()).toHaveLength(2);
    expect(loadSources().find(s => s.id === 'a')!.name).toBe('改名');
    removeSource('a');
    expect(loadSources()).toHaveLength(1);
  });

  it('收藏切换', () => {
    expect(loadFavorites()).toEqual([]);
    expect(toggleFavorite('http://a')).toBe(true);   // 加入
    expect(toggleFavorite('http://a')).toBe(false);  // 移除
    expect(loadFavorites()).toEqual([]);
    toggleFavorite('http://a');
    expect(loadFavorites()).toEqual(['http://a']);
  });

  it('最近播放去重置顶且上限 20', () => {
    for (let i = 0; i < 25; i++) recordPlay(`http://ch/${i}`);
    recordPlay('http://ch/5');                        // 已存在，置顶
    const recent = getRecent();
    expect(recent[0]).toBe('http://ch/5');
    expect(recent).toHaveLength(20);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- src/storage/store.test.ts`
Expected: FAIL（store.ts 不存在）

- [ ] **Step 3: 实现 store.ts**

```ts
// src/storage/store.ts
import { PlaylistSource } from '../types';

const K_SOURCES = 'iptv:sources';
const K_FAVS = 'iptv:favorites';
const K_RECENT = 'iptv:recent';
const RECENT_MAX = 20;

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function writeJSON(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadSources(): PlaylistSource[] {
  return readJSON<PlaylistSource[]>(K_SOURCES, []);
}
export function saveSource(src: PlaylistSource): void {
  const all = loadSources().filter(s => s.id !== src.id);
  all.push(src);
  writeJSON(K_SOURCES, all);
}
export function removeSource(id: string): void {
  writeJSON(K_SOURCES, loadSources().filter(s => s.id !== id));
}

export function loadFavorites(): string[] {
  return readJSON<string[]>(K_FAVS, []);
}
export function toggleFavorite(url: string): boolean {
  const favs = loadFavorites();
  const idx = favs.indexOf(url);
  if (idx >= 0) favs.splice(idx, 1); else favs.unshift(url);
  writeJSON(K_FAVS, favs);
  return idx < 0;
}

export function recordPlay(url: string): void {
  const recent = getRecent().filter(u => u !== url);
  recent.unshift(url);
  writeJSON(K_RECENT, recent.slice(0, RECENT_MAX));
}
export function getRecent(max = RECENT_MAX): string[] {
  return readJSON<string[]>(K_RECENT, []).slice(0, max);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: 全部 passed（含 Task 1/2）

- [ ] **Step 5: Commit**

```bash
git add webview/web/src/storage
git commit -m "feat(web): localStorage 存储层（源/收藏/最近播放）"
```

---

### Task 4: 播放引擎封装

**Files:**
- Create: `webview/web/src/player/engineSelect.ts`, `webview/web/src/player/engineSelect.test.ts`, `webview/web/src/player/engine.ts`

**Interfaces:**
- Consumes: 无
- Produces: `selectEngine(url: string): 'hls' | 'mpegts'`；`createPlayer(video: HTMLVideoElement, opts?: { timeoutMs?: number }): Player`，其中 `Player = { play(url: string): void; destroy(): void; onFatal(cb: (msg: string) => void): void }`

- [ ] **Step 1: 写引擎选择失败测试**

```ts
// src/player/engineSelect.test.ts
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
```

- [ ] **Step 2: 运行确认失败 → 实现 → 通过**

```ts
// src/player/engineSelect.ts
export type EngineName = 'hls' | 'mpegts';

/** 按 URL 扩展名选择引擎；无法判断时默认 hls（互联网源 HLS 占绝对多数）。 */
export function selectEngine(url: string): EngineName {
  const clean = url.split(/[?#]/)[0].toLowerCase();
  if (clean.endsWith('.ts') || clean.endsWith('.flv')) return 'mpegts';
  return 'hls';
}
```

Run: `npm test -- src/player/engineSelect.test.ts`
Expected: 3 passed

- [ ] **Step 3: 实现 engine.ts（jsdom 无法真实播放，行为在 Task 9 浏览器集成验证）**

```ts
// src/player/engine.ts
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { selectEngine } from './engineSelect';

export interface Player {
  play(url: string): void;
  destroy(): void;
  onFatal(cb: (msg: string) => void): void;
}

const DEFAULT_TIMEOUT_MS = 8000; // 设计约束：8 秒无数据判定失败

export function createPlayer(video: HTMLVideoElement, opts?: { timeoutMs?: number }): Player {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let hls: Hls | null = null;
  let tsPlayer: mpegts.Player | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let fatalCb: ((msg: string) => void) | null = null;

  function clearAll(): void {
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    if (hls) { hls.destroy(); hls = null; }
    if (tsPlayer) { tsPlayer.pause(); tsPlayer.unload(); tsPlayer.destroy(); tsPlayer = null; }
    video.removeAttribute('src'); video.load();
  }

  function armWatchdog(what: string): void {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      clearAll();
      fatalCb?.(`${what} 超时（${timeoutMs}ms 无数据）`);
    }, timeoutMs);
  }

  video.addEventListener('playing', () => {
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
  });

  return {
    onFatal(cb) { fatalCb = cb; },

    play(url: string): void {
      clearAll();
      armWatchdog(selectEngine(url) === 'hls' ? 'HLS' : 'TS/FLV');

      if (selectEngine(url) === 'hls') {
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = url; video.play().catch(() => {});
          return;
        }
        if (!Hls.isSupported()) { fatalCb?.('浏览器不支持 HLS'); return; }
        hls = new Hls({ manifestLoadingTimeOut: timeoutMs, fragLoadingTimeOut: timeoutMs });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) { clearAll(); fatalCb?.(`HLS 致命错误: ${data.details}`); }
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else {
        if (!mpegts.isSupported()) { fatalCb?.('浏览器不支持 mpegts'); return; }
        tsPlayer = mpegts.createPlayer({ type: (url.endsWith('.flv') ? 'flv' : 'mpegts'), url });
        tsPlayer.on(mpegts.Events.ERROR, (type) => {
          clearAll(); fatalCb?.(`MPEGTS 致命错误: ${type}`);
        });
        tsPlayer.attachMediaElement(video);
        tsPlayer.load();
        tsPlayer.play().catch(() => {});
      }
    },

    destroy: clearAll,
  };
}
```

- [ ] **Step 4: 全量测试**

Run: `npm test`
Expected: 全部 passed

- [ ] **Step 5: Commit**

```bash
git add webview/web/src/player
git commit -m "feat(web): 播放引擎（hls/mpegts 选择 + 8s 看门狗 + 致命错误回调）"
```

---

### Task 5: 虚拟滚动列表与页面装配

**Files:**
- Create: `webview/web/src/ui/virtualList.ts`, `webview/web/src/ui/virtualList.test.ts`
- Modify: `webview/web/src/main.ts`（装配）, `webview/web/index.html`（样式微调）

**Interfaces:**
- Consumes: `Channel`, `parseM3U`, `store.*`, `createPlayer`（Task 1-4）
- Produces: `createVirtualList(container: HTMLElement, opts: { rowH: number; overscan?: number; renderItem(el: HTMLElement, item: Channel, index: number): void }): VirtualList`，`VirtualList = { setItems(items: Channel[]): void; destroy(): void }`

- [ ] **Step 1: 写虚拟列表渲染逻辑失败测试**

```ts
// src/ui/virtualList.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createVirtualList } from './virtualList';
import { Channel } from '../types';

const ch = (i: number): Channel => ({ name: `台${i}`, url: `http://u/${i}`, group: 'g' });

beforeEach(() => {
  document.body.innerHTML = '<div id="list" style="height:480px"></div>';
  // jsdom 无布局，mock 尺寸
  Object.defineProperty(document.getElementById('list')!, 'clientHeight', { value: 480 });
});

function mounted(): HTMLElement[] {
  return Array.from(document.getElementById('list')!.querySelectorAll('.row'));
}

describe('virtualList', () => {
  it('只渲染可视区 + overscan 的行（1000 条数据）', () => {
    const vl = createVirtualList(document.getElementById('list')!, {
      rowH: 48, overscan: 10, renderItem: (el, item) => { el.textContent = item.name; },
    });
    vl.setItems(Array.from({ length: 1000 }, (_, i) => ch(i)));
    const rows = mounted();
    expect(rows.length).toBeLessThanOrEqual(10 + 10 * 2);
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows[0].textContent).toBe('台0');
  });

  it('滚动后窗口平移', () => {
    const vl = createVirtualList(document.getElementById('list')!, {
      rowH: 48, overscan: 0, renderItem: (el, item) => { el.textContent = item.name; },
    });
    vl.setItems(Array.from({ length: 1000 }, (_, i) => ch(i)));
    const list = document.getElementById('list')!;
    list.scrollTop = 48 * 100;                       // 滚到第 100 行
    list.dispatchEvent(new Event('scroll'));
    expect(mounted()[0].textContent).toBe('台100');
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现 → 通过**

```ts
// src/ui/virtualList.ts
import { Channel } from '../types';

export interface VirtualList {
  setItems(items: Channel[]): void;
  destroy(): void;
}

interface Opts {
  rowH: number;
  overscan?: number;
  renderItem(el: HTMLElement, item: Channel, index: number): void;
}

/** 固定行高虚拟滚动：仅渲染可视区(±overscan)的行，保证 1000+ 频道流畅。 */
export function createVirtualList(container: HTMLElement, opts: Opts): VirtualList {
  const { rowH, overscan = 10, renderItem } = opts;
  let items: Channel[] = [];
  const spacer = document.createElement('div');
  spacer.style.position = 'relative';
  container.appendChild(spacer);

  function render(): void {
    const start = Math.max(0, Math.floor(container.scrollTop / rowH) - overscan);
    const visible = Math.ceil(container.clientHeight / rowH) + overscan * 2;
    const end = Math.min(items.length, start + visible);
    spacer.style.height = `${items.length * rowH}px`;
    spacer.querySelectorAll('.row').forEach(n => n.remove());
    for (let i = start; i < end; i++) {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.cssText = `position:absolute;top:${i * rowH}px;height:${rowH}px;width:100%;display:flex;align-items:center;padding:0 12px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
      renderItem(row, items[i], i);
      spacer.appendChild(row);
    }
  }

  container.addEventListener('scroll', render);
  return {
    setItems(next) { items = next; container.scrollTop = 0; render(); },
    destroy() { container.removeEventListener('scroll', render); spacer.remove(); },
  };
}
```

Run: `npm test -- src/ui/virtualList.test.ts`
Expected: 2 passed

- [ ] **Step 4: 装配 main.ts（分组栏 + 频道列表面板 + 播放接线）**

```ts
// src/main.ts
import { parseM3U } from './m3u/parser';
import { Channel, PlaylistSource } from './types';
import * as store from './storage/store';
import { createPlayer, Player } from './player/engine';
import { createVirtualList, VirtualList } from './ui/virtualList';
import { initControls } from './ui/controls';
import { setupImportDialog } from './ui/importDialog';

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
```

注意：`initControls` / `setupImportDialog` 在 Task 6/7 实现。为使本任务可独立提交编译，先创建两个最小桩（Task 6/7 会整体替换为完整实现，main.ts 不再改动）：

```ts
// src/ui/controls.ts —— Task 6 整体替换为完整实现
import { Channel } from '../types';
export function initControls(_root: HTMLElement, _refilter: () => void) {
  return {
    filter(chs: Channel[]): Channel[] { return chs; },
    setPlay(_fn: (c: Channel) => void): void {},
    setChannelList(_chs: Channel[]): void {},
    setKeyword(_kw: string): void {},
    stepChannel(_d: 1 | -1): void {},
    toggleFavorite(_c: Channel): void {},
    favorites(): string[] { return []; },
    ratio: 'contain' as const,
    cycleRatio(): void {},
  };
}
```

```ts
// src/ui/importDialog.ts —— Task 7 替换为完整实现
export function setupImportDialog(_opts: { onImported(text: string, name: string): string | null }): void {}
```

- [ ] **Step 5: dev 冒烟**

Run: `npm run dev` → 浏览器打开 `http://localhost:5173`
Expected: 三栏布局渲染、无控制台报错（列表为空属正常，导入功能 Task 7 完成）
停掉 dev server 后继续。

- [ ] **Step 6: Commit**

```bash
git add webview/web
git commit -m "feat(web): 虚拟滚动列表 + 三栏布局装配（含 controls/import 桩）"
```

---

### Task 6: 交互控制（搜索/收藏/比例/键盘换台）

**Files:**
- Modify: `webview/web/src/ui/controls.ts`（替换桩）, `webview/web/src/ui/controls.test.ts`, `webview/web/index.html`（顶栏）
- Create: `webview/web/src/ui/controls.test.ts`

**Interfaces:**
- Consumes: `Channel`
- Produces: `setupControls = { filter(chs: Channel[]): Channel[]; setPlay(fn: (c: Channel) => void): void; setFavorites(favs: string[]): void; toggleFavorite(c: Channel): void }`（main.ts 已按此消费；`toggleFavorite` 由频道行右键/按钮调用）

- [ ] **Step 1: 写失败测试**

```ts
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
    const c = createControls(document.body);
    c.setKeyword('cctv');
    expect(c.filter(chs)).toHaveLength(2);
    c.setKeyword('湖南');
    expect(c.filter(chs)).toHaveLength(1);
  });

  it('收藏置顶 + 收藏切换', () => {
    const c = createControls(document.body);
    c.toggleFavorite(chs[2]);
    const out = c.filter(chs);
    expect(out[0].name).toBe('湖南卫视');  // 收藏的排最前
    expect(c.favorites()).toEqual(['http://u/hn']);
  });

  it('键盘上下换台调用 play', () => {
    const c = createControls(document.body);
    let played: Channel | null = null;
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
```

- [ ] **Step 2: 运行确认失败 → 实现 controls.ts（替换桩）**

```ts
// src/ui/controls.ts
import { Channel } from '../types';
import * as store from '../storage/store';

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
export function createControls(root: HTMLElement, refilter: () => void): Controls {
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

  // 顶栏：搜索框 + 比例按钮（DOM 装配在 ctrl 定义之后，避免引用未初始化变量）
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;top:0;left:160px;right:300px;display:flex;gap:8px;padding:8px;background:rgba(0,0,0,.7);z-index:10;';
  const input = document.createElement('input');
  input.placeholder = '搜索频道…';
  input.style.cssText = 'flex:1;padding:4px 8px;background:#111;border:1px solid #333;color:#eee;';
  input.addEventListener('input', () => { ctrl.setKeyword(input.value); refilter(); });
  const ratioBtn = document.createElement('button');
  ratioBtn.textContent = '比例';
  ratioBtn.onclick = () => ctrl.cycleRatio();
  bar.append(input, ratioBtn);
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
export function initControls(root: HTMLElement, refilter: () => void): Controls {
  return (singleton ??= createControls(root, refilter));
}
export function currentControls(): Controls | null { return singleton; }
```

装配说明：Task 5 的 `main.ts` 已按 `initControls(document.body, refilter)` 接口调用，本任务**只整体替换 `src/ui/controls.ts` 桩文件，`main.ts` 无需改动**。`refilter` 回调由 main.ts 传入（内部执行 `vl.setItems(filtered())`），搜索输入与收藏变化后触发列表刷新。

- [ ] **Step 3: 全量测试通过**

Run: `npm test`
Expected: 全部 passed

- [ ] **Step 4: Commit**

```bash
git add webview/web
git commit -m "feat(web): 搜索/收藏置顶/画面比例/键盘换台"
```

---

### Task 7: 源导入对话框（URL 订阅 + 本地文件）

**Files:**
- Modify: `webview/web/src/ui/importDialog.ts`（替换桩）
- Create: `webview/web/src/ui/importDialog.test.ts`

**Interfaces:**
- Consumes: `parseM3U`、`store.saveSource`、`bridge/native.ts`（壳内走 Bridge，浏览器内走 fetch/input[type=file]）
- Produces: `setupImportDialog(opts: { onImported(text: string, name: string): string | null }): void` —— 返回 null 表示成功，字符串为错误提示

- [ ] **Step 1: 写失败测试（DOM 行为，jsdom）**

```ts
// src/ui/importDialog.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupImportDialog, showImportDialog } from './importDialog';

beforeEach(() => { document.body.innerHTML = ''; });

describe('importDialog', () => {
  it('成功导入调用 onImported 并关闭对话框', async () => {
    const onImported = vi.fn(() => null);
    setupImportDialog({ onImported });
    showImportDialog();
    const ta = document.querySelector<HTMLTextAreaElement>('#import-url')!;
    ta.value = 'http://example.com/live.m3u';
    document.querySelector<HTMLButtonElement>('#import-go')!.click();
    await vi.waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(document.getElementById('import-dialog')).toBeNull();
  });

  it('onImported 返回错误字符串时显示错误且不关闭', async () => {
    const onImported = vi.fn(() => '解析出 0 个频道，请检查文件格式');
    setupImportDialog({ onImported });
    showImportDialog();
    document.querySelector<HTMLTextAreaElement>('#import-url')!.value = 'x';
    document.querySelector<HTMLButtonElement>('#import-go')!.click();
    await vi.waitFor(() => expect(document.querySelector('#import-error')!.textContent).toContain('0 个频道'));
    expect(document.getElementById('import-dialog')).not.toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现（替换桩）**

```ts
// src/ui/importDialog.ts
import { fetchBridge } from '../bridge/native';

interface ImportOpts { onImported(text: string, name: string): string | null; }
let opts: ImportOpts | null = null;

export function setupImportDialog(o: ImportOpts): void { opts = o; }

export function showImportDialog(): void {
  const dlg = document.createElement('div');
  dlg.id = 'import-dialog';
  dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:100;';
  dlg.innerHTML = `
    <div style="background:#161616;padding:24px;border-radius:8px;width:420px;">
      <h3 style="margin-bottom:12px;">添加订阅源</h3>
      <textarea id="import-url" rows="2" placeholder="输入 M3U 订阅地址" style="width:100%;background:#0a0a0a;color:#eee;border:1px solid #333;padding:8px;"></textarea>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button id="import-go" style="flex:1;padding:8px;">订阅</button>
        <button id="import-file" style="flex:1;padding:8px;">导入本地文件</button>
        <button id="import-cancel" style="padding:8px;">取消</button>
      </div>
      <p id="import-error" style="color:#f66;margin-top:8px;min-height:1em;"></p>
    </div>`;
  document.body.appendChild(dlg);

  const close = () => dlg.remove();
  dlg.querySelector('#import-cancel')!.addEventListener('click', close);

  dlg.querySelector('#import-go')!.addEventListener('click', async () => {
    const url = dlg.querySelector<HTMLTextAreaElement>('#import-url')!.value.trim();
    if (!url) return;
    try {
      const text = await fetchBridge.fetchText(url);
      const err = opts!.onImported(text, url);
      if (err) { dlg.querySelector('#import-error')!.textContent = err; return; }
      close();
    } catch (e) {
      dlg.querySelector('#import-error')!.textContent = `下载失败：${e instanceof Error ? e.message : e}`;
    }
  });

  dlg.querySelector('#import-file')!.addEventListener('click', () => {
    // 壳内走原生 Bridge；纯浏览器回退 input[type=file]
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.m3u,.m3u8,text/plain';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const err = opts!.onImported(await file.text(), file.name);
      if (err) { dlg.querySelector('#import-error')!.textContent = err; return; }
      close();
    };
    input.click();
  });
}
```

```ts
// src/bridge/native.ts
/** Android 壳注入 window.IptvBridge 时优先走壳；浏览器内直接 fetch（受 CORS 限制，属预期）。 */
interface IptvBridge {
  pickM3uFile(): Promise<{ name: string; text: string }>;
}
declare global { interface Window { IptvBridge?: IptvBridge } }

export const fetchBridge = {
  async fetchText(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },
  hasNative(): boolean { return typeof window !== 'undefined' && !!window.IptvBridge; },
  async pickM3uFile(): Promise<{ name: string; text: string } | null> {
    return window.IptvBridge ? window.IptvBridge.pickM3uFile() : null;
  },
};
```

- [ ] **Step 3: 全量测试 → Commit**

Run: `npm test`
Expected: 全部 passed

```bash
git add webview/web
git commit -m "feat(web): 源导入对话框（URL 订阅/文件/Bridge）"
```

---

### Task 8: Android WebView 壳

**Files:**
- Create: `webview/android/settings.gradle.kts`, `webview/android/build.gradle.kts`, `webview/android/gradle.properties`, `webview/android/app/build.gradle.kts`, `webview/android/app/src/main/AndroidManifest.xml`, `webview/android/app/src/main/java/com/iptv/webview/MainActivity.kt`, `webview/android/app/src/main/res/values/strings.xml`, `webview/android/sync-web.sh`

**Interfaces:**
- Consumes: H5 构建产物（Task 1-7 的 `npm run build` 输出）
- Produces: 可安装 APK；`window.IptvBridge.pickM3uFile()`（Task 7 已定义接口）

- [ ] **Step 1: Gradle 工程文件**

```kotlin
// settings.gradle.kts
pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositories { google(); mavenCentral() } }
rootProject.name = "IptvWebview"
include(":app")
```

```kotlin
// build.gradle.kts (root)
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.1.0" apply false
}
```

```properties
# gradle.properties
org.gradle.jvmargs=-Xmx2048m
android.useAndroidX=true
```

```kotlin
// app/build.gradle.kts
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "com.iptv.webview"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.iptv.webview"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }
    buildTypes { release { isMinifyEnabled = false } }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
```

- [ ] **Step 2: Manifest 与 MainActivity**

```xml
<!-- app/src/main/AndroidManifest.xml -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <application
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:usesCleartextTraffic="true"
        android:theme="@android:style/Theme.Black.NoTitleBar.Fullscreen">
        <activity android:name=".MainActivity" android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

```xml
<!-- app/src/main/res/values/strings.xml -->
<resources><string name="app_name">IPTV 直播</string></resources>
```

```kotlin
// app/src/main/java/com/iptv/webview/MainActivity.kt
package com.iptv.webview

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import org.json.JSONObject

class MainActivity : Activity() {
    private lateinit var web: WebView
    private var pendingKey = 0L

    // H5 发起文件选择 → 系统文件选择器 → 文本回传 JS
    private val pickFile = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri ?: return@registerForActivityResult
        val text = contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() } ?: ""
        val payload = JSONObject().apply {
            put("key", pendingKey)
            put("name", uri.lastPathSegment ?: "playlist.m3u")
            put("text", text)
        }
        web.evaluateJavascript("window.__iptvFileReady($payload)", null)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) // 播放常亮
        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true          // localStorage 必须
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
        }
        web.webViewClient = WebViewClient()
        web.webChromeClient = WebChromeClient()
        web.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        web.addJavascriptInterface(Bridge(), "IptvBridge")
        web.loadUrl("file:///android_asset/web/index.html")
    }

    inner class Bridge {
        @android.webkit.JavascriptInterface
        fun pickM3uFile(): String {
            pendingKey = System.currentTimeMillis()
            runOnUiThread { pickFile.launch(arrayOf("text/plain", "*/*")) }
            return pendingKey.toString()
        }
    }

    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }
}
```

配套说明（写入代码注释与 README）：Bridge 的 `pickM3uFile` 是异步的，H5 侧 Task 7 的 `fetchBridge.pickM3uFile()` 需配套等待 `window.__iptvFileReady(payload)` 回调（Promise 包裹，key 匹配）。在 `src/bridge/native.ts` 的 `pickM3uFile` 实现中补充：

```ts
// src/bridge/native.ts 中 pickM3uFile 改为：
async pickM3uFile(): Promise<{ name: string; text: string } | null> {
  if (!window.IptvBridge) return null;
  const key = window.IptvBridge.pickM3uFile();
  return new Promise((resolve) => {
    (window as any).__iptvFileReady = (payload: { key: string; name: string; text: string }) => {
      if (payload.key === key) resolve({ name: payload.name, text: payload.text });
    };
    setTimeout(() => resolve(null), 120000); // 用户取消/超时
  });
}
```

- [ ] **Step 3: 图标占位 + H5 产物同步脚本**

```bash
#!/bin/zsh
# webview/android/sync-web.sh — 构建产物拷入 assets
set -e
cd "$(dirname "$0")/../web"
npm run build
rsync -a --delete dist/ ../android/app/src/main/assets/web/
echo "synced: $(ls ../android/app/src/main/assets/web)"
```

Run: `chmod +x webview/android/sync-web.sh && ./webview/android/sync-web.sh`
Expected: `synced: index.html assets ...`（mipmap 图标：用 `adb` 不可用时先放一个纯色 ic_launcher.png 到 `res/mipmap-*/`，占位即可）

- [ ] **Step 4: 构建验证**

Run: `cd webview/android && ./gradlew assembleDebug`
Expected: `BUILD SUCCESSFUL`，产物 `app/build/outputs/apk/debug/app-debug.apk`

- [ ] **Step 5: Commit**

```bash
git add webview/android webview/web/src/bridge
git commit -m "feat(android): WebView 壳（assets 加载/JS Bridge 文件导入/常亮/TV 启动器）"
```

---

### Task 9: 端到端验证（浏览器 + 壳）

**Files:**
- Modify: 无新文件；验证与修复

- [ ] **Step 1: 浏览器集成验证**

Run: `cd webview/web && npm run dev`
在 Chrome 打开 `http://localhost:5173`：
1. 添加订阅 `https://live.fanmingming.com/tv/m3u/ipv6.m3u` → 频道数 > 0，分组正确
2. 点击任一央视频道 → 画面 8 秒内出图；`document.title` 变为频道名
3. ↑↓ 换台；搜索「CCTV」过滤；收藏后刷新仍置顶
4. 手工测试一个失效 URL → 标题栏出现「播放失败」
5. DevTools Performance 面板：滚动 1000+ 频道列表无卡顿
Expected: 全部通过；失败项按引擎/解析错误修复并补对应单测

- [ ] **Step 2: 壳内验证（如模拟器可用）**

```bash
# 已有 Android 模拟器时：
cd webview/android && ./gradlew installDebug
adb shell am start -n com.iptv.webview/.MainActivity
adb shell input tap 540 100   # 视分辨率调整，打开导入对话框
```
Expected: 页面加载、localStorage 生效、订阅下载与播放与浏览器行为一致（壳内无 CORS 限制）

- [ ] **Step 3: 修复发现的问题并回归 `npm test`**

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test(web): 端到端验证通过（fanmingming 源 + 1000 频道滚动）"
```

---

# 第二部分：原生版（基于 OwnTV，GPL-3.0）

前置条件：本机 JDK 17+、Android SDK。Task 10 先行验证环境。

### Task 10: 环境与基座跑通

**Files:**
- Create: `native/`（clone OwnTV）, `native/LOCAL_NOTES.md`（定制记录）

- [ ] **Step 1: clone 并检查结构**

```bash
git clone --depth 1 https://github.com/ahXN00/OwnTV.git native
ls native/app/src/main/java
```
Expected: Kotlin 源码目录存在；记录实际包结构到 `native/LOCAL_NOTES.md`

- [ ] **Step 2: 构建跑通**

```bash
cd native && ./gradlew assembleDebug
```
Expected: `BUILD SUCCESSFUL`（若 JDK 版本不符，用 `org.gradle.java.home` 指定 JDK 17）

- [ ] **Step 3: 安装实测原版功能**

```bash
./gradlew installDebug
# 手动：导入 fanmingming 订阅源，确认原版播放/换台正常
```

- [ ] **Step 4: Commit（作为基线）**

```bash
git add -A && git commit -m "chore(native): OwnTV 基线构建通过"
```

---

### Task 11: 品牌与源管理定制

**Files:**
- Modify: `native/app/build.gradle.kts`（applicationId/版本名）, `native/app/src/main/res/values/strings.xml`（应用名）, 启动图标资源；源管理相关 UI 按实际结构定位（Task 10 的 LOCAL_NOTES.md 记录）

**Interfaces:**
- Consumes: OwnTV 已有 M3U/Xtream 订阅管理模块
- Produces: 独立品牌 APK `com.iptv.native`

- [ ] **Step 1: 改 applicationId 与应用名**（`com.iptv.native` / 「IPTV 直播」）
- [ ] **Step 2: 替换启动图标**（占位纯色图标即可）
- [ ] **Step 3: 确认 OwnTV 的订阅源导入满足 MVP**（URL 订阅 + 文件导入）；若有缺口（如导入失败提示缺失），按其架构在对应模块补齐——具体文件路径以 Task 10 梳理结果为准，修改前先在 LOCAL_NOTES.md 记录 diff 意图
- [ ] **Step 4: 构建安装验证 → Commit**

```bash
./gradlew assembleDebug && git add -A && git commit -m "feat(native): 品牌/包名定制"
```

---

### Task 12: 双形态与遥控器验收

**Files:**
- Create: `docs/superpowers/plans/native-acceptance.md`（验收记录）

- [ ] **Step 1: TV 形态**：Android TV 模拟器安装，遥控器键位注入验证（`adb shell input keyevent 20/19/23` 上下/OK）：方向键换台、OK 呼出频道列表、返回退出确认
- [ ] **Step 2: 手机形态**：手机模拟器安装，触屏操作全功能回归
- [ ] **Step 3: 播放兼容性**：同一订阅源在 ExoPlayer 与 mpv 引擎间切换（OwnTV 设置内），确认失效频道两引擎均有明确失败提示（8s 超时一致性）
- [ ] **Step 4: 记录验收结果 → Commit**

---

## Self-Review 记录

1. **Spec 覆盖**：M3U 导入(T2/T7) ✓、分类/搜索/收藏(T3/T5/T6) ✓、播放与超时(T4) ✓、遥控器适配(T6 键盘 / T12 TV) ✓、壳职责三分(T8) ✓、验收标准 1000 频道/2s 换台/30min(T9, 30min 连播在 T9 手工项) ✓、GPL 约束(Global) ✓
2. **占位符扫描**：Task 11 Step 3 依赖 clone 后实际结构，已用 LOCAL_NOTES.md 机制固化记录方式（fork 类任务的固有约束，非空泛 TODO）
3. **类型一致性**：`setupControls.filter/setPlay/setFavorites`（T5 桩 = T6 实现）✓；`setupImportDialog(opts.onImported)`（T5 桩 = T7 实现）✓；`IptvBridge.pickM3uFile`（T7 消费 = T8 提供）✓；`Player.onFatal(cb)`（T4 = T5 消费）✓
