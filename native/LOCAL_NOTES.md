# OwnTV 基座本地记录（LOCAL_NOTES）

> 本文件记录 **基座的实际结构**，供 Task 11（品牌/包名定制）与后续任务照着改。
> 基座来源：<https://github.com/ahXN00/OwnTV>（GPL-3.0），clone 深度 1，基线提交见 `git log`。
> **许可证警告**：OwnTV 是 GPL-3.0。分发修改版必须保持 GPL 开源，不得闭源商用。

---

## 1. 包名 / applicationId（Task 11 必改）

| 项 | 值 | 位置 |
|---|---|---|
| `applicationId` | `tv.own.owntv` | `native/app/build.gradle.kts` → `defaultConfig { applicationId = "tv.own.owntv" }` |
| `namespace` | `tv.own.owntv` | 同上，`android { namespace = "tv.own.owntv" }` |
| Kotlin 根包 | `tv.own.owntv` | `native/app/src/main/java/tv/own/owntv/`（290 个 .kt） |
| minSdk / targetSdk / compileSdk | 26 / 36 / `release(37)` | `app/build.gradle.kts` |
| versionCode / versionName | 本地构建固定 `99999` / `99.99.99`（CI 用 `VERSION_CODE`/`VERSION_NAME` 环境变量注入） | `app/build.gradle.kts` |
| 启动 Activity | `tv.own.owntv.MainActivity`（`app/src/main/java/tv/own/owntv/MainActivity.kt`） | Manifest 里有 9 个 launcher activity（每个图标一个），`AppIconSwitcher` 保证只有一个 enabled |

> Task 11 要改成 `com.iptv.native`（计划文档 §第二部分 Task 11）。
> 改 `applicationId` 时**同时**要改 `namespace`，否则 Koin/Room 的生成包名与 Manifest 不一致。

---

## 2. 模块划分

`native/settings.gradle.kts` 只 include 两个模块：

| 模块 | 作用 | 备注 |
|---|---|---|
| `:app` | 唯一的应用模块，290 个 .kt，全部 UI 在这里 | `applicationId` 在此 |
| `:baselineprofile` | 测试模块（Macrobenchmark），录制冷启动 baseline profile | `minSdk 28`，`targetProjectPath = ":app"`，只跑 x86_64 flavor |

**关键：真正的"业务内核"不在本仓库，而在两个外部 Maven 产物里**（来自 <https://github.com/ahXN00/OwnTV_Core>）：

| 依赖 | 坐标（`gradle/libs.versions.toml`） | 提供什么 |
|---|---|---|
| `owntv.core` | `tv.own.owntv:core:1.0.69` | 数据层 + 解析器 + EPG + 时移 + 录制 + Room 数据库 + 全部文案资源 |
| `owntv.player.core` | `tv.own.owntv:player-core:1.0.69` | 播放引擎实现（libmpv / ExoPlayer） |
| `libmpv` | `tv.own.owntv:libmpv:2026.10.4`（由 `player-core` 以 `api` 传递） | FFmpeg/libmpv 原生 .so（32 MB AAR） |

仓库源：`https://ahxn00.github.io/OwnTV_Core/maven`（`settings.gradle.kts` 里 `includeGroup("tv.own.owntv")` 限定）。
需要改 core 内部逻辑时：设 `owntv.corePath=<本地 OwnTV_Core 路径>`（写 `~/.gradle/gradle.properties`）走 composite build，否则只能改本仓库的 app 层。

> ### ⚠️ 必读：HEAD 提交**无法**用已发布的 core 产物构建（Task 10 实测）
>
> 本仓库 clone 到的 HEAD（`d695170909`，2026-11-06）引用了一批**已发布的 `tv.own.owntv:core:1.0.69`
> 里还没有**的 core API 与字符串：
> `tv.own.owntv.core.categorylock.*`（`SealedCategoryAction` / `CategoryLockClosed` …）、
> `R.string.categorylock`、`R.string.auto_start_notification_channel` …
>
> - `core-1.0.69` 发布于 **2026-10-21**；这些 API 是 2026-11-05/06 的 phase-1/phase-2 特性加的，
>   只存在于 OwnTV_Core 的 `main`（HEAD `a12d96b229`）。
> - 上游 CI 在这个 commit 上就是**红的**（`baseline` / `check` / `validate` 三个 job failure，
>   `build` skipped），所以不是我们引入的问题。
> - `gradle/libs.versions.toml` 里 `owntvCore = "1.0.69"` 是**当前最新发布版**，
>   maven 上没有 1.0.70 —— 上游还没发新版 core。
>
> **结论：本地必须走 composite build**，这正是上游 `android.yml` 注释写的做法：
> > "There is no owntv.corePath here: CI deliberately builds against the PINNED artifact, which is
> > what a release actually ships. **Local builds use the composite.**"
>
> 做法：
> ```bash
> git clone --depth 1 https://github.com/ahXN00/OwnTV_Core.git /path/to/OwnTV_Core
> printf 'sdk.dir=%s\n' "$HOME/Library/Android/sdk" > /path/to/OwnTV_Core/local.properties
> # 在 ~/.gradle/gradle.properties 里加（不要写进仓库）：
> #   owntv.corePath=/path/to/OwnTV_Core
> ```
> `native/settings.gradle.kts` 会 `includeBuild(owntv.corePath)`，按 group:name 把
> `tv.own.owntv:core` 与 `tv.own.owntv:player-core` 替换成本地工程（版本号自动忽略）。
> 注意 core 的 `player-core` 依赖 `tv.own.owntv:libmpv:2026.11.0`（比 app 侧 pin 的 2026.10.4 新）。
>
> **Task 11 的影响**：要改 core 层的东西（解析器、EPG、文案资源），必须把 OwnTV_Core 也 clone 下来
> 一起改；只改本仓库的 app 层是改不到的。

> ⚠️ **Task 11 影响**：`app_name` 字符串和所有启动图标 **都在 core AAR 的资源里**，
> 不在 `app/src/main/res/values/strings.xml`（该文件只有 3 条 search 相关字符串）。
> 要改应用名，必须在 **app 模块**新增/覆盖同名 `app_name`（app 模块资源优先级高于 library 资源）。
> 启动图标同理：`@mipmap/owntv_icon_eggshell` 等 9 个图标在 core AAR 的 `mipmap-anydpi-v26` 里，
> Manifest 给 9 个 launcher activity 各配一个图标（`app/src/main/AndroidManifest.xml`），
> 由 `AppIconSwitcher` 保证同时只有一个是 enabled。

---

## 3. 播放引擎实现位置

引擎实现在 **外部 `player-core` AAR**，不在本仓库源码里。app 侧只保留 HUD 与包装层。

### 3.1 app 模块内的相关文件（`native/app/src/main/java/tv/own/owntv/player/`）

| 文件 | 作用 |
|---|---|
| `MpvVideoSurface.kt` | libmpv 视频画面挂载到 Compose 的 Surface |
| `PlayerHud.kt` | 播放页 HUD（进度、轨道、音轨、字幕、录制、直播回看…） |
| `PlayerHudChrome.kt` / `PlayerHudControls.kt` / `PlayerHudDialogs.kt` | HUD 的外壳 / 控件 / 对话框 |
| `DirectTune.kt` | 频道直接调频（输入频道号跳台） |
| `PlayerChannelKeys.kt` | 播放页的遥控器按键映射（换台/音量/节目单…） |
| `FrameRateController.kt` / `AutoFrameRatePrompt.kt` | 帧率匹配（4K/HDR TV） |
| `SubtitleOverlay.kt` | 字幕叠加层 |
| `RecordingBadge.kt` / `RecordingConflict.kt` | 录制状态与冲突提示 |
| `StreamInfoOverlay.kt` | 码率/分辨率等信息浮层 |
| `MiniPlayer.kt` / `MiniPlayerLayout.kt` / `AudioNowPlayingBar.kt` | 迷你播放器 / 纯音频条 |
| `VideoZoom.kt` | 画面缩放（Aspect/Zoom） |

### 3.2 DI 装配（`native/app/src/main/java/tv/own/owntv/di/PlayerModule.kt`）

```
ownTVPlayer()          → mpv 引擎（长生命周期，全屏播放）
livePreviewEngine()    → ExoPlayer 引擎（Live 预览窗 / 多画面池 / 首页 Hero 预览）
LiveEnginePool { livePreviewEngine() }   → 多画面（Multiview）每格一个 ExoPlayer
HeroPreviewEngine(...) → 首页静音预览
PlaybackEngines(player, livePreview, pool, heroPreview)  → 统一收口，Home/屏保/内存压力都调它
```

### 3.3 引擎实现（在 `player-core` AAR 内，包名同为 `tv.own.owntv.player`）

- `tv.own.owntv.player.*` —— 引擎基类与实现（`ExoSubtitleEngine`、`LiveEngines`、`LiveEnginePool`、
  `FfmpegAudio`、`AudioDynamics`、各种 watchdog、`ErrorInfo`…）
- `tv.own.owntv.player.ffmpeg.*` —— **libmpv / FFmpeg 的 JNI 绑定**
- `tv.own.owntv.core.drm.*`、`tv.own.owntv.core.subtitles.*` —— DRM 与字幕控制器

> **双引擎分工**（来自 `app/build.gradle.kts` 注释）：
> libmpv(FFmpeg) 兼容性最广，是主力；ExoPlayer(Media3) 负责 VOD 与图形字幕(PGS/VOBSUB/DVB) 接力
> （mpv 直出做不了位图字幕）。播放前先停 mpv，任一时刻只存在一条连接。
> 切换引擎的入口在 **设置界面**（Task 12 验收要确认 ExoPlayer/mpv 两引擎都能播同源）。
> Media3 版本：`media3 = "1.11.1"`（exoplayer / hls / dash / ui / datasource-okhttp）。

---

## 4. 订阅源管理模块位置

支持三种源：**M3U**（URL 或本地文件）、**Xtream**（账号密码）、**Stalker/Ministra**（portal + MAC）。

### 4.1 app 模块内（UI + ViewModel 层，Task 11 品牌定制主要动这里）

| 文件 | 作用 |
|---|---|
| `features/setup/SetupWizard.kt` | 首次启动向导 |
| `features/setup/AddSourceChooserScreen.kt` | 添加源的四选一入口：**Remote / Type it here / Import a backup / Existing** |
| `features/setup/AddSourceScreen.kt` | 添加/编辑源表单，三种源类型分支（`SourceType.XTREAM` / `M3U` / `STALKER`），约 800 行 |
| `features/setup/SetupViewModel.kt` | 导入逻辑入口：`startXtream()` / `startStalker()` / `startM3u()`、`runImport()`、`linkExisting()` |
| `features/setup/RemoteSetupScreen.kt` | "用手机填表"（局域网 Web + 二维码 + 6 位 PIN） |
| `features/setup/SetupFailureText.kt` | 导入失败文案 |
| `features/settings/ManageSourcesScreen.kt` | **管理已有源**：列表 / 新增 / 重同步 / 删除 / 设默认 / 测速（`SourceTestResult`） |
| `features/settings/SettingsViewModel.kt` | 源列表、导入状态、进度、默认源、删除等状态 |
| `features/settings/EpgSourcesScreen.kt` / `EpgSourceForm.kt` / `EpgSourceRow.kt` | EPG 源（XMLTV）单独一套，与播放源分开 |

### 4.2 core AAR 内（真正的解析 / 抓取 / 存储，**不在本仓库，改不了除非拉 OwnTV_Core 源码**）

| 包 | 关键类 |
|---|---|
| `tv.own.owntv.core.parser` | `M3uParser` / `M3uEntry` / `M3uHeader`、`XtreamClient` / `XtLiveStream` / `XtVod` / `XtSeries`、`XmltvParser` / `XmltvDetailRules` |
| `tv.own.owntv.core.stalker` | `StalkerClient` / `StalkerAuthManager` / `StalkerSession` / `StalkerEpgLoader` / `StreamUrlResolver` |
| `tv.own.owntv.core.repository` | `SourceRepository` / `SourceTester` / `ActiveProfileSources` / `EpgRepository` / `SeriesRepository` |
| `tv.own.owntv.core.sync` | 后台同步 Worker（WorkManager）、`CatalogSyncState`、导入进度 |
| `tv.own.owntv.core.epg` | EPG 读取与频道名合并 |
| `tv.own.owntv.core.timeshift` | **时移 / 回看**（Live 页 `CatchupJumpDialog` / `CatchupManualTimeDialog` 的后端） |
| `tv.own.owntv.core.recording` | 录制（`togglePlayerRecording` / `scheduleRecording` / 冲突检测） |
| `tv.own.owntv.core.database` | Room 实体 + DAO（`SourceEntity`、`ChannelEntity`、`RecordingEntity`…） |
| `tv.own.owntv.core.model` | `SourceType`（`M3U` / `XTREAM` / `STALKER`） |

> **Task 11 Step 3 的风险点**：MVP 要求"URL 订阅 + 文件导入"。
> URL 订阅 —— `SetupViewModel.startM3u(name, url, userAgent, epgUrl, autoRefresh, httpReferer)` 已具备。
> 文件导入 —— core 侧只暴露了 `Import a backup`（备份包，不是 M3U 文件）。
> **若确认本地 M3U 文件导入缺失，实现位置应在 `features/setup/AddSourceScreen.kt` 的文件选择入口
> + `SetupViewModel` 里新增一条导入路径**，而不是改 core。
> 动手前先用 `adb` 实测：Settings → 源管理 → Add Source → Import，看它能接受什么格式。

---

## 5. 遥控器适配位置

遥控器是 Android TV 的第一输入，OwnTV 是 "D-pad first"。

### 5.1 按键事件总入口

| 位置 | 作用 |
|---|---|
| `features/shell/OwnTVShell.kt` | **应用级遥控器中枢**。`onPreviewKeyEvent` 处理 Back、`Key.MediaPlayPause` / `Key.MediaPlay` / `Key.MediaPause`（媒体键）；分发 `RemoteShortcutAction` |
| `player/PlayerHud.kt` | 播放页按键处理 + 遥控器快捷键派发 |
| `player/PlayerChannelKeys.kt` | 播放页频道键（上下换台、音量、节目单…） |
| `ui/components/ChNavPaging.kt` | 列表翻页（遥控器长按/连续按），并消费 `RemoteShortcut` |
| `ui/components/DpadLeftPress.kt` | `Modifier.onDpadLeft(enabled, action)` —— 在焦点搜索之前抢 ◀ 的通用修饰符 |
| `ui/components/LongPressMenuGuard.kt` | 长按 OK 的菜单守卫（`Key.DirectionCenter` / `Key.Enter` / `Key.NumPadEnter`） |
| `ui/components/RemoteShortcutInput.kt` | `LocalRemoteShortcuts` CompositionLocal：`RemoteShortcutEnvironment(enabled, bindings, dispatch)` |

### 5.2 遥控器快捷键（自定义按键）设置

| 位置 | 作用 |
|---|---|
| `features/settings/ChNavSettingsScreen.kt` | **快捷键捕获/绑定界面**（`RemoteShortcutBindings` / `RemoteShortcutPress` / `RemoteShortcutAction`，支持"捕获按键"对话框） |
| `features/settings/RemoteShortcutLabels.kt` | 按键 → 显示名的映射（`KEYCODE_CHANNEL_UP/DOWN`、`KEYCODE_MEDIA_*`、`KEYCODE_GUIDE`、`KEYCODE_INFO`、数字键…） |
| `features/settings/PlayerButtonsSettingsScreen.kt` / `PlayerButtonsSettingsViewModel.kt` | 播放页**屏幕按钮**（不是遥控器）自定义 |
| `core` 侧 | `tv.own.owntv.core.settings.RemoteShortcutAction` / `RemoteShortcutBinding` / `RemoteShortcutBindings` —— **绑定模型与持久化在 core AAR** |
| 文案 | `settings_line_remote_shortcuts` = "Assign spare remote buttons"（core AAR 文案） |

### 5.3 遥控器适配的注意点

- **导航模型是 Compose for TV 的焦点系统**（`androidx.tv.material3`），不是 `onKeyDown` 传统事件。
  改按键行为优先找 `onPreviewKeyEvent` / `Modifier.onKeyEvent` / `focusRequester`。
- 遥控器"Menu"键与"长按 OK"是同一入口（`LongPressMenuGuard`）。
- 需要**新增**遥控器功能时：动作模型在 core（改不了）→ 只能在 app 层新增 `Modifier.onDpadXxx`
  或在 `OwnTVShell` / `PlayerHud` 的 `onPreviewKeyEvent` 里拦截。

---

## 6. 构建与本机环境（Task 10 实测结论）

### 6.1 基座要求的工具链

| 项 | 版本 | 来源 |
|---|---|---|
| Gradle | **9.8.2** | `gradle/wrapper/gradle-wrapper.properties` |
| AGP | **9.4.0** | `gradle/libs.versions.toml` |
| Kotlin | **2.4.20**（AGP 9 内置 Kotlin + compose compiler 插件） | 同上 |
| KSP | 2.3.11（Room 代码生成） | 同上 |
| compileSdk | **37（release）**，本机需 `android-37.0` | `app/build.gradle.kts` |
| Java 字节码 | 17（`sourceCompatibility`/`targetCompatibility`） | `app/build.gradle.kts` |
| **JDK 工具链** | **必须能提供 JDK 25** | `settings.gradle.kts` 用了 `foojay-resolver-convention`，构建期请求 `languageVersion=25` 工具链；**本机只有 JDK 22 时会直接失败** |

### 6.2 本机适配（**全部在本机，不入库**）

| 项 | 做法 |
|---|---|
| JDK 25 | 装 Temurin 25.0.5+8 到 `~/Library/Java/JavaVirtualMachines/temurin-25.jdk`（Gradle 自动发现，macOS 标准位置）。校验 sha256 `36dc14d7…0b0e857` 与 Adoptium 官方一致 |
| Gradle 发行包 | `gradle-wrapper.properties` 的 `networkTimeout=10000` 太小，本机下载必超时。手动 `curl` 到 `~/.gradle/wrapper/dists/gradle-9.8.2-bin/<hash>/gradle-9.8.2-bin.zip` 后 wrapper 会直接解压 |
| HTTP 超时 | `~/.gradle/gradle.properties`：`systemProp.org.gradle.internal.http.socketTimeout=180000` + `connectionTimeout=180000`；并 `org.gradle.java.installations.auto-download=false`（避免 foojay 卡死） |
| Maven 镜像 | `~/.gradle/init.d/owntv-mirrors.gradle`：只**改写** google()/mavenCentral()/gradlePluginPortal() 的 URL 为阿里云镜像（google→`maven.aliyun.com/repository/google`，central→`.../central`）。**仓库内的 `settings.gradle.kts` 保持标准 `google()`/`mavenCentral()` 不动**；OwnTV 自己的 maven 仓库（`ahxn00.github.io`）未镜像，需单独处理 |
| libmpv AAR | `ahxn00.github.io`（GitHub Pages）在本机被限速到约 100 KB/s，32 MB 要 5+ 分钟。用 `curl -C -` 断点续传下载后，按 sha1 目录名放进 `~/.gradle/caches/modules-2/files-2.1/tv.own.owntv/libmpv/<version>/<sha1>/` 可绕过 Gradle 直连（Gradle 的缓存目录名就是文件内容的 sha1） |
| **composite core** | `owntv.corePath=/Users/xiaomingpeng/Desktop/owntv-core`（见 §2 的必读框）。必须，否则编译不过 |
| `local.properties` | 必须有 `sdk.dir=/Users/xiaomingpeng/Library/Android/sdk`（已在 `native/.gitignore` 内，不入库）。composite 的 core 目录也要一份 |

### 6.3 本次构建的实际耗时

- 首次（冷缓存 + composite）：`BUILD SUCCESSFUL in 2m 47s`（120 tasks，含从源码编译 core + player-core）
- 依赖全部命中缓存后：任务图计算阶段从「20+ 分钟」降到 **44 秒**

### 6.4 构建命令与产物

```bash
cd native
./gradlew assembleDebug
```

**注意 flavor**：`app/build.gradle.kts` 有 `flavorDimensions += "abi"`，两个 flavor：

- `standard` → `arm64-v8a` + `armeabi-v7a`（真机 Android TV / Fire TV）
- `x86_64` → x86_64 模拟器专用

`assembleDebug` 会同时构建两个 flavor 的 debug。**产物路径带 flavor 子目录**（AGP 9 的布局）：

```
native/app/build/outputs/apk/standard/debug/app-standard-debug.apk   ← 真机 / arm64 模拟器（85 MB）
native/app/build/outputs/apk/x86_64/debug/app-x86_64-debug.apk       ← x86_64 模拟器（68 MB）
```

> Task 10 实测：本机 emulator-5554 是 **arm64** 镜像（`sdk_gphone64_arm64`），
> 装 `x86_64` 版会报 `INSTALL_FAILED_NO_MATCHING_ABIS`，**要装 `standard` 那个**。

两个 APK 都含 `libmpv.so` + `libavcodec.so`（FFmpeg）等原生库，见 `unzip -l` 的 `lib/<abi>/` 目录。

### 6.5 构建期强制检查（改代码时会被卡）

- `verifyI18nLiterals` 任务挂在 `preBuild` 上：**Kotlin 源码里出现面向用户的硬编码字符串就直接 build 失败**
  （脚本 `native/tools/i18n/check_hardcoded_strings.py`，白名单 `hardcoded_baseline.txt` / `safe_literals.txt`）。
  没有 Python 时只警告不失败，但 CI 会卡。**Task 11 改品牌文案必须加进 `strings.xml`，不能写死在 Kotlin 里。**
- `lint { abortOnError = true; fatal += "PluralsCandidate" }`：数量文案必须用 plurals 资源。

> ### ⚠️ 基线自带的问题：i18n 清单与源码不同步（Task 10 已修）
>
> clone 下来的 HEAD 里，`tools/i18n/hardcoded_baseline.txt` / `safe_literals.txt` **和源码对不上**：
> 新加的 `features/epg/ProgrammeDayPage.kt`、`features/settings/VideoPlayerSettingsScreen.kt`、
> `features/shell/components/ChannelBrowserOverlay.kt` 里的字面量没进清单，
> 同时 `SearchScreen.kt ▶` 等已删除的字面量还在清单里（stale）。
> `:app:verifyI18nLiterals` 因此 FAILED —— 这是上游 CI 在这个 commit 上红的原因之一。
>
> 修法用工具自己的文档流程（`native/tools/i18n/README.md`），不是手改清单：
> ```bash
> cd native
> python3 tools/i18n/check_hardcoded_strings.py prune-safe          # 清掉 stale，重生成 baseline
> python3 tools/i18n/check_hardcoded_strings.py classify-safe \
>     --path <file> --text '<exact text>' --category <category>       # 把技术字面量登记进去
> python3 tools/i18n/check_hardcoded_strings.py verify --bootstrap     # 必须 OK
> ```
> 分类**完全照抄上游已有的同类条目**：`·` `▶` `◀` `▼` `▲ ▼` `◀ ▶` 这些按键提示字形在
> EpgScreen/GuideStage/HomeScreen/LiveScreen/SettingsStage 里都已经是 `technical`；
> `vp_*` 快捷键索引是 `technical`；`MenuActionRef` 的 id 在 core 里是 `preference-key`。
> **不要**把真正给用户看的文案登记成 technical —— 那样是"为了 CI 变绿而作弊"。
>
> **Task 10 在本仓库里做的改动**（已随基线提交）：
> - `tools/i18n/safe_literals.txt`：删掉 stale 的 `SearchScreen.kt ▶`，修正 `LiveScreen.kt` 的
>   `\0` 与 `·` 计数（3→2）。
> - `tools/i18n/hardcoded_baseline.txt`：重新生成，新增 13 条新字面量（作为"已登记的技术债"）。
> - **没有**新增 `classify-safe` 条目 —— 所有新字面量都进了 baseline，符合 README 的
>   "Text a user can read stays unclassified so it lands in hardcoded_baseline.txt as declared debt"。
>
> 另外 **OwnTV_Core 仓库**有同样的漂移（`ContentMenus.kt` 的 `programme_details` 没登记），
> 在本地那份 clone 里用 `classify-safe --category preference-key` 修掉了（那个仓库不在本项目里，不入库）。

---

## 7. Task 11 定制清单（照着改的位置）

| 要改的 | 改哪里 |
|---|---|
| applicationId / namespace | `app/build.gradle.kts`（`defaultConfig.applicationId` + `android.namespace`） |
| 应用名 | 在 `app/src/main/res/values/strings.xml` 新增 `<string name="app_name">IPTV 直播</string>` 覆盖 core AAR 的同名资源 |
| 启动图标 | 在 `app/src/main/res/` 新增 mipmap 资源，覆盖 `owntv_icon_*`；或改 `AndroidManifest.xml` 里 9 个 launcher activity 的 `android:icon` |
| 源管理 UI 文案/布局 | `features/setup/AddSourceScreen.kt`、`features/setup/AddSourceChooserScreen.kt`、`features/settings/ManageSourcesScreen.kt` |
| 本地 M3U 文件导入（若缺） | `features/setup/AddSourceScreen.kt` + `features/setup/SetupViewModel.kt`（core 侧不可改） |
| 遥控器行为 | `features/shell/OwnTVShell.kt`、`player/PlayerHud.kt`、`player/PlayerChannelKeys.kt`、`ui/components/DpadLeftPress.kt` |
| 硬编码文案 | 一律写进 `app/src/main/res/values/strings.xml`，否则 `verifyI18nLiterals` 会让构建失败 |

---

## 8. 基线信息

- 基座：<https://github.com/ahXN00/OwnTV>，GPL-3.0，clone `--depth 1`
- 基座内核仓库（两个 AAR 的来源）：<https://github.com/ahXN00/OwnTV_Core>
- libmpv 构建仓库：<https://github.com/ahXN00/OwnTV_libmpv>
- 许可证：`native/LICENSE`（GPL-3.0 全文，35 KB）
- 任务报告：`.superpowers/sdd/task-10-report.md`
