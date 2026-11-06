package com.iptv.webview

import android.annotation.SuppressLint
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
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
 *
 * 注意：基类用 ComponentActivity（不能用 android.app.Activity）——
 * registerForActivityResult 是 androidx.activity.ComponentActivity 的 API，
 * android.app.Activity 没有该方法；且 manifest 用的是平台主题 @android:style/Theme.Black.*，
 * 不能用 AppCompatActivity（会因非 AppCompat 主题崩溃）。
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView

    /** 本次文件选择请求的 key；JS 线程写、UI 线程读，故加 @Volatile */
    @Volatile
    private var pendingKey: String = ""

    /** 选文件返回的文本可能很大（几 MB 播放列表），放后台线程读，避免主线程卡顿 */
    private val io = Executors.newSingleThreadExecutor()

    /** key 生成用：时间戳 + 自增序号，避免同毫秒内两次请求撞 key */
    private val keySeq = AtomicLong(0)

    // H5 发起文件选择 → 系统文件选择器 → 文本回传 JS
    private val pickFile = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (!::web.isInitialized) return@registerForActivityResult
        // 用户取消时 uri 为 null：必须回传 null，否则 H5 侧等满 120s 超时
        if (uri == null) {
            web.evaluateJavascript("window.__iptvFileReady(null)", null)
            return@registerForActivityResult
        }
        // 先取 key 再异步读文件：避免读取期间发生下一次请求导致 key 错位
        val key = pendingKey
        val name = uri.lastPathSegment?.substringAfterLast('/')?.ifBlank { null } ?: "playlist.m3u"
        io.execute {
            val text = contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() } ?: ""
            runOnUiThread { deliverFile(key, name, text) }
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
                view.evaluateJavascript(
                    "(function(){try{localStorage.setItem('__probe','1');localStorage.removeItem('__probe');" +
                        "return 'ls=ok bridge=' + (typeof window.IptvBridge);}catch(e){return 'ls=FAIL ' + e;}})()",
                ) { Log.i(TAG, "壳内自检: ${it ?: "null"}") }
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
    }

    override fun onDestroy() {
        io.shutdown()
        super.onDestroy()
    }

    /** 把选中的文件回传给 H5：window.__iptvFileReady({key, name, text}) */
    private fun deliverFile(key: String, name: String, text: String) {
        val inline = JSONObject().apply {
            put("key", key)
            put("name", name)
            put("text", text)
        }.toString()
        if (inline.length <= INLINE_LIMIT_CHARS) {
            web.evaluateJavascript("window.__iptvFileReady($inline)", null)
            return
        }
        // 大载荷：evaluateJavascript 的 Binder 事务有 ~1MB 上限，一次性传大字符串会抛
        // TransactionTooLargeException。改为分块送到渲染进程内拼接，再按单对象 payload 回调。
        web.evaluateJavascript("window.__iptvText = '';", null)
        var offset = 0
        while (offset < text.length) {
            var end = minOf(offset + CHUNK_CHARS, text.length)
            if (end > offset + 1 && end < text.length && text[end - 1].code in 0xD800..0xDBFF) end-- // 不切断代理对
            web.evaluateJavascript("window.__iptvText += ${JSONObject.quote(text.substring(offset, end))};", null)
            offset = end
        }
        val keyJson = JSONObject.quote(key)
        val nameJson = JSONObject.quote(name)
        web.evaluateJavascript(
            "window.__iptvFileReady({key:$keyJson,name:$nameJson,text:window.__iptvText});delete window.__iptvText;",
            null,
        )
    }

    inner class Bridge {
        @android.webkit.JavascriptInterface
        fun pickM3uFile(): String {
            val key = "${System.currentTimeMillis()}_${keySeq.incrementAndGet()}"
            pendingKey = key
            runOnUiThread { pickFile.launch(arrayOf("text/plain", "*/*")) }
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
        const val INLINE_LIMIT_CHARS = 200_000
        const val CHUNK_CHARS = 100_000
    }
}
