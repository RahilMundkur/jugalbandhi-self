# Wiring the AudioPack plugin into `index.html`

The `index.html` in the parent folder already contains the wiring described
here. This file documents what's there and how to verify it.

## What the plugin enables

- `Capacitor.Plugins.AudioPack.getStatus({ lang })` — returns `'available' |
  'missing' | 'downloading' | 'failed' | 'unknown'`.
- `Capacitor.Plugins.AudioPack.getFileUri({ lang, chapter, paragraph, speaker })`
  — returns a `file://` URL the WebView can fetch (Android) or the bundle URL
  for the matching ODR resource (iOS).
- `Capacitor.Plugins.AudioPack.requestPack({ lang })` — explicitly fetches an
  on-demand pack. Resolves on completion, rejects on failure.

## How `index.html` uses them

1. **`_probeAudioPack(lang)`** — calls `AudioPack.getStatus` when running
   under Capacitor; falls back to a HEAD/range fetch in plain browsers.
2. **`_resolveAudioUrl(lang, ch, p, speaker)`** — calls `AudioPack.getFileUri`
   when running under Capacitor; returns a relative path otherwise. The
   TTS engine awaits this in `_speakElevenLabs` instead of building the URL
   inline, so the same code path works in both runtimes.
3. **`downloadAudioPack()`** — wired to the visible "Download {Lang} audio"
   button next to Listen. Calls `AudioPack.requestPack(lang)` when running
   under Capacitor; in plain browsers, just confirms the file is reachable
   (since there's nothing to "fetch from a pack" outside the native shell).
4. **`_updateAudioPackButton()`** — refreshes the button's visibility and
   label based on `_audioPackState[lang]`. Called on language change, on
   DOMContentLoaded, and after every download attempt.
5. **`_showAudioPackMissingModal(lang)`** — same modal the missing-pack
   path used before, but its primary action is now "Download now" which
   calls `downloadAudioPack()`. The "Listen in English" shortcut is still
   there as a fallback.

## How the user-visible flow looks

1. User installs the app — base APK only, no audio packs (~5 MB on disk).
2. English audio is bundled and works immediately.
3. User switches to French via the language picker.
4. The picker badge says "Audio downloading…" (which now means
   "not yet downloaded"). The reader toolbar shows a "Download French
   audio (~40 MB)" button next to Listen.
5. User taps Listen anyway. The missing-pack modal appears with
   "Download now" and "Listen in English" buttons. They tap "Download now".
6. The plugin calls `assetPackManager.fetch` (Android) or
   `beginAccessingResources` (iOS). The button shows a spinner and
   "Downloading…" while the platform fetches.
7. When the fetch completes, the button hides, a toast says
   "French audio ready — tap Listen.", and the picker badge updates to
   "Audio ready" if the picker is open.
8. User taps Listen — audio plays.

## Verifying the wiring

After `npx cap sync`, run on Android:

```bash
adb logcat -s chromium
# Then in the app: switch to French.
# You should see the Download button appear next to Listen.
# Tap Download. You should see:
#   [audio-pack] download succeeded
# Tap Listen. You should hear French audio. The console shows:
#   [jbMark] tts-first-audio NNNms
```

On iOS, watch the Xcode console for the same log lines.

## Failure modes you can test

1. **Plain browser** (`open www/index.html`): no Capacitor present. The
   button still appears for FR/HI/TH; tapping it does a HEAD fetch on the
   canary file. If audio files are physically in `www/audio/{lang}/`, the
   download "succeeds" trivially (the relative-path fetch already worked).
2. **Android base-only install** (without the on-demand pack): `getStatus`
   returns 'missing'. Button visible. Tap → `requestPack` triggers Play to
   fetch. With `bundletool --local-testing` the fetch is local, completes
   in seconds.
3. **Android with no network**: `requestPack` rejects after the platform
   timeout. Button reverts to "Download failed — retry".
4. **iOS simulator**: ODR resources are present in the simulator regardless
   of tag mode, so the request resolves immediately. For realistic
   on-the-wire ODR testing, use TestFlight on a physical device.
5. **iOS device with airplane mode**: `beginAccessingResources` rejects.
   Button reverts to retry state.
