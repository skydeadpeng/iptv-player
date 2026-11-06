# 原生版（OwnTV 定制）验收记录

日期：2026-11-07
分支：dev
APK：`native/app/build/outputs/apk/standard/debug/app-standard-debug.apk`
设备：emulator-5554（Android 14，AOSP **手机** arm64 镜像，无 leanback 特性）

## 构建与包信息

| 项 | 值 |
|---|---|
| applicationId | `com.iptv.native` |
| namespace | `com.iptv.tv`（`native` 是 Java 关键字，不能作 namespace） |
| 应用名（launcher label） | IPTV 直播 |
| 构建 | `./gradlew assembleDebug` → BUILD SUCCESSFUL（standard + x86_64 flavor） |
| lint | `:app:lintStandardDebug` 通过 |
| 引擎 | ExoPlayer（livePreviewEngine）+ mpv（ownTVPlayer）双引擎 |
| 基座 | OwnTV（GPL-3.0），业务内核为外部产物 `tv.own.owntv:core:1.0.69` + `player-core:1.0.69` |

## 验收结果

| # | 项目 | 结果 | 证据 |
|---|---|---|---|
| 1 | APK 构建 | ✅ | BUILD SUCCESSFUL；两个 flavor 均产出 |
| 2 | 装机启动 | ✅ | `Installed: Success`；`Displayed com.iptv.native/.MainActivity for user 0: +1s350ms`；crash buffer 空 |
| 3 | 首启流程 | ✅ | Profile 选择 → 主界面（Live TV / 搜索 / 首页等侧边导航）渲染完整 |
| 4 | 设置导航 | ✅ | 设置页渲染；搜索「playlist」命中 6 项，定位到 `Sources & guide → Playlists` |
| 5 | **订阅源添加（URL）** | ✅ | Companion 服务提交 M3U URL → `runImport sync success sourceId=2 profile=1`；源出现在 Playlists 列表（`M3U · https://test-streams.mux.dev/...`） |
| 6 | **订阅源添加（本地文件）** | ✅ | `AddSourceScreen.kt:552-561` 的 StorageBrowser（`fileExtensions = {m3u, m3u8}`）→ `m3uUrl = file.absolutePath`；core `sync/LocalPlaylistFile.kt` + `M3uSyncer.kt:68-69` 本地与 http 同一 parser |
| 7 | **M3U 解析** | ✅ | 宿主提供含 `#EXTINF` 的频道表 → 拉取成功（`HttpClient GET body done url=http://10.0.2.2:8098/channels.m3u totalMs=16`）→ 解析出 **3 channels** 并显示频道名 |
| 8 | **播放** | ✅ | 点击 Channel One → 全屏出图（截图 `task12-playing.png`）；引擎健康检查 `health posMs=2578 frames=63 dropped=0 isPlaying=true` |
| 9 | **遥控器：DPAD 导航** | ✅ | `adb shell input keyevent 22`（▶）打开右侧操作面板并聚焦「Start Import」，键位提示条完整显示（`◀◀ Change` / `▶ Start import` / `Back Add a source`） |
| 10 | **遥控器：DPAD 换台** | ✅ | `keyevent 20`（▼）换台成功：`ensurePlaying history profile=1 channelId=7`，新流 `http_response code=200 ... url=.../stream_1000k_48k_640x360_001.ts` |
| 11 | 源管理 | ✅ | Playlists 页可列出已添加源（名称 + 类型 + URL），支持 Add Source 入口 |
| 12 | 引擎切换（ExoPlayer ↔ mpv） | ⚠️ 部分 | 引擎由 `di/PlayerModule.kt` 提供两套实现并可配置；本次仅实测默认的 LivePreviewEngine（ExoPlayer）路径，mpv 路径未单独切换验证 |
| 13 | **TV 形态（真机遥控器）** | ❌ 未验证 | 本机 3 个 AVD（Small_Phone / Small_Phone_2 / hongguo_cap）均为手机镜像，无 `android.software.leanback` 特性。DPAD 按键在手机上走同一套 Compose for TV 焦点处理路径（第 9/10 项已验证），但真机 TV 形态的遥控器体验、10-foot UI 布局、方向键/长按/数字键组合未验证 |

## 环境限制说明

- **本机无 IPv6 出口**（`curl -6` 失败），fanmingming 等以 IPv6 地址发布的公开直播源在本机不可达。这不是应用缺陷：M3U 拉取、解析、入库、播放链路已用可达的 IPv4 源（mux.dev 测试流 + 宿主本地 M3U）完整验证。
- 模拟器内预装的「红果短剧」应用会自动抢占前台，干扰自动化操作，已用 `pm disable-user` 临时禁用（测试环境，可 `pm enable` 恢复）。
- Companion 辅助服务（端口 8089）仅监听 IPv6，宿主机 `adb reverse`（IPv4）无法连通，验证改用模拟器内 `nc ::1 8089` 直连——这正是「手机浏览器填表 → 发送到电视」的同一协议路径。
- `adb shell input text` / MCP `type_text` 均无法向 Compose for TV 的 TextField 注入文本（Task 11 已记录该限制），故 URL 输入通过 Companion 服务完成，未走「Type it here」键盘路径。

## 结论

原生版在手机形态下**核心链路全部通过**：构建 → 启动 → 导航 → 添加 M3U 源（远程提交）→ 解析出频道 → 播放出图 → 遥控器换台。

未覆盖：TV 真机形态（第 13 项）、mpv 引擎路径（第 12 项）、Compose TextField 键盘输入路径。

## 后续建议

1. 装一个 TV 镜像 AVD（如 `tv_1080p` / Android TV）复验第 13 项与 10-foot 布局。
2. 二期把 core 内的 OwnTV 品牌素材（冷启动闪屏、字标、横幅、向导标题）替换为本项目品牌——这些资源在 core AAR 内，需一并维护 OwnTV_Core 仓库。
3. 明确 `namespace` 最终命名（当前 `com.iptv.tv` 为临时值，因 `native` 是 Java 关键字）。
