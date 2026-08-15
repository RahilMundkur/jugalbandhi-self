package com.jugalbandhi.audiopack

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.play.core.assetpacks.AssetPackManager
import com.google.android.play.core.assetpacks.AssetPackManagerFactory
import com.google.android.play.core.assetpacks.AssetPackStateUpdateListener
import com.google.android.play.core.assetpacks.model.AssetPackStatus
import java.io.File

/**
 * Bridges Play Asset Delivery to the WebView.
 *
 * Pack naming convention: the asset-pack module names in app/build.gradle's
 * assetPacks list must match what we look up here. We use:
 *     audio_fr     → French
 *     audio_hi     → Hindi
 *     audio_th     → Thai
 *     audio_es     → Spanish
 *     audio_zh     → Chinese (Simplified)
 *     audio_zh_tw  → Chinese (Traditional)
 *
 * Note the underscore vs hyphen mismatch for Traditional Chinese: the JS
 * lang code is "zh-tw" (hyphen — matches BCP 47 / the on-disk audio file
 * naming, e.g. zh-tw_ch01_p000_female.mp3), but Gradle asset-pack module
 * names can't contain hyphens, so that pack is named "audio_zh_tw"
 * (underscore) in app/build.gradle/settings.gradle. packNameFor() below
 * normalizes hyphens to underscores for the pack-name lookup only; the
 * filename half (getFileUri) must keep the raw hyphenated lang so it
 * matches the actual on-disk mp3 names.
 *
 * Inside each pack the audio files live at the path
 *     assets/audio/{lang}/{lang}_ch{NN}_p{NNN}_{speaker}.mp3
 * which Play extracts to a directory the AssetPackManager reports via
 * getAssetLocation(...).path. From that directory, the MP3 is reachable
 * with a normal File / file:// URL — no Java I/O needed at fetch time.
 */
@CapacitorPlugin(name = "AudioPack")
class AudioPackPlugin : Plugin() {

    private val packManager: AssetPackManager by lazy {
        AssetPackManagerFactory.getInstance(context.applicationContext)
    }

    private fun packNameFor(lang: String): String = "audio_${lang.replace("-", "_")}"

    private fun statusToString(status: Int): String = when (status) {
        AssetPackStatus.COMPLETED   -> "available"
        AssetPackStatus.DOWNLOADING -> "downloading"
        AssetPackStatus.PENDING     -> "downloading"
        AssetPackStatus.TRANSFERRING-> "downloading"
        AssetPackStatus.FAILED      -> "failed"
        AssetPackStatus.NOT_INSTALLED -> "missing"
        AssetPackStatus.CANCELED    -> "missing"
        AssetPackStatus.WAITING_FOR_WIFI -> "downloading"
        AssetPackStatus.UNKNOWN     -> "unknown"
        else                        -> "unknown"
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val lang = call.getString("lang") ?: return call.reject("lang required")
        val packName = packNameFor(lang)

        val state = packManager.getPackStates(listOf(packName))
        state.addOnSuccessListener { result ->
            val ps = result.packStates()[packName]
            val ret = JSObject()
            if (ps == null) {
                // Pack hasn't been registered yet (very first launch). Treat
                // as 'unknown' so JS knows to wait or to call requestPack.
                ret.put("status", "unknown")
            } else {
                ret.put("status", statusToString(ps.status()))
                if (ps.totalBytesToDownload() > 0) {
                    ret.put("bytesDownloaded", ps.bytesDownloaded())
                    ret.put("bytesTotal",      ps.totalBytesToDownload())
                    ret.put("progress",
                            ps.bytesDownloaded().toDouble() /
                            ps.totalBytesToDownload().toDouble())
                }
            }
            call.resolve(ret)
        }.addOnFailureListener { e ->
            val ret = JSObject()
            ret.put("status",  "unknown")
            ret.put("message", e.message ?: "getPackStates failed")
            call.resolve(ret)
        }
    }

    @PluginMethod
    fun getFileUri(call: PluginCall) {
        val lang     = call.getString("lang")      ?: return call.reject("lang required")
        val chapter  = call.getString("chapter")   ?: return call.reject("chapter required")
        val paragraph= call.getString("paragraph") ?: return call.reject("paragraph required")
        val speaker  = call.getString("speaker")   ?: return call.reject("speaker required")
        val packName = packNameFor(lang)

        val location = packManager.getPackLocation(packName)
            ?: return call.reject("Pack '$packName' not installed yet")

        val fname = "${lang}_ch${chapter}_p${paragraph}_${speaker}.mp3"
        // location.assetsPath() points to the assets/ root inside the pack.
        val file = File(location.assetsPath(), "audio/$lang/$fname")
        if (!file.exists()) {
            return call.reject("Audio file not found in pack: ${file.absolutePath}")
        }

        val ret = JSObject()
        ret.put("url",       "file://${file.absolutePath}")
        ret.put("byteSize",  file.length())
        call.resolve(ret)
    }

    // Emits a 'packProgress' JS event so the reader UI can drive a real
    // determinate progress ring (Play Store-style) instead of a generic
    // spinner. Every event carries 'lang' so the JS side can ignore updates
    // for a pack it isn't currently showing progress for.
    private fun emitProgress(lang: String, status: String, bytesDownloaded: Long?, bytesTotal: Long?) {
        val ret = JSObject()
        ret.put("lang", lang)
        ret.put("status", status)
        if (bytesTotal != null && bytesTotal > 0) {
            ret.put("bytesDownloaded", bytesDownloaded ?: 0L)
            ret.put("bytesTotal", bytesTotal)
            ret.put("progress", (bytesDownloaded ?: 0L).toDouble() / bytesTotal.toDouble())
        }
        notifyListeners("packProgress", ret)
    }

    @PluginMethod
    fun requestPack(call: PluginCall) {
        val lang = call.getString("lang") ?: return call.reject("lang required")
        val packName = packNameFor(lang)

        val listener = object : AssetPackStateUpdateListener {
            override fun onStateUpdate(state: com.google.android.play.core.assetpacks.AssetPackState) {
                if (state.name() != packName) return
                when (state.status()) {
                    AssetPackStatus.COMPLETED -> {
                        packManager.unregisterListener(this)
                        emitProgress(lang, "available", state.bytesDownloaded(), state.totalBytesToDownload())
                        call.resolve()
                    }
                    AssetPackStatus.FAILED -> {
                        packManager.unregisterListener(this)
                        call.reject("Pack download failed (errorCode ${state.errorCode()})")
                    }
                    AssetPackStatus.DOWNLOADING, AssetPackStatus.TRANSFERRING -> {
                        emitProgress(lang, "downloading", state.bytesDownloaded(), state.totalBytesToDownload())
                    }
                    else -> { /* PENDING, WAITING_FOR_WIFI, CANCELED, UNKNOWN — no byte count yet */ }
                }
            }
        }
        packManager.registerListener(listener)

        packManager.fetch(listOf(packName))
            .addOnFailureListener { e ->
                packManager.unregisterListener(listener)
                call.reject(e.message ?: "fetch failed")
            }
    }
}
