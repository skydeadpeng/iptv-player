# IPTV 播放器双版本设计方案

日期：2026-11-06
状态：待用户审阅

## 目标

开发一个 IPTV 直播播放器，包含两个功能一致的独立 App：

1. **原生版**：Android 手机 + Android TV/盒子，Kotlin 原生实现
2. **WebView 版**：H5 播放器 + 原生薄壳（Android 优先）

iOS 原生版暂缓至二期。定位为**通用播放器**：用户自行导入 M3U 频道源（URL 订阅或本地文件），兼容运营商 IPTV 源与公开直播源。

## 调研结论（2026-11-06，GitHub）

| 项目 | 星数 | 协议 | 活跃度 | 结论 |
|---|---|---|---|---|
| mytv-android/mytv-android | 3.0k | MIT | 🟢 2026-11 仍在更新 | **原生版基座** |
| lizongying/my-tv-0 | 4.7k | MIT | 🟡 2025-05 停更 | 备选 |
| 4gray/iptvnator | 7.6k | — | 🟢 | 桌面端参考 |
| Guovin/iptv-api | 26k | — | 🟢 | 二期源管理参考 |
| fanmingming/live | 29k | — | 🟢 | 测试直播源 |
| iptv-org/iptv | 143k | — | 🟢 | 测试直播源 |

选 `mytv-android` 为基座的理由：MIT 协议；Media3 + IJKPlayer + VLC 三播放引擎（运营商源兼容性关键）；Jetpack Compose + Material 3；TV 遥控器适配已完成；社区活跃。

## 项目结构

```
iptv/
├── native/              # 原生版（fork mytv-android）
├── webview/
│   ├── web/             # H5 播放器（全部 UI 与播放逻辑）
│   └── android/         # Kotlin WebView 薄壳
├── docs/
└── (二期：webview/ios/、native 的 EPG/udpxy)
```

## 原生版设计

- **基座**：fork mytv-android，保留三播放引擎与遥控器交互
- **技术栈**：Kotlin + Jetpack Compose + Material 3 + Media3/IJKPlayer/VLC
- **定制点**：
  - 包名、应用名、图标、主题色
  - 频道源管理：M3U 订阅增删改、导入进度与失败提示
  - 频道界面：分类折叠、搜索、收藏排序
- **TV 适配**（沿用基座）：方向键换台、OK 呼出频道列表、数字键直达、菜单键设置

## WebView 版设计

- **web/**：H5 单页应用（Vite + TypeScript，不引入 UI 框架，频道列表用虚拟滚动手写实现）
  - 播放器：hls.js（HLS 流）为主，mpegts.js 兜底 FLV/TS 流；原生 `<video>` 全屏
  - M3U 解析：前端完成（m3u parser 自实现，无重依赖）
  - 存储：localStorage（频道列表、收藏、播放记录）
- **android/**：Kotlin 薄壳，仅三项职责：
  1. WebView 加载本地打包的 H5 资源
  2. JS Bridge：本地文件选择导入 M3U
  3. 屏幕常亮（TV 播放场景）
- 壳内不放业务逻辑，H5 可独立于壳在浏览器中调试

## 统一数据流

```
M3U 源(URL/文件) → 解析(分组/频道/台标) → 本地存储
    → 频道列表(分类/搜索/收藏) → 播放器 → 换台/比例/音量
```

M3U 解析规则：`#EXTINF` 的 `group-title` 为分组、`tvg-logo` 为台标；无分组的归入"未分组"。

## MVP 功能范围（两版本一致）

| 功能 | 说明 |
|---|---|
| M3U 导入 | URL 订阅 + 本地文件，多源管理 |
| 频道浏览 | 分类折叠、搜索、收藏 |
| 播放 | 换台、画面比例(16:9/4:3/填充)、音量 |
| TV 遥控 | 方向键换台、OK 呼出列表、返回退出确认 |

**二期（不在本期）**：EPG 节目单、udpxy 组播(udp://)支持、iOS 原生版、录制、追剧回看。

## 错误处理

- 源加载失败：解析失败提示格式错误；URL 订阅失败保留上次成功缓存
- 播放失败：原生版自动降级引擎（Media3 → IJK → VLC）；WebView 版 hls.js 失败后切 mpegts.js；均失败提示"频道不可用"并提供下一频道
- 网络超时：8 秒无数据判定失败

## 测试计划

- 测试源：fanmingming/live 与 iptv-org 公开 M3U（含正常/失效/非 HLS 混合源）
- 原生版：Android 模拟器分别跑手机形态与 TV 形态（遥控器按键注入）
- WebView 版：Chrome 桌面浏览器调试 H5；Android WebView 壳实测
- 验收标准：导入 1000+ 频道不卡顿；换台 ≤2s；连续播放 30min 无内存泄漏

## 风险与对策

| 风险 | 对策 |
|---|---|
| fork 代码理解成本 | 先跑通原版再改；改动集中在源管理层 |
| 部分源非标准 HLS | 三引擎兜底(原生) / mpegts.js 兜底(WebView) |
| WebView 版性能弱于原生 | 壳启用硬件加速；H5 频道列表虚拟滚动 |
| 运营商组播 udp:// 无法直接播 | MVP 不支持，文档标注；二期做 udpxy |
