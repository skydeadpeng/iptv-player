# IPTV 直播

自用 IPTV 播放器，两个功能一致的独立实现：

| 版本 | 路径 | 技术 | 说明 |
|---|---|---|---|
| **WebView 版** | `webview/` | Vite + TypeScript + hls.js/mpegts.js + Kotlin WebView 薄壳 | H5 全部 UI 与播放逻辑；壳只负责加载页面、本地文件导入 Bridge、屏幕常亮 |
| **原生版** | `native/` | Kotlin + Jetpack Compose for TV + ExoPlayer/mpv（基于 [OwnTV](https://github.com/ahXN00/OwnTV) 定制） | M3U/Xtream/Stalker + EPG + 时移 |

两版均支持：

- M3U 订阅源导入（URL / 本地文件）
- **自动 IPTV 源**：内置公开源清单，一键拉取 → 客户端测速筛选 → 剔除死频道入库（详见 `docs/superpowers/specs/2026-11-07-auto-source-design.md`）
- 频道分类 / 搜索 / 收藏 / 换台 / 画面比例
- **自动更新**：启动时检查 GitHub Releases 上的新版本，下载 APK 并提示安装

## 构建

```bash
# WebView 版（需要 Node 22 构建 H5）
cd webview/web && npm install && npm run build
rsync -a --delete dist/ "$HOME/.cache/iptv-web-assets/web/"
cd ../android && ./gradlew assembleDebug

# 原生版（需 JDK 17+，首次构建走 composite build 拉 OwnTV_Core）
cd native && ./gradlew assembleDebug
```

## 自动更新

两个 App 启动时都会检查 `updates/<app>/version.json`（本仓库内），发现更高 `versionCode` 时提示下载 GitHub Releases 上的新 APK。发布新版本：

1. 改 `versionCode` / `versionName` 构建 APK
2. `gh release create vX.Y.Z <apk>` 上传
3. 更新对应 `updates/*/version.json`

## 许可证

- `webview/`：自研代码，MIT
- `native/`：基于 OwnTV（GPL-3.0）二次开发，遵循 **GPL-3.0** 分发；上游版权归 [ahXN00/OwnTV](https://github.com/ahXN00/OwnTV) 所有

> 本项目为通用播放器，不含任何频道内容；使用者自行添加合法可访问的订阅源。
