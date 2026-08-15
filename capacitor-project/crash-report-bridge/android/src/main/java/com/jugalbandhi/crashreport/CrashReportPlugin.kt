package com.jugalbandhi.crashreport

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.firebase.analytics.FirebaseAnalytics
import com.google.firebase.crashlytics.FirebaseCrashlytics

/**
 * Thin bridge to Firebase Crashlytics so JS-side errors that are already
 * being caught (and previously just silently swallowed via `_warn()`, or
 * never even reaching a console anyone could see on a real device) become
 * visible in the Play Console / Firebase console instead.
 *
 * Deliberately does nothing but fail soft when Firebase hasn't been wired
 * up yet: until the app ships its own google-services.json (see the
 * conditional `apply plugin` block in app/build.gradle), the default
 * FirebaseApp instance doesn't exist, and any call into the Crashlytics SDK
 * throws IllegalStateException. Every method here swallows that so the
 * rest of the app is completely unaffected either way.
 */
@CapacitorPlugin(name = "CrashReport")
class CrashReportPlugin : Plugin() {

    private fun crashlyticsOrNull(): FirebaseCrashlytics? =
        try { FirebaseCrashlytics.getInstance() } catch (e: Throwable) { null }

    private fun analyticsOrNull(): FirebaseAnalytics? =
        try { FirebaseAnalytics.getInstance(context) } catch (e: Throwable) { null }

    // Breadcrumb-style log line — attached to whatever report (fatal or
    // non-fatal) Crashlytics next sends for this session, doesn't send
    // anything on its own.
    @PluginMethod
    fun logMessage(call: PluginCall) {
        val message = call.getString("message") ?: return call.reject("message required")
        try { crashlyticsOrNull()?.log(message) } catch (e: Throwable) { /* no-op */ }
        call.resolve()
    }

    // Reports a caught (non-fatal) JS error immediately, so it shows up in
    // the Crashlytics dashboard even though it didn't crash the app.
    @PluginMethod
    fun recordError(call: PluginCall) {
        val message = call.getString("message") ?: return call.reject("message required")
        try {
            val fc = crashlyticsOrNull()
            if (fc != null) {
                call.getString("context")?.let { fc.setCustomKey("jb_context", it) }
                fc.recordException(RuntimeException(message))
            }
        } catch (e: Throwable) { /* no-op */ }
        call.resolve()
    }

    // Lets the reader opt out at runtime — called from the "Crash & usage
    // reports: On/Off" sidebar toggle (_applyCrashReportingPref() in
    // reader.html/index.html) any time the preference changes, and once on
    // every app launch to restore whatever the reader last chose. Toggles
    // BOTH Crashlytics and Analytics collection together — a single reader-
    // facing switch covering everything disclosed under "Crash & Diagnostic
    // Reporting" in the privacy policy (crash logs, diagnostics, device ID,
    // and basic app-interaction analytics all stop together when this is
    // off, so none of them are "required" data collection in the Play
    // Console Data Safety sense).
    @PluginMethod
    fun setEnabled(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: true
        try { crashlyticsOrNull()?.setCrashlyticsCollectionEnabled(enabled) } catch (e: Throwable) { /* no-op */ }
        try { analyticsOrNull()?.setAnalyticsCollectionEnabled(enabled) } catch (e: Throwable) { /* no-op */ }
        call.resolve()
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val ret = JSObject()
        ret.put("available", crashlyticsOrNull() != null)
        call.resolve(ret)
    }
}
