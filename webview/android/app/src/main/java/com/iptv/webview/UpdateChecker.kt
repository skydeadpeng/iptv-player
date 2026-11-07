package com.iptv.webview

import android.app.DownloadManager
import android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * 自动更新：查 GitHub releases/latest → 按 ABI 与前缀匹配资产 → DownloadManager 下载 →
 * 下载完成广播里发起安装（公共 Downloads 目录，content:// 直装，无需 FileProvider）。
 *
 * 发布仓库 [REPO] 只放本壳的 APK（原生版发布在 skydeadpeng/iptv-player——那边的 core
 * UpdateManager 按纯 ABI 过滤资产，混入本壳的包会被它误选）。资产命名
 * `IPTV-Webview-vX.Y.Z.apk`，x86_64 变体在名字里含 `x86_64`。
 */
object UpdateChecker {
    private const val TAG = "IptvUpdate"
    private const val REPO = "skydeadpeng/iptv-player-web"
    private const val ASSET_PREFIX = "IPTV-Webview-"
    private var receiverRegistered = false

    fun checkAsync(context: Context) {
        val app = context.applicationContext
        ExecutorsHolder.execute {
            try {
                check(app)
            } catch (e: Exception) {
                Log.w(TAG, "update check failed: ${e.message}")
            }
        }
    }

    private fun check(context: Context) {
        val conn = (URL("https://api.github.com/repos/$REPO/releases/latest").openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 10_000
            setRequestProperty("User-Agent", "iptv-webview")
            setRequestProperty("Accept", "application/vnd.github+json")
        }
        val body = if (conn.responseCode in 200..299) conn.inputStream.bufferedReader().use { it.readText() } else null
        conn.disconnect()
        if (body == null) { Log.i(TAG, "no release info"); return }
        val release = JSONObject(body)
        val tag = release.optString("tag_name")
        val notes = release.optString("body").take(300)
        val current = context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: return

        val apkUrl = release.optJSONArray("assets")?.let { assets ->
            val wantX86 = Build.SUPPORTED_ABIS.firstOrNull() == "x86_64"
            (0 until assets.length()).asSequence()
                .mapNotNull { assets.optJSONObject(it) }
                .mapNotNull { a ->
                    val name = a.optString("name")
                    val url = a.optString("browser_download_url")
                    if (!name.startsWith(ASSET_PREFIX) || !name.endsWith(".apk")) return@mapNotNull null
                    if (name.contains("x86_64", true) == wantX86) url else null
                }
                .firstOrNull()
        }
        if (apkUrl == null) { Log.i(TAG, "no compatible asset in $tag"); return }
        if (!isNewer(tag, current)) { Log.i(TAG, "up to date ($current)"); return }

        Log.i(TAG, "update available: $tag (installed $current)")
        registerReceiver(context)
        download(context, tag, apkUrl, notes)
    }

    /** vX.Y.Z 语义比较；格式异常视为不更新 */
    private fun isNewer(tag: String, current: String): Boolean {
        fun parts(s: String) = s.removePrefix("v").split('-').first().split('.').map { it.toIntOrNull() ?: 0 }
        val a = parts(tag)
        val b = parts(current)
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(i) { 0 }
            val y = b.getOrElse(i) { 0 }
            if (x != y) return x > y
        }
        return false
    }

    private fun download(context: Context, tag: String, apkUrl: String, notes: String) {
        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val request = DownloadManager.Request(Uri.parse(apkUrl)).apply {
            setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "$tag.apk")
            setMimeType("application/vnd.android.package-archive")
            setTitle("IPTV 直播 ${tag.removePrefix("v")}")
            setDescription(notes.ifBlank { "下载完成后点击安装" })
            setNotificationVisibility(VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        }
        val id = dm.enqueue(request)
        Log.i(TAG, "download enqueued id=$id")
    }

    /** 下载完成广播 → 发起系统安装器。DownloadManager 只支持 manifest 静态注册的 receiver。 */
    private fun registerReceiver(context: Context) {
        if (receiverRegistered) return
        receiverRegistered = true
        val app = context.applicationContext
        if (Build.VERSION.SDK_INT >= 33) {
            app.registerReceiver(DownloadCompletedReceiver(), IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                Context.RECEIVER_NOT_EXPORTED)
        } else {
            app.registerReceiver(DownloadCompletedReceiver(), IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE))
        }
    }

    class DownloadCompletedReceiver : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
            val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
            val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val uri = dm.getUriForDownloadedFile(id) ?: return
            val mime = dm.getMimeTypeForDownloadedFile(id)
            Log.i(TAG, "download complete: $uri ($mime)")
            val install = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
                setDataAndType(uri, mime.ifBlank { "application/vnd.android.package-archive" })
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            runCatching { context.startActivity(install) }
                .onFailure { Log.w(TAG, "install prompt failed: ${it.message}") }
        }
    }

    private object ExecutorsHolder {
        private val exec = java.util.concurrent.Executors.newSingleThreadExecutor()
        fun execute(block: () -> Unit): Unit = exec.execute(block)
    }
}
