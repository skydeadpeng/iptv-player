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

## 三、运营商专属源（按省份/运营商，http 单播；组播 rtp:// 不收录）

**IP 归属自动选源（两版已实现）**：App 自动获取频道时先调 `ip-api.com` 检测归属（省份+ISP 归一化 Chinanet→telecom 等），命中 `PROVINCE_SOURCES` 注册表（目前收录**江苏**：移动 3 源 210/106/52 频道、联通 1 源 127 频道、电信 ott 1 源 286 频道，均为 http 单播）则把省源**与公共源一起**交给测速筛选——地域/运营商不适用的被自然淘汰；未收录省份或检测失败退回纯公共源。

**实测数据（本机 = 江苏电信宽带）**：

| 源 | 频道数 | 本机实测 | 结论 |
|---|---|---|---|
| 江苏移动 OTT（cicivi/molu/0x13，ott.mobaibox.com） | 210/106/52 | 1/6、0/6、0/6 | 移动网络内才可用；电信宽带下基本拉黑 |
| 江苏联通（lesca，122.96.52.98 带签名参数） | 127 | 0/6 | 联通内网单播 |
| 江苏电信 OTT（beckjimmy1005-beep，ott.mobaibox.com） | 286 | 0/6 | 同域名的频道级差异，电信宽带下这批也不通 |

> **重要局限**：挂代理/VPN 时，任何 IP 归属服务返回的都是**代理出口**的归属（实测 ipwho.is 走 Clash 出口显示 Nevada）。真实使用环境（无代理的宽带/Wi-Fi）下返回准确。

**组播源说明**（rtp://udp://，App 本期不支持）：

**使用前提（重要）**：组播地址（`rtp://239.x.x.x` / `udp://@`）只在**对应运营商的宽带内网**有效，且需要网络侧支持之一：
- 光猫/路由器开 IGMP Proxy/Snooping（软路由常见做法）
- **udpxy** / [rtp2httpd](https://github.com/stackia/rtp2httpd) 把组播转成单播 `http://` 给 App 播（App 二期计划支持）
- 部分地区运营商同时提供**内网单播**地址（http://），内网直连即可，无需组播

公网环境**无法验证**这类源（我们的频道测速也不适用），换网络/换运营商即失效。

### 全国性仓库

| 仓库 | 覆盖 | 格式 | 状态 |
|---|---|---|---|
| **[zqs1qiwan/laobaitv](https://github.com/zqs1qiwan/laobaitv)**（16⭐） | 电信/联通/移动 × 北京/贵州/四川/新疆/山东 | **udpxy 转换后的 http M3U**（`http://192.168.2.1:4022/udp/239.x.x.x`），带 EPG（epg.laobaitv.net）+ 台标 + 频道分组；配套教程站 [iptv.laobaitv.net](https://iptv.laobaitv.net/) 含 udpxy 部署命令 | 🟢 **活跃（2026-11 仍在更新）**，CI 自动维护 |
| [Phineario/China-IPTV-Multicast](https://github.com/Phineario/China-IPTV-Multicast)（37⭐） | 14 省市电信/联通/移动组播（上海/浙江/广东/四川/河南…） | 裸组播 `rtp://239.x.x.x:port`（m3u + txt 双格式） | 🔴 **2023-09 停更**——组播网段相对稳定但可信度打折，用作对照参考 |

> **laobaitv 的 M3U 可以直接被本 App 播放**（URL 是 http 单播）：前提是你路由器上跑着 udpxy（仓库 README 给了 OpenWrt 部署命令，默认 `192.168.2.1:4022`）。若你的 udpxy 地址不同，导入前把 M3U 里的 `192.168.2.1:4022` 文本替换成你的 udpxy 地址即可。raw 订阅地址形如
> `https://raw.githubusercontent.com/zqs1qiwan/laobaitv/main/chinatelecom/sichuan/chengdu/main.m3u`

### 省级精品仓库（带自动验证/更新）

| 仓库 | 星数 | 覆盖 | 特点 |
|---|---|---|---|
| [wuwentao/bj-unicom-iptv](https://github.com/wuwentao/bj-unicom-iptv) | 721 | 北京联通 | 完整 M3U（EPG+台标），**每小时 CI 更新 + 自带连通性检查脚本** |
| [shawze/IPTV](https://github.com/shawze/IPTV) | 156 | 江苏电信 | 组播地址共享 |
| [nczyw/iptv](https://github.com/nczyw/iptv) | 130 | 江苏电信 | 最新组播地址 |
| [babylife/China-ShangHai-IPTV-list](https://github.com/babylife/China-ShangHai-IPTV-list) | 125 | 上海联通 | 组播 + **时移回看**地址 |
| [islercn/BeiJing-Unicom-IPTV-List](https://github.com/islercn/BeiJing-Unicom-IPTV-List) | 333 | 北京联通 | 每小时更新，不含非官方频道 |
| [plsy1/iptv](https://github.com/plsy1/iptv) | 231 | 山东联通 | 播放列表 |
| [lesca/jiangsu-iptv](https://github.com/lesca/jiangsu-iptv) | 125 | 江苏联通 | 组播 |
| [supzhang/get_iptv_channels](https://github.com/supzhang/get_iptv_channels) | 72 | 电信（通用） | **抓取脚本**：自动获取本机所在网络的组播+回放地址 |
| [VergilGao/Telecom-IPTV-Mock](https://github.com/VergilGao/Telecom-IPTV-Mock) | 63 | 长春电信 | 自动获取**组播+单播+节目单** |
| [FishBossTca/CMCC-IPTV](https://github.com/FishBossTca/CMCC-IPTV) | 58 | 广东移动 | 抓取组播源+台标导出 m3u |
| [wangkezun/bj-unicom-iptv](https://github.com/wangkezun/bj-unicom-iptv) | 14 | 北京联通 | 组播**改单播**方案 |
| [chilinha/tv](https://github.com/chilinha/tv) | 133 | 天津联通/移动 | 组播源 |
| [jllioo0/hbiptv](https://github.com/jllioo0/hbiptv) | 18 | 湖北电信 | 组播源 |
| [weezheng/IPTV](https://github.com/weezheng/IPTV) | 8 | 成都电信 | 组播源 |

### 找你自己所在运营商源的方法

1. 先查上面的全国汇总库（Phineario）有没有你省市
2. GitHub 搜索 `<省份> <运营商> IPTV`（如「河南移动 IPTV」——实测就有 CF012026/henan-mobile-iptv）
3. **自抓最可靠**：参考 supzhang/get_iptv_channels 的抓取脚本，在你自己的光猫网络里抓取（抓到的地址 100% 匹配你的线路）
4. 抓到后转成 M3U（组播地址写 `rtp://`）→ 若经 udpxy 转换，把 `rtp://239.x.x.x:port` 改写为 `http://<udpxy主机>:<端口>/rtp/239.x.x.x:port` 即可被 App 直接播放（二期原生支持）

## 五、使用建议

1. **公网源**：App 内置清单已按第一章推荐源配置（`webview/web/src/storage/autoStore.ts` 的 `BUILTIN_SOURCES` 与 `native/.../auto/AutoSourceManager.kt` 的 `BUILTIN_SOURCES`），启动自动获取后 App 会再做一轮频道级测速，死链自动剔除——**不必迷信源本身的"可用"宣称，以 App 内测速结果为准**。
2. **运营商组播源**（第三章）：需要对应运营商网络 + udpxy/IGMP 支持；App 本期只支持 `http(s)://` 直播流，`rtp://` 的 udpxy 转换在二期。udpxy 转换后的 `http://<host>:<port>/rtp/...` 地址现在就能用（手动导入 M3U）。
3. 源的可用性随时间大幅波动（如 YanG-1989 一周内从可用到全灭），建议保持多源 + 定期重测（App 内 24h 缓存自动过期）。
