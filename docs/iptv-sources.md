# GitHub IPTV 直播源收集与实测

日期：2026-11-07。所有源均为公开仓库自动维护的 M3U 列表；**频道级实测** = 等距抽样 IPv4 频道 URL 逐个 HTTP 探测（8s 超时），样本 6 个。

## 一、推荐源（实测可用，已内置进两个 App）

| 源 | URL | 频道数 | IPv4 | 频道级实测 | 说明 |
|---|---|---|---|---|---|
| **Guovin/iptv-api** ⭐26k | `https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/result.m3u` | 1619 | 1549 | 2/6 通（冷门台为主） | 每日自动采集+测速+生成；频道最多，死链比例靠 App 内测速再筛 |
| **vbskycn/iptv** ⭐10k | `https://raw.githubusercontent.com/vbskycn/iptv/master/tv/iptv4.m3u` | 230 | 230 | **6/6 全通，0.6s** | 双栈（另有 iptv6.m3u）；本身就是筛选后的高可用列表，**质量最佳** |
| **Meroser/IPTV** ⭐4.5k | `https://raw.githubusercontent.com/Meroser/IPTV/main/IPTV-demo.m3u` | 432 | 432 | 2/6 通（可用线延迟 7.6s） | 含 EPG/台标定制；demo 版免费 |
| **fanmingming/live** ⭐29k | `https://live.fanmingming.com/tv/m3u/ipv6.m3u` | 82 | 27 | 2/6 通（IPv4 部分 0.3s） | 附带 EPG+台标生态；主打 IPv6，IPv4 频道少 |

聚合内置（4 源合并去重 + App 内测速筛选）后实测：**~1554 条线路，测速筛选出可用频道 84~279 个**（因网络环境而异）。

## 二、实测不可用（记录避免再踩）

| 源 | 问题 |
|---|---|
| YanG-1989/m3u（123 频道） | 频道级实测 0/6，判死 |
| joevess/IPTV | `iptv.m3u8` 非标准 M3U（0 频道可解析） |
| jia070310/4K-IPTV-M3U | 只有组播 rtp 目录，无公网 M3U |
| dongyubin/IPTV ⭐4.6k | 纯文档索引仓库，无 m3u 文件（可当工具/教程索引） |
| EvilCult/iptv-m3u-maker ⭐2.9k | 404（已删源文件，停更） |
| `iptv.vbskycn.com` / `live.zbds.org` 等域名 | 本网络环境 DNS 解析不可达（raw.githubusercontent.com 直连可用） |

## 三、持续关注（未纳入）

- `kimwang1978/collect-tv-txt`（多文件合并，bbxx.m3u 仅 6 频道——单文件太少）
- `iptv-org/iptv` ⭐143k（全球频道，中文频道少且多为海外 CDN，境内播放质量差；后续做海外频道可加）
- 汇总索引：`imDazui/Tvlist-awesome-m3u-m3u8` ⭐30k、`laoma528/awesome-zhuiju-free`（找新源的入口）

## 四、使用建议

1. **App 内置清单已按上表推荐源配置**（`webview/web/src/storage/autoStore.ts` 的 `BUILTIN_SOURCES` 与 `native/.../auto/AutoSourceManager.kt` 的 `BUILTIN_SOURCES`），启动自动获取后 App 会再做一轮频道级测速，死链自动剔除——**不必迷信源本身的"可用"宣称，以 App 内测速结果为准**。
2. 运营商组播源（udp://、rtp://）需要 udpxy 转换，本期不支持（二期）。
3. 源的可用性随时间大幅波动（如 YanG-1989 一周内从可用到全灭），建议保持多源 + 定期重测（App 内 24h 缓存自动过期）。
