# 自动 IPTV 源设计（一期补充）

日期：2026-11-07
状态：已确认（拉取+客户端测速筛选；两版本都做）
基线：2026-11-06-iptv-player-design.md（一期交付已完成，dev 分支）

## 需求

应用内置公开源清单，一键「自动获取频道」：拉取 → 合并去重 → **客户端测速筛选**（剔除不可用频道）→ 入库展示。无需自建服务端。

## 可达性实测结论（2026-11-07，本机）

| 源 | 状态 |
|---|---|
| `Guovin/iptv-api` result.m3u（1619 频道，1549 IPv4） | ✅ 可达，作为主力源 |
| `fanmingming/live` ipv6.m3u（82 频道） | ✅ 可达（但本机无 IPv6 出口，频道级不可用——测速筛选的必要性实证） |
| 源内频道抽样：约 25% URL 在本机不可达（freetv.fun / dxhmt.cn 超时） | ⚠️ 不筛选则大量死频道 |

结论：拉取 + 测速筛选符合实际网络环境；IPv6 频道在无 IPv6 出口的网络会被自动剔除（预期行为）。

## WebView 版设计

### 数据流

```
内置清单(JSON,编译期打包) → 逐源拉取 M3U(单源失败降级用缓存) → parseM3U
  → URL 去重 → 并发测速(16 并发, 5s 超时) → 同名频道取延迟最小者
  → 存为 PlaylistSource(id='auto') → 复用现有列表/搜索/收藏/播放
```

### 测速协议（probe.ts）

- GET + `AbortController`：收到响应头后测 TTFB，随即 abort（避免下载 TS 大文件）
- 判定：2xx 且 TTFB < 5000ms；`.m3u8` 额外校验响应体含 `#EXTM3U`（读前 1KB）
- 并发 16；进度回调（done/total）；可取消（AbortController 全量中止）
- 结果缓存 `iptv:autoProbe` `{at, results[url]:{ok,latencyMs}}`，24h 内复用不重测

### 内置清单（sources.ts）

```ts
export const BUILTIN_SOURCES = [
  { name: 'Guovin IPTV-API', url: 'https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/result.m3u' },
  { name: 'Fanmingming Live', url: 'https://raw.githubusercontent.com/fanmingming/live/main/tv/m3u/ipv6.m3u' },
] as const;
```

用户可编辑（localStorage `iptv:autoSources` 覆盖默认值；空数组 = 恢复默认）。

### UI

顶栏新按钮「自动源」→ 对话框：源清单（可增删启停）、「开始获取」、进度条（拉取中/测速 n/total）、结果摘要（可用 X / 总 Y，平均延迟）、完成后自动 reload 频道列表。auto 源在分组栏显示为「自动源」。

### 壳

无需改动（cleartext 已允许；Bridge 不涉及）。

## 原生版设计（OwnTV app 层，不动 core）

- 复用 core 的导入链路（`SourceRepository`/`SourceImporter`，Task 11 已确认 app→core 程序化路径存在），新增 app 层 `AutoSourceManager`：
  - 内置同一份清单（Kotlin 常量）
  - 启动后台 + 设置页手动触发：拉取 → 解析（复用 core parser）→ **测速**（HTTP HEAD/GET 超时 5s，协程并发 16）→ 可用频道生成临时 M3U 提交导入（或走 core 程序化 API，以源码确认为准）
  - 设置页新增「自动获取频道」开关 + 最近一次获取结果展示
- 若 core 已有多源管理（OwnTV 本身支持多 playlist），auto 结果作为一个普通 playlist 写入，命名「自动源」

## 验收标准

- WebView 版：真实拉取 Guovin（1619 频道）→ 测速全程有进度 → 完成后仅展示可用频道，死频道（freetv.fun 等）被剔除；断网/单源失败不崩溃，用缓存
- 原生版：装机实测同样链路；开关可关闭
- 两版新增逻辑 TDD（测速/合并/去重为纯函数，mock fetch 测试）

## 明确不做（二期）

视频流解码级验证（只测 HTTP 可达性+manifest 标记）、频道线路备份、定时自动刷新（先手动触发）、自建服务端。
