import Foundation
import Capacitor

/**
 * Bridges iOS On-Demand Resources to the WebView.
 *
 * Tag naming convention (set in Xcode → Resource Tags):
 *     audio_fr   → French
 *     audio_hi   → Hindi
 *     audio_th   → Thai
 *
 * Each tag is set to "Prefetched" in Xcode, so iOS downloads them
 * automatically before first launch. If a pack is missing (initial
 * download failed, user wiped device, etc.) we fall through to
 * NSBundleResourceRequest.beginAccessingResources to fetch on demand.
 */
@objc(AudioPackPlugin)
public class AudioPackPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AudioPackPlugin"
    public let jsName = "AudioPack"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus",   returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getFileUri",  returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPack", returnType: CAPPluginReturnPromise)
    ]

    // Cache so we don't re-create the request for every probe. Keep the
    // request alive while resources are in use; iOS frees them when the
    // request is released (and progress goes back to "missing").
    private var activeRequests: [String: NSBundleResourceRequest] = [:]

    private func tagFor(_ lang: String) -> String { "audio_\(lang)" }

    private func canaryFilename(_ lang: String) -> String {
        // One file per pack guaranteed to exist — used to confirm the pack
        // is actually downloaded, not merely "marked as fetched."
        // Chapter 1 paragraph 0 speaker is female in BOOK_DATA, so this is
        // the file that actually exists on disk.
        return "\(lang)_ch01_p000_female"   // .mp3 implied; Bundle.url(forResource:withExtension:)
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        guard let lang = call.getString("lang") else {
            return call.reject("lang required")
        }
        let tag = tagFor(lang)

        // Cheap first check: is the canary file already on disk?
        // On the iOS Simulator, ODR resources are usually already on disk
        // regardless of tag category, so this short-circuit makes everything
        // "just work" without needing a real ODR fetch.
        if let _ = Bundle.main.url(forResource: canaryFilename(lang), withExtension: "mp3") {
            call.resolve(["status": "available"])
            return
        }

        // If we already have a kept-alive request for this tag, treat the
        // pack as available. Otherwise tell JS to request a download.
        if activeRequests[tag] != nil {
            call.resolve(["status": "available"])
        } else {
            call.resolve(["status": "missing"])
        }
    }

    @objc func getFileUri(_ call: CAPPluginCall) {
        guard let lang      = call.getString("lang")      else { return call.reject("lang required") }
        guard let chapter   = call.getString("chapter")   else { return call.reject("chapter required") }
        guard let paragraph = call.getString("paragraph") else { return call.reject("paragraph required") }
        guard let speaker   = call.getString("speaker")   else { return call.reject("speaker required") }

        let basename = "\(lang)_ch\(chapter)_p\(paragraph)_\(speaker)"
        // ODR resources get extracted into the main bundle. Once the tag
        // is loaded, Bundle.main.url(forResource:withExtension:) returns
        // a file:// URL the WebView can fetch directly.
        guard let fileUrl = Bundle.main.url(forResource: basename, withExtension: "mp3") else {
            return call.reject("Audio file not found: \(basename).mp3 — pack '\(tagFor(lang))' may not be loaded yet")
        }

        var ret: [String: Any] = ["url": fileUrl.absoluteString]
        if let attrs = try? FileManager.default.attributesOfItem(atPath: fileUrl.path),
           let size = attrs[.size] as? NSNumber {
            ret["byteSize"] = size.intValue
        }
        call.resolve(ret)
    }

    @objc func requestPack(_ call: CAPPluginCall) {
        guard let lang = call.getString("lang") else {
            return call.reject("lang required")
        }
        let tag = tagFor(lang)

        // Always create a fresh NSBundleResourceRequest. Reusing one across
        // calls (or after a prior conditionallyBeginAccessingResources call)
        // raises an NSException — "beginAccessingResources called more than
        // once for the same request".
        let req = NSBundleResourceRequest(tags: [tag])
        req.loadingPriority = NSBundleResourceRequestLoadingPriorityUrgent
        activeRequests[tag] = req

        req.beginAccessingResources { error in
            DispatchQueue.main.async {
                if let error = error {
                    // Drop the request so the next call can retry cleanly.
                    self.activeRequests.removeValue(forKey: tag)
                    call.reject("ODR fetch failed: \(error.localizedDescription)")
                } else {
                    call.resolve()
                }
            }
        }
    }
}
