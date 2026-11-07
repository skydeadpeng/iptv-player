package com.iptv.webview

import android.annotation.SuppressLint
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

/**
 * WebView 薄壳：加载 assets/web 下的 H5 构建产物，注入 IptvBridge 供 H5 发起原生文件选择。
 *
 * 与 H5 侧 src/bridge/native.ts 的契约（三条必须满足）：
 *  1. pickM3uFile() 无参，同步返回本次请求的 key（字符串）
 *  2. 结果经 window.__iptvFileReady({key, name, text}) 单对象回传，key 统一为字符串
 *  3. 用户取消必须回传 window.__iptvFileReady(null)，否则 H5 侧会等满 120s 超时
 *     （只取消单个请求时可回传 {key, name:null, text:null}，native.ts 明确支持该语义）
 *
 * 并发导入（TV 遥控器连按）：
 *  - 每个 pickM3uFile() 调用生成唯一 key（时间戳_序号），登记进 pending Map；
 *  - 系统选择器单飞：选择器已打开时不再 launch 第二个（ActivityResultRegistry 按注册 key
 *    存回调，二次 launch() 会覆盖回调、第一次结果被静默丢弃），新请求并入既有会话；
 *  - 结果回来后按 key 逐一取出 Pending 回传并移除：打开选择器的那个 key 收到文件内容，
 *    并入同一会话的其余 key 收到 {name:null,text:null}（按「取消」处理），
 *    既不丢结果也不会让 H5 等满 120s。
 *
 * 注意：基类用 ComponentActivity（不能用 android.app.Activity）——
 * registerForActivityResult 是 androidx.activity.ComponentActivity 的 API，
 * android.app.Activity 没有该方法；且 manifest 用的是平台主题 @android:style/Theme.Black.*，
 * 不能用 AppCompatActivity（会因非 AppCompat 主题崩溃）。
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView

    /** 选文件返回的文本可能很大（几 MB 播放列表），放后台线程读，避免主线程卡顿 */
    private val io = Executors.newSingleThreadExecutor()

    /** key 生成用：时间戳 + 自增序号，避免同毫秒内两次请求撞 key */
    private val keySeq = AtomicLong(0)

    /** 会话 id 生成用：一次系统选择器 = 一个会话 */
    private val sessionSeq = AtomicLong(0)

    /** 待回传的 H5 请求：key → Pending。JS 线程写 / UI 线程读，故加锁；LinkedHashMap 保序 */
    private val pending = LinkedHashMap<String, Pending>()

    /** pending 的锁 */
    private val pendingLock = Any()

    /** 当前打开中的选择器会话 id；0 = 无选择器打开（同一时刻只允许一个 outstanding launch） */
    private var openSessionId: Long = 0L

    /** 自检探针重试用的 handler（模块脚本可能晚于 onPageFinished 执行） */
    private val probeHandler = Handler(Looper.getMainLooper())

    /** 自检探针已重试次数 */
    private var probeAttempts = 0

    /** 一个待回传的 H5 请求 */
    private class Pending(
        /** H5 侧拿到的 key（字符串） */
        val key: String,
        /** 归属的选择器会话 id */
        val sessionId: Long,
        /** 是否是打开该选择器的那个请求（true → 收到文件内容；false → 收到「取消」） */
        val ownsPicker: Boolean,
    )

    // H5 发起文件选择 → 系统文件选择器 → 文本回传 JS
    private val pickFile = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (!::web.isInitialized) return@registerForActivityResult
        // 取走本会话的全部请求 key（登记顺序：第一个是打开选择器的那个）
        val keys: List<String>
        synchronized(pendingLock) {
            val sessionId = openSessionId
            openSessionId = 0L // 选择器已关闭：允许后续请求再开新的选择器
            keys = pending.entries.filter { it.value.sessionId == sessionId }.map { it.key }
            if (uri == null) {
                // 用户取消：native.ts 语义「null 载荷 = 取消全部 pending」
                pending.clear()
            }
        }
        // 用户取消时 uri 为 null：必须回传 null，否则 H5 侧等满 120s 超时
        if (uri == null) {
            web.evaluateJavascript("window.__iptvFileReady(null)", null)
            return@registerForActivityResult
        }
        val name = displayName(uri)
        io.execute {
            val text = contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() } ?: ""
            runOnUiThread {
                keys.forEach { key ->
                    val owner = synchronized(pendingLock) { pending.remove(key)?.ownsPicker } ?: false
                    if (owner) {
                        deliverFile(key, name, text)
                    } else {
                        // 并入同一会话的请求：同一时刻只有一个选择器，只能选出一个文件，
                        // 按「取消」回传，避免 H5 侧把同一个文件重复导入。
                        deliverCancelled(key)
                    }
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) // 播放常亮
        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true          // localStorage 必须
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
        }
        // 壳内直连任意订阅/播放源，不受 CORS 限制（file:// 页面跨源取 http(s) 内容的开关；
        // 平台已标记 deprecated（建议改用 WebViewAssetLoader），但仍生效——不这样远程源多半被 CORS 拦掉）
        @Suppress("DEPRECATION")
        web.settings.setAllowUniversalAccessFromFileURLs(true)
        @Suppress("DEPRECATION")
        web.settings.setAllowFileAccessFromFileURLs(true)
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                // 真机自检：localStorage 可用性（收藏/最近播放依赖它）+ 壳侧桥是否注入成功
                // + H5 是否真的启动（main.ts 末尾置 window.__iptvBooted）。
                // 只查 ls+bridge 会把「ES module 被 file:// CORS 拦掉 → 整页空白」误判成启动成功。
                probeAttempts = 0
                runSelfCheck(view)
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                super.onReceivedError(view, request, error)
                Log.e(
                    TAG,
                    "资源加载失败: ${request.url} code=${error.errorCode} desc=${error.description} " +
                        "mainFrame=${request.isForMainFrame}",
                )
            }

            override fun onReceivedHttpError(
                view: WebView,
                request: WebResourceRequest,
                errorResponse: WebResourceResponse,
            ) {
                super.onReceivedHttpError(view, request, errorResponse)
                Log.e(
                    TAG,
                    "HTTP 错误: ${request.url} code=${errorResponse.statusCode} reason=${errorResponse.reasonPhrase} " +
                        "mainFrame=${request.isForMainFrame}",
                )
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                Log.i(TAG, "H5[${msg.messageLevel()}] ${msg.message()} @${msg.sourceId()}:${msg.lineNumber()}")
                return super.onConsoleMessage(msg)
            }
        }
        web.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        web.addJavascriptInterface(Bridge(), "IptvBridge")
        // 可调试包开启 WebView 远程调试（chrome://inspect），方便 Task 9 真机联调
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        web.loadUrl("file:///android_asset/web/index.html")
        // 自动更新：启动后台检查 GitHub Releases（无新版无副作用，重复触发无害）
        UpdateChecker.checkAsync(this)
    }

    override fun onDestroy() {
        probeHandler.removeCallbacksAndMessages(null)
        io.shutdown()
        super.onDestroy()
    }

    /**
     * 自检探针：一次 evaluateJavascript 拿到 localStorage / 桥 / H5 启动标记三项结果。
     * booted=false 且没有 bootErr 时可能是模块脚本尚未执行完，延迟重试（最多 3 次）。
     */
    private fun runSelfCheck(view: WebView) {
        view.evaluateJavascript(PROBE_JS) { result ->
            val r = result ?: "null"
            Log.i(TAG, "壳内自检[$probeAttempts]: $r")
            if (r.contains("booted=false") && r.contains("bootErr=none") && probeAttempts < PROBE_MAX_RETRY) {
                probeAttempts++
                probeHandler.postDelayed({ runSelfCheck(view) }, PROBE_RETRY_DELAY_MS)
            }
        }
    }

    /**
     * 取可显示的文件名：优先 OpenableColumns.DISPLAY_NAME。
     * SAF/MediaStore 的 content URI 里 lastPathSegment 是媒体 id（如 "msf:21"），不是文件名，
     * 直接拿它当源名会让 H5 侧源列表显示成 "msf:21"。
     */
    private fun displayName(uri: android.net.Uri): String {
        try {
            contentResolver.query(
                uri,
                arrayOf(android.provider.OpenableColumns.DISPLAY_NAME),
                null,
                null,
                null,
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) {
                        val name = cursor.getString(idx)
                        if (!name.isNullOrBlank()) return name
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "读取文件名失败，回落到 lastPathSegment: ${e.message}")
        }
        return uri.lastPathSegment?.substringAfterLast('/')?.ifBlank { null } ?: "playlist.m3u"
    }

    /** 把选中的文件回传给 H5：window.__iptvFileReady({key, name, text}) */
    private fun deliverFile(key: String, name: String, text: String) {
        val payload = JSONObject().apply {
            put("key", key)
            put("name", name)
            // U+2028/U+2029 在 JS 字符串字面量里是换行符（ES2019 前会 SyntaxError），转义后再送
            put("text", text.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))
        }.toString()
        // 单次内联回传：evaluateJavascript 走的是 Mojo IPC（不是 Binder），没有 ~1MB 事务上限。
        // 早前基于「Binder 1MB 上限」做的分块回传引入了「页面导航/重载导致 window.__iptvText
        // 丢失 → 文件内容静默丢失被当作用户取消」的新失败模式，H5 侧却零感知，故简化为单次调用。
        web.evaluateJavascript("window.__iptvFileReady($payload)", null)
    }

    /** 取消单个请求：window.__iptvFileReady({key, name:null, text:null})（native.ts 按取消处理） */
    private fun deliverCancelled(key: String) {
        val payload = JSONObject().apply {
            put("key", key)
            put("name", JSONObject.NULL)
            put("text", JSONObject.NULL)
        }.toString()
        web.evaluateJavascript("window.__iptvFileReady($payload)", null)
    }

    inner class Bridge {
        @android.webkit.JavascriptInterface
        fun pickM3uFile(): String {
            var launchPicker = false
            val key: String
            synchronized(pendingLock) {
                key = "${System.currentTimeMillis()}_${keySeq.incrementAndGet()}"
                if (openSessionId != 0L) {
                    // 已有未完成的请求（选择器还开着）：并入同一会话，不新开选择器，
                    // 也不覆盖既有 Pending（覆盖会让先到的结果挂到后一个 key 上 / 直接丢失）。
                    pending[key] = Pending(key, openSessionId, ownsPicker = false)
                } else {
                    openSessionId = sessionSeq.incrementAndGet()
                    pending[key] = Pending(key, openSessionId, ownsPicker = true)
                    launchPicker = true
                }
            }
            if (launchPicker) {
                runOnUiThread { pickFile.launch(arrayOf("text/plain", "*/*")) }
            }
            return key
        }
    }

    @Deprecated("用 OnBackPressedDispatcher 替代（保留以便 Task 9 真机验证）")
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    private companion object {
        const val TAG = "IptvWebview"

        /** 自检探针：ls + bridge + H5 启动标记（booted/bootErr 由 web/src/main.ts 设置） */
        const val PROBE_JS =
            "(function(){try{localStorage.setItem('__probe','1');localStorage.removeItem('__probe');" +
                "return 'ls=ok bridge=' + (typeof window.IptvBridge)" +
                " + ' booted=' + (window.__iptvBooted === true)" +
                " + ' bootErr=' + (window.__iptvBootError || 'none');" +
                "}catch(e){return 'ls=FAIL ' + e;}})()"

        /** 探针最大重试次数（模块脚本可能晚于 onPageFinished 执行） */
        const val PROBE_MAX_RETRY = 3

        /** 探针重试间隔 */
        const val PROBE_RETRY_DELAY_MS = 400L
    }
}
