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
 *     audio_fr   → French
 *     audio_hi   → Hindi
 *     audio_th   → Thai
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

    private fun packNameFor(lang: String): String = "audio_$lang"

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
                        call.resolve()
                    }
                    AssetPackStatus.FAILED -> {
                        packManager.unregisterListener(this)
                        call.reject("Pack download failed (errorCode ${state.errorCode()})")
                    }
                    else -> { /* ignore intermediate */ }
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
