# 自动 IPTV 源验收记录

日期：2026-11-07
分支：dev

## WebView 版（完整端到端实测）

| # | 项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 内置清单拉取 | ✅ | Guovin（396KB/1619 频道）+ Fanmingming（82 频道），浏览器 fetch 成功 |
| 2 | URL 去重 | ✅ | 1624（1619+82 去重后） |
| 3 | 并发测速（16 并发/5s 超时） | ✅ | 浏览器内约 6 分钟跑完 1624 个 |
| 4 | 死频道剔除 | ✅ | 279/1624 可用；**IPv6 字面量频道 0 残留**（本机无 v6 出口，媒体探测判死） |
| 5 | CORS 不可判定语义 | ✅ | 浏览器内 fetch TypeError → m3u8 走**媒体元素二次探测**（不受 CORS 限制）精确裁决；非 m3u8 保守保留（unknown）；壳内确定性判死 |
| 6 | 测速缓存 24h | ✅ | `iptv:autoProbe` 1624 条落盘；二跑命中缓存跳过重测 |
| 7 | 同名频道取最快 | ✅ | 多线路同台只留延迟最小者 |
| 8 | 完成后自动刷新 | ✅ | 列表 36→35 组自动更新（修复 initControls 单例固化 onAutoDone 的 bug） |
| 9 | 缓存时序回归 | ✅ | 曾因写入时机在 fresh 合并前写空，已修并加回归断言 |
| 10 | 播放 | ✅ | CCTV-2 出图 1280×720（媒体探测判定与实测一致） |
| 11 | 单测 | ✅ | 71/71（probe 10 / merge 8 / manager 5 含回归） |

## 原生版（OwnTV app 层）

| # | 项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 构建 | ✅ | assembleDebug BUILD SUCCESSFUL（i18n 门禁：技术字面量 classify-safe，用户可见的『未分组/未知频道』登记 baseline debt） |
| 2 | 首启跳过 | ✅ | 无 profile 时 `skip: onboarding not finished (no profile yet)`（修复：避免 core 兜底 fallback profile 导致源与用户 profile 脱节） |
| 3 | 自定义源清单 | ✅ | SharedPreferences `custom_sources` 覆盖内置清单（与 WebView 版对等能力）；测试用 run-as 注入 |
| 4 | 拉取/解析/去重 | ✅ | `fetched 1619 raw → dedupe 1554`（Guovin 源） |
| 5 | 测速 | ✅ | IP 直连清单 7/7 ok，7 秒完成（模拟器 DNS 污染环境下域名频道逐个超时，见环境限制） |
| 6 | 同名裁决 + 净化 M3U | ✅ | `cleaned m3u written: 3 channels`（7 条线路→3 个唯一频道） |
| 7 | core 导入 | ✅ | `auto source imported: 3 channels`（`SourceImporter.m3u` 本地文件路径） |
| 8 | 24h 节流 | ✅ | SharedPreferences 记录；DNS 挂起场景实测不会误记成功节流 |
| 9 | 跨 profile 链接 | ✅ 代码 | 导入后 `linkAutoSourceToAllProfiles()` 补齐所有 profile 的链接（core 的 profile↔source 是多对多链接表） |
| 10 | 完整 UI 链路 | ⚸ 部分 | 向导→主界面→频道显示的 UI 走查受 Compose 向导自动化限制；向导本身可用性已在 Task 12 验证 |

## 环境限制（非代码缺陷）

- **模拟器 DNS 污染**：模拟器内无法解析 GitHub/域名（宿主网络环境特性）。已用宿主静态 serve + IP 直连清单绕开完成全链路验证；真实设备网络正常时无此问题。
- **getaddrinfo 不可取消**：connectTimeout 管不到 DNS 解析，withTimeout 救不了阻塞中的系统调用——已在 fetch/probe 外层加总时长兜底（协程取消对阻塞调用无效，但至少保证任务最终结束），并把模拟器 DoT 悬连问题记为环境项。
- 本机无 IPv6 出口，IPv6 频道被正确剔除属预期行为。

## 交付物

- WebView 版：`webview/web/src/auto/{sources,probe,merge,manager}.ts` + `ui/autoDialog.ts` + `storage/autoStore.ts`，71/71 单测
- 原生版：`native/app/src/main/java/tv/own/owntv/auto/AutoSourceManager.kt` + AppModule 注册 + MainActivity 启动挂钩
- 设计：`docs/superpowers/specs/2026-11-07-auto-source-design.md`
