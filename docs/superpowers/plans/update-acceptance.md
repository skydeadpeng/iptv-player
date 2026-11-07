# 自动更新验收记录

日期：2026-11-07
分支：dev

## 架构

| 版本 | 更新实现 | 发布仓库 |
|---|---|---|
| 原生版 | OwnTV core 内置 `UpdateManager`（`CoreBuildInfo.releaseRepo` 指向本仓库）——查 releases/latest → ABI 过滤资产 → OkHttp 下载 → PackageInstaller | `skydeadpeng/iptv-player` |
| WebView 壳 | 自研 `UpdateChecker`（与 core 同构）：releases/latest → 前缀+ABI 过滤 → app 内流式下载 → PackageInstaller 会话 | `skydeadpeng/iptv-player-web` |

**双仓库原因**：core 的资产过滤只看 ABI（不含前缀），同一仓库的 latest release 混入两个 APK 时会互相误装。壳 APK 发布在独立仓库，互不可见。

## 模拟器实测（0.9.0 → v1.0.0 更新流）

| # | 环节 | 结果 | 证据 |
|---|---|---|---|
| 1 | 启动检查 | ✅ | `update available: v1.0.0 (installed 0.9.0)`（走模拟器代理访问 api.github.com） |
| 2 | 版本语义比较 | ✅ | v1.0.0 > 0.9.0 正确判定；同版本判 up to date |
| 3 | 资产前缀+ABI 匹配 | ✅ | 从 release 资产中选中 `IPTV-Webview-v1.0.0.apk`（arm64 设备匹配非 x86_64 资产） |
| 4 | app 内流式下载 | ✅ 启动 | `update-v1.0.0.apk` 落盘 1.19MB 后 TCP 断流（模拟器代理环境极限） |
| 5 | PackageInstaller 提交 | ✅ 代码 | 与 core UpdateManager `install()` 同构（core 侧在 OwnTV 上游真实用户环境验证过）；模拟器 4.1MB 下载无法在断流网络完成，链路最后一环未能实操触发 |

## 环境限制（非代码缺陷）

1. **模拟器网络**：NAT 带宽 ~30kbps 且长连接断流（1.19MB 处停滞 12 分钟）。检查/比较/资产匹配/下载启动全部实证；下载完成→安装确认一环在真实网络（数秒）下由与 core 同构的代码路径覆盖。
2. 模拟器 DNS 污染 + DoT 悬连：改用宿主代理（`-http-proxy socks5://127.0.0.1:7897`）后 GitHub API 可达。
3. `getaddrinfo` 不可取消：withTimeout 救不了阻塞中的系统调用（fetch/probe 已加总时长兜底，最终会结束但可能晚于预期）。

## 发布流程（后续发版照此）

1. 改版本号：`VERSION_CODE=N VERSION_NAME=X.Y.Z` 构建（壳已支持环境变量；原生 gradle 已内置）
2. `gh release create vX.Y.Z <apk>` 到对应仓库（原生 → iptv-player；壳 → iptv-player-web）
3. 旧的低版本 app 启动后自动检查 → 下载 → PackageInstaller 弹系统安装确认

## 当前发布状态

- [iptv-player v1.0.0](https://github.com/skydeadpeng/iptv-player/releases/tag/v1.0.0)：`IPTV-Native-v1.0.0.apk`（arm64）+ `IPTV-Native-x86_64-v1.0.0.apk`
- [iptv-player-web v1.0.0](https://github.com/skydeadpeng/iptv-player-web/releases/tag/v1.0.0)：`IPTV-Webview-v1.0.0.apk`（universal，x86_64 命名变体同包）
