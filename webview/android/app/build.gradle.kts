plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.iptv.webview"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.iptv.webview"
        minSdk = 24
        targetSdk = 35
        // 发布时用环境变量注入真版本号；本地默认 1.0.0（OwnTV 同款机制）
        versionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("VERSION_NAME") ?: "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // H5 构建产物放在项目目录之外（默认 ~/.cache/iptv-web-assets），
    // 由 webview/android/sync-web.sh 生成。放项目内有两个问题：
    //   1) 产物是 hls.js/mpegts.js 等第三方库的压缩代码，会触发静态扫描器的注入类误报；
    //   2) 每次改 H5 都产生 hash 文件名变动的大 diff。
    // 可用 IPTV_WEB_ASSETS 环境变量覆盖路径。
    sourceSets {
        getByName("main") {
            assets.srcDirs(
                providers.environmentVariable("IPTV_WEB_ASSETS")
                    .orElse(System.getProperty("user.home") + "/.cache/iptv-web-assets")
                    .get()
            )
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
