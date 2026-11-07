package tv.own.owntv.auto

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import tv.own.owntv.core.setup.SourceImporter
import tv.own.owntv.core.repository.SourceRepository
import tv.own.owntv.core.database.entity.SourceEntity
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * 自动 IPTV 源：启动后台拉取内置公开源 → 客户端测速筛选 → 生成净化 M3U 交给 core 导入。
 *
 * 设计（docs/superpowers/specs/2026-11-07-auto-source-design.md）：
 * - 测速原生层无 CORS 概念，全部确定性判定（浏览器版的 unknown 语义在此不存在）
 * - 复用 core 导入链路（本地文件路径 → [SourceImporter.m3u]），零 UI/i18n 改动
 * - 24h 节流：SharedPreferences 记录上次成功时间
 */
class AutoSourceManager(
    private val context: Context,
    private val importer: SourceImporter,
    private val sourceRepository: SourceRepository,
    private val db: tv.own.owntv.core.database.OwnTVDatabase,
) {
    companion object {
        private const val TAG = "AutoSource"
        private const val PREFS = "auto_source"
        private const val KEY_LAST_SUCCESS = "last_success_at"
        private const val INTERVAL_MS = 24 * 60 * 60 * 1000L
        private const val CONCURRENCY = 16
        private const val TIMEOUT_MS = 5000
        private const val FETCH_TOTAL_TIMEOUT_MS = 20_000L
        private const val AUTO_SOURCE_NAME = "自动源"
        private const val KEY_CUSTOM_SOURCES = "custom_sources"
        private const val GEO_API = "http://ip-api.com/json/?lang=zh-CN&fields=status,regionName,isp"

        /**
         * 内置公共源清单（2026-11-07 收集实测，见 docs/iptv-sources.md）。
         * 可被 SharedPreferences 的 custom_sources 覆盖。
         */
        private val BUILTIN_SOURCES = listOf(
            "https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/result.m3u",
            "https://raw.githubusercontent.com/vbskycn/iptv/master/tv/iptv4.m3u",
            "https://raw.githubusercontent.com/Meroser/IPTV/main/IPTV-demo.m3u",
            "https://live.fanmingming.com/tv/m3u/ipv6.m3u",
        )

        /**
         * IP 归属省的运营商源注册表（全部 http 单播/OTT，组播 rtp:// 不收录）。
         * 运营商源有强地域+ISP 限制：与公共源一起交给测速，不适用者自然淘汰
         * （实测：江苏电信宽带下移动 OTT 1/6、联通内网 0/6——测速是唯一可靠裁决）。
         * key = ip-api regionName；ISP 归一化 Chinanet→telecom / China Unicom→unicom / CMCC→mobile。
         */
        private val PROVINCE_SOURCES: Map<String, Map<String, List<String>>> = mapOf(
            "江苏" to mapOf(
                "mobile" to listOf(
                    "https://raw.githubusercontent.com/cicivi/jsyd-iptv/main/m3u/iptv.m3u8",
                    "https://raw.githubusercontent.com/molu8072/IPTV/main/江苏移动.m3u",
                    "https://raw.githubusercontent.com/0x1301FDF/iptv/main/iptv.m3u8",
                ),
                "unicom" to listOf(
                    "https://raw.githubusercontent.com/lesca/jiangsu-iptv/main/iptv_js_full-latest.m3u",
                ),
                "telecom" to listOf(
                    "https://raw.githubusercontent.com/beckjimmy1005-beep/jsiptv/main/JSIPTV.m3u",
                ),
            ),
        )
    }

    private val running = AtomicBoolean(false)

    /**
     * 实际使用的源清单：SharedPreferences 的 custom_sources（换行分隔的 M3U URL）
     * 优先，为空则用内置清单。与 WebView 版的「自定义自动源」能力对等。
     */
    private fun activeSources(): List<String> {
        val custom = prefs().getString(KEY_CUSTOM_SOURCES, null)
            ?.lineSequence()
            ?.map { it.trim() }
            ?.filter { it.startsWith("http://") || it.startsWith("https://") }
            ?.toList()
            .orEmpty()
        return custom.ifEmpty { BUILTIN_SOURCES }
    }

    /** 24h 内成功过则跳过；返回是否实际执行 */
    suspend fun maybeRun(): Boolean {
        if (!running.compareAndSet(false, true)) return false
        try {
            // 首启向导未完成（无任何 profile）时不跑：core 会兜底建 fallback profile，
            // 源会挂到那里，与用户随后创建的真实 profile 脱节。跳过且不记节流，下次 onStart 重试。
            if (db.profileDao().getAllOnce().isEmpty()) {
                Log.i(TAG, "skip: onboarding not finished (no profile yet)")
                return false
            }
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val last = prefs.getLong(KEY_LAST_SUCCESS, 0L)
            if (System.currentTimeMillis() - last < INTERVAL_MS) {
                Log.i(TAG, "skip: last success %.1fh ago".format((System.currentTimeMillis() - last) / 3.6e6))
                return false
            }
            run()
            return true
        } finally {
            running.set(false)
        }
    }

    /** IP 归属检测；任何失败返回 null（退回纯公共源）。ip-api 免费版 http 无 key。 */
    private suspend fun detectGeo(): Pair<String, String>? = withContext(Dispatchers.IO) {
        try {
            kotlinx.coroutines.withTimeout(FETCH_TOTAL_TIMEOUT_MS) {
                val text = fetchText(GEO_API) ?: return@withTimeout null
                val o = org.json.JSONObject(text)
                if (o.optString("status") != "success") return@withTimeout null
                val province = o.optString("regionName")
                if (province !in PROVINCE_SOURCES) return@withTimeout null
                val ispRaw = o.optString("isp").lowercase()
                val isp = when {
                    ispRaw.contains("telecom") || ispRaw.contains("chinanet") || ispRaw.contains("电信") -> "telecom"
                    ispRaw.contains("unicom") || ispRaw.contains("联通") -> "unicom"
                    ispRaw.contains("mobile") || ispRaw.contains("cmcc") || ispRaw.contains("移动") -> "mobile"
                    else -> "other"
                }
                province to isp
            }
        } catch (e: Exception) {
            Log.i(TAG, "geo detect failed: ${e.message}")
            null
        }
    }

    /** 归属省候选源：ISP 精确匹配，为空并入该省全部源（测速裁决） */
    private fun geoSources(geo: Pair<String, String>): List<String> {
        val table = PROVINCE_SOURCES[geo.first] ?: return emptyList()
        val byIsp = table[geo.second]
        if (!byIsp.isNullOrEmpty()) return byIsp
        return table.values.flatten()
    }

    /** 全链路：拉取 → 解析 → 测速 → 净化 M3U → 删旧 → 导入。返回可用频道数。 */
    suspend fun run(): Int = withContext(Dispatchers.Default) {
        val publicSources = activeSources()
        val geo = detectGeo()
        val geoList = geo?.let { geoSources(it) }.orEmpty()
        if (geo != null) Log.i(TAG, "geo: ${geo.first}/${geo.second} +${geoList.size} province sources")
        val sources = publicSources + geoList.filter { g -> publicSources.none { it == g } }
        Log.i(TAG, "start: fetching ${sources.size} sources")
        val channels = fetchAndParseAll(sources)
        Log.i(TAG, "fetched ${channels.size} raw channel entries")
        if (channels.isEmpty()) {
            Log.w(TAG, "no channels fetched, keeping existing sources")
            return@withContext 0
        }

        val deduped = dedupeByUrl(channels)
        Log.i(TAG, "after url dedupe: ${deduped.size}")
        val results = probeAll(deduped)
        val okCount = results.count { it.value.ok }
        Log.i(TAG, "probe done: $okCount ok / ${results.size} total")

        val usable = pickFastestByName(
            deduped.filter { results[it.url]?.ok == true },
            results,
        )
        if (usable.isEmpty()) {
            Log.w(TAG, "no usable channels, keeping existing sources")
            return@withContext 0
        }

        // 净化 M3U → 本地文件 → core 导入（requiresNetwork=false 的本地路径）
        val m3uText = buildString {
            append("#EXTM3U\n")
            for (c in usable) {
                val group = c.group.ifBlank { "未分组" }
                append("#EXTINF:-1 group-title=\"").append(group.escapeM3uAttr()).append("\",")
                    .append(c.name.escapeM3uText()).append('\n')
                append(c.url).append('\n')
            }
        }
        val file = java.io.File(context.cacheDir, "auto-source.m3u")
        file.writeText(m3uText)
        Log.i(TAG, "cleaned m3u written: ${usable.size} channels -> ${file.absolutePath}")

        deleteOldAutoSource()
        importer.m3u(name = AUTO_SOURCE_NAME, url = file.absolutePath, makeDefault = false)
        linkAutoSourceToAllProfiles()
        prefs().edit().putLong(KEY_LAST_SUCCESS, System.currentTimeMillis()).apply()
        Log.i(TAG, "auto source imported: ${usable.size} channels")
        usable.size
    }

    /**
     * 把自动源链接到**所有**现有 profile。导入走 core 的 runImport，只挂 createdProfileId
     * （无则兜底 fallback）——跨进程重启后 createdProfileId 丢失，自动源会落不到用户的
     * profile 上。profile↔source 是多对多链接表，导入后补齐每个 profile 的链接即可。
     */
    private suspend fun linkAutoSourceToAllProfiles() {
        try {
            val auto = db.sourceDao().getAllOnce().filter { it.name == AUTO_SOURCE_NAME }
            if (auto.isEmpty()) return
            val profiles = db.profileDao().getAllOnce()
            val linked = db.sourceDao().allLinks().map { "${it.profileId}:${it.sourceId}" }.toMutableSet()
            var added = 0
            for (p in profiles) for (s in auto) {
                if (linked.add("${p.id}:${s.id}")) {
                    db.sourceDao().link(tv.own.owntv.core.database.entity.ProfileSourceCrossRef(p.id, s.id))
                    added++
                }
            }
            if (added > 0) Log.i(TAG, "linked auto source to $added profile(s) (total ${profiles.size})")
        } catch (e: Exception) {
            Log.w(TAG, "link auto source to profiles failed: ${e.message}")
        }
    }

    private fun prefs() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // ---------- 拉取与解析 ----------

    private data class RawChannel(val name: String, val url: String, val group: String)

    private suspend fun fetchAndParseAll(sources: List<String>): List<RawChannel> = coroutineScope {
        sources.map { url ->
            async {
                try {
                    // withTimeout 兜底：connectTimeout 管不到 DNS 解析（模拟器 DoT 挂起时
                    // getaddrinfo 可无限期阻塞），协程取消能让挂着的 connect/read 全部终止。
                    kotlinx.coroutines.withTimeout(FETCH_TOTAL_TIMEOUT_MS) {
                        withContext(Dispatchers.IO) { fetchText(url) }
                    }?.let { parseM3u(it) } ?: emptyList()
                } catch (e: Exception) {
                    Log.w(TAG, "fetch failed: $url: ${e.javaClass.simpleName}: ${e.message}")
                    emptyList()
                }
            }
        }.awaitAll().flatten()
    }

    private fun fetchText(url: String): String? {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = TIMEOUT_MS
                readTimeout = 30_000
                instanceFollowRedirects = true
            }
            if (conn.responseCode in 200..299) conn.inputStream.bufferedReader().use { it.readText() } else null
        } finally {
            conn?.disconnect()
        }
    }

    /** 轻量 M3U 解析（与 WebView 版 parseM3U 同规则：EXTINF 属性 + 下一非注释行为 URL） */
    private fun parseM3u(text: String): List<RawChannel> {
        val out = mutableListOf<RawChannel>()
        var pending: Triple<String, String, String>? = null // name, group, url placeholder
        for (raw in text.lineSequence()) {
            val line = raw.trim()
            when {
                line.startsWith("#EXTINF") -> {
                    val name = line.substringAfterLast(',').trim().ifBlank { "未知频道" }
                    val group = Regex("group-title=\"([^\"]*)\"").find(line)?.groupValues?.get(1).orEmpty()
                    pending = Triple(name, group, "")
                }
                line.isEmpty() || line.startsWith("#") -> Unit
                pending != null -> {
                    out.add(RawChannel(pending.first, line, pending.second))
                    pending = null
                }
            }
        }
        return out
    }

    private fun String.escapeM3uAttr(): String = replace("\\", "\\\\").replace("\"", "\\\"")
    private fun String.escapeM3uText(): String = replace("\n", " ").trim()

    // ---------- 测速 ----------

    private data class Probe(val ok: Boolean, val latencyMs: Long)

    private suspend fun probeAll(channels: List<RawChannel>): Map<String, Probe> {
        val sem = Semaphore(CONCURRENCY)
        val results = ConcurrentHashMap<String, Probe>()
        coroutineScope {
            for (c in channels) {
                sem.withPermit {
                    results[c.url] = withContext(Dispatchers.IO) {
                        // 同 fetch：withTimeout 兜底 DNS 挂起（connectTimeout 管不到 getaddrinfo）
                        try {
                            kotlinx.coroutines.withTimeout(TIMEOUT_MS + 2_000L) { probeOne(c.url) }
                        } catch (e: Exception) {
                            Probe(false, TIMEOUT_MS.toLong())
                        }
                    }
                }
            }
        }
        return results
    }

    private fun probeOne(url: String): Probe {
        val t0 = System.currentTimeMillis()
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                instanceFollowRedirects = true
                requestMethod = "GET"
            }
            val code = conn.responseCode
            if (code !in 200..299) return Probe(false, System.currentTimeMillis() - t0)
            if (url.substringBefore('?').lowercase().endsWith(".m3u8")) {
                // 读前 1KB 校验 #EXTM3U（防伪 HLS）
                val head = conn.inputStream.use { ins ->
                    val buf = ByteArray(1024)
                    val n = ins.read(buf)
                    if (n > 0) String(buf, 0, n, Charsets.UTF_8) else ""
                }
                if (!head.contains("#EXTM3U")) return Probe(false, System.currentTimeMillis() - t0)
            }
            Probe(true, System.currentTimeMillis() - t0)
        } catch (e: Exception) {
            Probe(false, System.currentTimeMillis() - t0)
        } finally {
            conn?.disconnect()
        }
    }

    // ---------- 去重与裁决 ----------

    private fun dedupeByUrl(channels: List<RawChannel>): List<RawChannel> {
        val seen = HashSet<String>()
        return channels.filter { seen.add(it.url) }
    }

    private fun pickFastestByName(channels: List<RawChannel>, probe: Map<String, Probe>): List<RawChannel> {
        val best = LinkedHashMap<String, RawChannel>()
        val latencies = HashMap<String, Long>()
        for (c in channels) {
            val latency = probe[c.url]?.latencyMs ?: Long.MAX_VALUE
            val cur = best[c.name]
            if (cur == null || latency < (latencies[c.name] ?: Long.MAX_VALUE)) {
                best[c.name] = c
                latencies[c.name] = latency
            }
        }
        return best.values.toList()
    }

    /** 删除旧的「自动源」（按名字；导入前调用，避免 uniqueName 生成「自动源(2)」） */
    private suspend fun deleteOldAutoSource() {
        try {
            db.sourceDao().getAllOnce()
                .filter { it.name == AUTO_SOURCE_NAME }
                .forEach { sourceRepository.deleteSource(it) }
        } catch (e: Exception) {
            Log.w(TAG, "delete old auto source failed: ${e.message}")
        }
    }
}
