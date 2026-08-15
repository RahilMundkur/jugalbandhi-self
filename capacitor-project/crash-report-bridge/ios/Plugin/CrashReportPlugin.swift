import Foundation
import Capacitor
import FirebaseCore
import FirebaseCrashlytics
import FirebaseAnalytics

/**
 * Thin bridge to Firebase Crashlytics so JS-side errors that are already
 * being caught (and previously just silently swallowed via `_warn()`, or
 * never even reaching a console anyone could see on a real device) become
 * visible in the Play Console / Firebase console instead.
 *
 * Mirrors CrashReportPlugin.kt (the Android implementation) method for
 * method — see that file for the fuller reasoning behind each method.
 *
 * Deliberately does nothing but fail soft when Firebase hasn't been wired
 * up yet: until the app ships its own GoogleService-Info.plist, FirebaseApp
 * is never configured (see the guarded `FirebaseApp.configure()` call in
 * AppDelegate.swift), and `FirebaseApp.app()` is nil. Every method here
 * checks for that and no-ops instead of crashing, so the rest of the app is
 * completely unaffected either way — same contract as the Android side.
 */
@objc(CrashReportPlugin)
public class CrashReportPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CrashReportPlugin"
    public let jsName = "CrashReport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "logMessage",  returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recordError", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setEnabled",  returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise)
    ]

    // FirebaseApp.configure() is only ever called (guardedly) once, from
    // AppDelegate. If that never happened — no GoogleService-Info.plist in
    // the bundle — FirebaseApp.app() is nil and every Firebase SDK call
    // below is skipped rather than attempted.
    private func firebaseIsConfigured() -> Bool {
        return FirebaseApp.app() != nil
    }

    // Breadcrumb-style log line — attached to whatever report (fatal or
    // non-fatal) Crashlytics next sends for this session, doesn't send
    // anything on its own.
    @objc func logMessage(_ call: CAPPluginCall) {
        guard let message = call.getString("message") else {
            return call.reject("message required")
        }
        if firebaseIsConfigured() {
            Crashlytics.crashlytics().log(message)
        }
        call.resolve()
    }

    // Reports a caught (non-fatal) JS error immediately, so it shows up in
    // the Crashlytics dashboard even though it didn't crash the app.
    @objc func recordError(_ call: CAPPluginCall) {
        guard let message = call.getString("message") else {
            return call.reject("message required")
        }
        if firebaseIsConfigured() {
            if let context = call.getString("context") {
                Crashlytics.crashlytics().setCustomValue(context, forKey: "jb_context")
            }
            let error = NSError(
                domain: "JugalbandhiSelf.JSError",
                code: 0,
                userInfo: [NSLocalizedDescriptionKey: message]
            )
            Crashlytics.crashlytics().record(error: error)
        }
        call.resolve()
    }

    // Lets the reader opt out at runtime — called from the "Crash & usage
    // reports: On/Off" sidebar toggle (_applyCrashReportingPref() in
    // reader.html/index.html) any time the preference changes, and once on
    // every app launch to restore whatever the reader last chose. Toggles
    // BOTH Crashlytics and Analytics collection together, same as Android —
    // see CrashReportPlugin.kt's setEnabled() for the full privacy-policy
    // reasoning shared by both platforms.
    @objc func setEnabled(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? true
        if firebaseIsConfigured() {
            Crashlytics.crashlytics().setCrashlyticsCollectionEnabled(enabled)
            Analytics.setAnalyticsCollectionEnabled(enabled)
        }
        call.resolve()
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": firebaseIsConfigured()])
    }
}
