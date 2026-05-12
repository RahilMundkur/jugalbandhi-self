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
        if let _ = Bundle.main.url(forResource: canaryFilename(lang), withExtension: "mp3") {
            call.resolve(["status": "available"])
            return
        }

        // Not on disk — kick off a request and report status. We don't
        // beginAccessingResources here (that downloads); we use
        // conditionallyBeginAccessing to peek.
        let req = activeRequests[tag] ?? NSBundleResourceRequest(tags: [tag])
        activeRequests[tag] = req

        req.conditionallyBeginAccessingResources { available in
            DispatchQueue.main.async {
                if available {
                    call.resolve(["status": "available"])
                } else {
                    // iOS doesn't directly expose "downloading vs missing"
                    // for an idle request; report "missing" and let JS call
                    // requestPack to actually fetch.
                    call.resolve(["status": "missing"])
                }
            }
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

        let req = activeRequests[tag] ?? NSBundleResourceRequest(tags: [tag])
        activeRequests[tag] = req
        req.loadingPriority = NSBundleResourceRequestLoadingPriorityUrgent

        req.beginAccessingResources { error in
            DispatchQueue.main.async {
                if let error = error {
                    call.reject("ODR fetch failed: \(error.localizedDescription)")
                } else {
                    call.resolve()
                }
            }
        }
    }
}
