/*
 * No `org.jetbrains.kotlin.android` here on purpose.
 *
 * AGP 9 ships Kotlin support built in and rejects the standalone plugin
 * outright. The two compiler plugins below are still applied separately —
 * they are Kotlin compiler features, not the Kotlin Android integration.
 */
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "com.highlighthelper"
    // Only the API 37 platform is installed on this machine, and there is no
    // sdkmanager to fetch an older one — so this tracks what is actually here.
    compileSdk = 37

    defaultConfig {
        applicationId = "com.highlighthelper"
        // WebView's ES module support and PROCESS_TEXT both go back much
        // further; 26 is a floor chosen for the Kotlin/Compose baseline.
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    debugImplementation(libs.androidx.ui.tooling)

    implementation(libs.androidx.webkit)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.security.crypto)
    implementation(libs.androidx.browser)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
}

/*
 * The detector engine is the extension's own source, copied in verbatim.
 *
 * This is the whole reason the app exists in this shape. The currency tables,
 * the unit conversions, the number parser, the calculator — roughly three
 * thousand lines of fiddly, well-tested logic — are not reimplemented here.
 * They are copied at build time and run unmodified in a headless WebView, so
 * `node test/detectors.test.js` at the repo root remains the single source of
 * truth for both platforms.
 *
 * Copying rather than symlinking because Windows symlinks need elevation and
 * the AGP asset packer follows them inconsistently. Copying rather than a
 * bundler because the extension has no build step and this must not give it
 * one: `import` resolves natively in a WebView, so the files work as they are.
 */
val syncEngine = tasks.register<Copy>("syncEngine") {
    description = "Copies the extension's JS engine into the app's assets."
    group = "build"

    from(rootProject.file("../src")) {
        // Everything the detectors import, transitively. The panel's own CSS and
        // the options page are browser-only and deliberately left behind.
        include("common/**/*.js")
        // Only these two of the background modules. They do the encyclopedia
        // and Wiktionary work, and the bridge gives them a fetch that goes out
        // through OkHttp. The rest of that folder belongs to the service
        // worker — deepseek.js holds the key, service-worker.js builds context
        // menus — and none of it is imported here; shipping it would only put
        // code that reaches for `chrome.*` inside the APK.
        include("background/wikipedia.js")
        include("background/dictionary.js")
        include("content/detectors/**/*.js")
        include("content/kit.js")
        include("content/icons.js")
        include("content/qr.js")
        include("content/anchor.js")
        include("content/locate.js")
        include("content/speech.js")
        include("content/local-ai.js")
        include("content/highlights.js")
    }
    into(layout.projectDirectory.dir("src/main/assets/engine/src"))

    // A stale copy is worse than no copy: it silently runs last week's parser.
    doFirst { delete(layout.projectDirectory.dir("src/main/assets/engine/src")) }
}

tasks.named("preBuild") { dependsOn(syncEngine) }
