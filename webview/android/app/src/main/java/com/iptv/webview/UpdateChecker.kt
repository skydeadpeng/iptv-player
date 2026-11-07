package com.iptv.webview

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * 自动更新：查 GitHub releases/latest → 按 ABI 与前缀匹配资产 → app 内下载 → PackageInstaller 安装。
 *
 * 刻意不用 DownloadManager：它是独立系统进程，不随宿主网络配置（模拟器代理、应用级代理）走，
 * 断点/重试语义也与 app 进程脱节。app 内下载（OkHttp 同款阻塞流）与 core UpdateManager 同构。
 *
 * 发布仓库 [REPO] 只放本壳的 APK（原生版发布在 skydeadpeng/iptv-player——那边的 core
 * UpdateManager 按纯 ABI 过滤资产，混入本壳的包会被它误选）。资产命名
 * `IPTV-Webview-vX.Y.Z.apk`，x86_64 变体在名字里含 `x86_64`。
 */
object UpdateChecker {
    private const val TAG = "IptvUpdate"
    private const val REPO = "skydeadpeng/iptv-player-web"
    private const val ASSET_PREFIX = "IPTV-Webview-"

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
        val release = fetchJson("https://api.github.com/repos/$REPO/releases/latest") ?: return
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
        downloadAndInstall(context, tag, apkUrl, notes)
    }

    private fun fetchJson(url: String): JSONObject? {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 10_000
            setRequestProperty("User-Agent", "iptv-webview")
            setRequestProperty("Accept", "application/vnd.github+json")
        }
        val body = if (conn.responseCode in 200..299) conn.inputStream.bufferedReader().use { it.readText() } else null
        conn.disconnect()
        return body?.let { JSONObject(it) }
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

    /** app 内流式下载到 cacheDir → PackageInstaller 会话提交（系统接管安装确认） */
    private fun downloadAndInstall(context: Context, tag: String, apkUrl: String, notes: String) {
        val apk = File(context.cacheDir, "update-$tag.apk")
        apk.delete()
        val conn = (URL(apkUrl).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("User-Agent", "iptv-webview")
        }
        if (conn.responseCode !in 200..299) {
            Log.w(TAG, "apk download HTTP ${conn.responseCode}")
            conn.disconnect()
            return
        }
        conn.inputStream.use { input ->
            apk.outputStream().use { output -> input.copyTo(output, 64 * 1024) }
        }
        conn.disconnect()
        Log.i(TAG, "downloaded ${apk.length()} bytes -> ${apk.name}")
        install(context, apk)
    }

    /** PackageInstaller 会话安装（与 core UpdateManager 同构）；系统弹安装确认 UI */
    private fun install(context: Context, apk: File) {
        val pm = context.packageManager
        if (Build.VERSION.SDK_INT >= 30 && !pm.canRequestPackageInstalls()) {
            Log.w(TAG, "missing REQUEST_INSTALL_PACKAGES grant; user must allow 'install unknown apps'")
        }
        val statusReceiver = PendingIntent.getBroadcast(
            context,
            0,
            Intent(context, InstallStatusReceiver::class.java).setAction("com.iptv.webview.INSTALL_STATUS"),
            if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            else PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val session: PackageInstaller.Session = pm.packageInstaller.openSession(
            pm.packageInstaller.createSession(
                PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL),
            ),
        )
        session.openWrite("update.apk", 0, apk.length()).use { out ->
            apk.inputStream().use { it.copyTo(out) }
        }
        session.commit(statusReceiver.intentSender)
        session.close()
        Log.i(TAG, "install session committed (${apk.length()} bytes)")
        apk.delete()
    }

    /** PackageInstaller 状态回传（仅日志；失败时用户可重开 app 重试） */
    class InstallStatusReceiver : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
            when (status) {
                PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                    val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                    if (confirm != null) {
                        confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        context.startActivity(confirm)
                    }
                }
                PackageInstaller.STATUS_SUCCESS -> Log.i(TAG, "install success")
                else -> Log.w(TAG, "install failed: status=$status ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)}")
            }
        }
    }

    private object ExecutorsHolder {
        private val exec = java.util.concurrent.Executors.newSingleThreadExecutor()
        fun execute(block: () -> Unit): Unit = exec.execute(block)
    }
}
