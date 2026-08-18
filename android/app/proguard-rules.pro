# R8 rules for the release build.
#
# Most of this app can be shrunk and renamed freely. Two things cannot, and both
# fail in ways that only appear in a release build — which is the worst kind of
# breakage, because debug builds keep working while the shipped one does not.

# 1. The JavaScript bridge.
#
# `AndroidHost` is called by name from bridge.js: `AndroidHost.request(...)`,
# `AndroidHost.settle(...)`, `AndroidHost.ready()`. Nothing in Kotlin calls
# those methods, so R8 sees them as dead code and removes or renames them. The
# engine then loads, calls a method that no longer exists, and every request
# hangs until it times out — with no error anywhere, because the failure is on
# the JavaScript side of a bridge that no longer has a far end.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# 2. The serialized models.
#
# Row, Detection and View are filled in by kotlinx.serialization from JSON whose
# keys are written in bridge.js. Renaming the fields renames the keys the
# generated serializer looks for, and every one of them silently reads as absent
# — a sheet full of rows with no labels rather than a crash.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

-keepclassmembers @kotlinx.serialization.Serializable class * {
    static <1>$Companion Companion;
    static **$* *;
}
-keepclasseswithmembers class ** {
    @kotlinx.serialization.Serializable <fields>;
}

# OkHttp ships its own consumer rules; these only silence warnings about the
# optional platform integrations it references but does not require.
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# Tink, which backs EncryptedSharedPreferences, is annotated with Error Prone's
# compile-time annotations. They are not on the runtime classpath by design, so
# R8 reports them as missing classes and refuses to finish. Nothing references
# them at runtime; suppressing the warning is the documented answer, and these
# four are exactly the ones R8 asked for in missing_rules.txt.
-dontwarn com.google.errorprone.annotations.CanIgnoreReturnValue
-dontwarn com.google.errorprone.annotations.CheckReturnValue
-dontwarn com.google.errorprone.annotations.Immutable
-dontwarn com.google.errorprone.annotations.RestrictedApi
