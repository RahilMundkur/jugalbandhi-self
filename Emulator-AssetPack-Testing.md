# Testing FR/HI/TH asset packs on the Android emulator

Your goal is to verify that the audio packs for French, Hindi, and Thai download and resolve correctly. There are two paths — pick based on whether you're iterating or doing a final pre-launch check.

| Path | Speed | Realism | When to use |
|---|---|---|---|
| **A. bundletool `--local-testing`** | Fast (~1 min per cycle) | High — uses real Play Asset Delivery library | Iterating on pack config or app code |
| **B. Play Console internal testing track** | Slow (~30 min per upload) | Exact production flow | Final validation before public launch |

I recommend Path A first to shake out config bugs, then one Path B run before you promote to the closed/open testing tracks.

---

## Prerequisites (one-time)

### 1. Android Studio + emulator

If you don't have it: [download Android Studio](https://developer.android.com/studio). Open it once to let it install the SDK.

### 2. Create an emulator with the Play Store

Asset-pack delivery only works on emulators that have the actual Play Store, not just Google APIs.

In Android Studio: **Tools → Device Manager → Create Device**. Pick a Pixel device. On the System Image step, look for an image that has the **Play Store icon** in the column on the right. The label will read something like:

> `Tiramisu  Android 13.0  Google Play`

Do **not** pick the "Google APIs" image — it has no Play Store. Recommended specs:

- **Pixel 6** or **Pixel 6a** as the device profile (representative of mid-range hardware).
- **API 33** or **API 34** image (modern Android, current WebView).
- **Internal storage**: at least 4 GB. Audio packs are large.
- **RAM**: 2 GB is fine for testing; 4 GB is more representative.

On Apple Silicon Macs, prefer ARM64 images for speed (`Tiramisu | Google Play | arm64`).

### 3. Install bundletool

```bash
brew install bundletool
# or download from https://github.com/google/bundletool/releases
```

Verify: `bundletool version`.

### 4. Confirm `adb` is on your PATH

```bash
adb version
# If "command not found":
export PATH="$PATH:$HOME/Library/Android/sdk/platform-tools"
```

Add that `export` line to `~/.zshrc` so it persists.

### 5. Find your AAB

You said you have one already. Confirm the path before you start, e.g.:

```bash
ls -lh /path/to/jugalbandhi-self.aab
```

If it's signed with a debug key, that's fine for emulator testing. For Path B you'll need a release-signed bundle.

---

## Path A — bundletool `--local-testing` (recommended)

This path simulates Play's asset-pack delivery against a connected emulator without uploading anywhere. The asset packs are extracted onto the emulator's filesystem just as Play would extract them.

### Step 1: Boot the emulator

In Android Studio Device Manager, click the play (▶) icon next to your Play-enabled AVD. Wait for the home screen.

```bash
# Confirm the emulator is connected
adb devices
# Should list:  emulator-5554   device
```

### Step 2: Generate `.apks` from the AAB with local-testing mode

```bash
cd /Users/rahilmundkur/Documents/JUGALBANDHI/Translations/APIDeepL

bundletool build-apks \
  --bundle=/path/to/jugalbandhi-self.aab \
  --output=/tmp/jb.apks \
  --local-testing \
  --connected-device
```

Notes:
- `--local-testing` rewrites manifest entries so the app uses local pack delivery instead of trying to call the real Play API.
- `--connected-device` makes bundletool generate only the splits relevant to the running emulator (faster, smaller).
- If your AAB is unsigned and bundletool refuses, add `--ks=… --ks-key-alias=… --ks-pass=pass:…` with your signing config, or sign with the Android debug key.

### Step 3: Install on the emulator

```bash
bundletool install-apks --apks=/tmp/jb.apks
```

This installs the base APK plus all install-time and fast-follow asset packs. On-demand packs are extracted to the local filesystem and become available when the app calls the asset-pack API (or, in your case, when the WebView fetches their files).

### Step 4: Open the app and turn on the perf overlay

1. Tap the app icon. Cover screen appears.
2. Activate the perf overlay: tap the top-left 60×60 px corner of the screen 5 times within 3 seconds. An alert says "ON". Reload (force-stop and reopen, or pull to refresh if you've added that).
3. Confirm the overlay appears bottom-right with FPS, heap, etc.

### Step 5: Verify each pack

Open the language picker. The badges should transition:

- **English** — no badge (audio is baked in).
- **French** — badge shows "Checking…" then "Audio ready".
- **Hindi** — same.
- **Thai** — same.

If any badge stays on "Audio downloading…" forever, the pack didn't install. Check `bundletool` output for warnings, or run `adb shell ls /data/app/...` to confirm pack files landed.

For each language, switch to it and tap **Listen**:

- Audio plays from paragraph 1. The active paragraph highlights.
- The perf overlay's `Last mark` row shows `tts-first-audio <ms>`. On the emulator this should be under 1 second; if it's 3+ seconds the pack files are being read from a slow path or are missing.

### Step 6: Test the missing-pack path

The whole point of the modal I added is to handle the case where a pack hasn't arrived yet. You can simulate it on the emulator:

```bash
# Find the package name (usually com.something.jugalbandhi)
adb shell pm list packages | grep -i jugal
# Clear app data — does not remove asset packs but resets app state
adb shell pm clear com.your.package.name
# OR uninstall + reinstall WITHOUT --local-testing to reproduce a "no packs" state
bundletool build-apks --bundle=/path/to/aab --output=/tmp/jb-base-only.apks --connected-device
bundletool install-apks --apks=/tmp/jb-base-only.apks
```

After the no-packs install, opening the app and tapping Listen on French/Hindi/Thai should produce the **"Audio not yet available" modal** with a "Listen in English" shortcut. If you see anything else (silent failure, repeated toasts, blank screen), that's a regression in the patch.

### Step 7: Capture a Chrome DevTools trace of the WebView

Asset packs are great, but the in-app perf is what users feel. To inspect:

1. On the host Mac, open Chrome → `chrome://inspect/#devices`.
2. With the app running on the emulator, the WebView should appear. Click **inspect**.
3. DevTools opens, attached to the WebView. From here you can profile, view console output (`[jbMark]` logs included), and watch network activity.

Audio fetches for FR/HI/TH should show as **local** requests in the Network tab, not remote URLs. If they appear with `https://` hosts, your pack manifest is misconfigured.

---

## Path B — Play Console internal testing track

Use this once you've validated everything via Path A and want one final realistic pass before promoting to closed/open testing.

### Step 1: Upload the AAB

1. Open [Play Console](https://play.google.com/console).
2. Your app → **Testing → Internal testing → Create new release**.
3. Upload the AAB. Wait for processing (15–30 minutes typically; can be longer on first upload).
4. Add release notes (mandatory) — even just "internal test build".
5. Click **Save**, then **Review release**, then **Start rollout to internal testing**.

### Step 2: Add yourself as a tester

In the Internal testing page → **Testers** tab:

- Create an email list, add your Google account (the same one signed into the emulator's Play Store).
- Save.
- Copy the **opt-in URL** at the bottom of the page (it'll look like `https://play.google.com/apps/internaltest?id=com.your.package`).

### Step 3: Install via Play Store on the emulator

1. On the emulator, sign in to Play Store with the tester account if you haven't already.
2. Open Chrome on the emulator (or send the URL to it via `adb shell am start -a android.intent.action.VIEW -d "https://..."`).
3. Visit the opt-in URL. Tap **Become a tester** if prompted.
4. The page redirects to the Play Store listing for the app. Tap **Install**.
5. After install, packs download in the background. The app icon appears once the base APK is in.

### Step 4: Verify pack download timing

This is the production flow. Time roughly how long after install the FR/HI/TH packs become available. Things to check:

- Open the app immediately after install completes. Language picker badges may show "Audio downloading…" briefly.
- Wait 1–2 minutes on WiFi. Reopen the picker. Badges should now read "Audio ready".
- Switch to French and Listen. Audio plays.

If a pack stays "downloading" for more than 5 minutes on a strong connection, dig into Play Console → **App bundle explorer** → check that all four packs (or three, since EN is bundled) are present and configured with the right delivery mode.

### Step 5: Pre-launch report

When you upload an AAB to internal testing, Play Console automatically runs a [Pre-launch report](https://play.google.com/console/about/pre-launch-reports/). It's free testing on real devices in Google's farm. Check it for:

- Crashes or ANRs.
- Accessibility scan results.
- Performance issues across device tiers.
- Security warnings.

Reports usually appear within a few hours of upload.

---

## Common gotchas

**"App can't be installed" on the emulator.** Almost always a signing or ABI mismatch. Confirm the AAB targets `arm64-v8a` if you're on Apple Silicon, or `x86_64` for Intel.

**Asset packs don't appear after `bundletool install-apks`.** Make sure you used `--local-testing`. Without it, the app calls the real Play API and gets nothing on a non-Play install.

**Internal testers can't see the app on Play Store.** Two common causes: (1) the email isn't in the testers list, or (2) the device's primary Google account isn't the tester account. The opt-in URL also takes a few minutes to activate after the first rollout.

**Chrome DevTools doesn't show the WebView.** The TWA's WebView is only inspectable when the app is signed with a debuggable key. If you're testing a release-signed build, debug-attach won't work — switch to a debug-signed build for DevTools work, then re-sign for final validation.

**Emulator runs out of storage during pack install.** Default AVD storage is 6 GB but Android's filesystem overhead eats a lot. Edit the AVD in Device Manager → Show Advanced Settings → bump Internal Storage to 8 GB.

**`adb devices` shows "unauthorized".** First time only — accept the prompt on the emulator's screen.

**`bundletool build-apks` is slow.** Expected — it's effectively splitting the AAB and signing each split. With `--connected-device` it's much faster because it only generates what your specific emulator needs.

**Live-debugging asset-pack-related JS code.** Once Chrome DevTools is attached, you can call `await window._probeAudioPack('fr')` from the console and it returns `'available'` or `'missing'`. Useful for confirming the probe works without tapping through the UI.

---

## Quick reference

```bash
# Boot AVD from CLI (avoid Studio)
~/Library/Android/sdk/emulator/emulator -avd Pixel_6_API_33 -wipe-data &

# Confirm connected
adb devices

# Install with packs (fast iteration)
bundletool build-apks \
  --bundle=$AAB --output=/tmp/jb.apks \
  --local-testing --connected-device
bundletool install-apks --apks=/tmp/jb.apks

# Open WebView in Chrome DevTools
open -a "Google Chrome" "chrome://inspect/#devices"

# Confirm pack canary file is on device
adb shell run-as com.your.package ls /data/data/com.your.package/files/audio/fr/ 2>/dev/null \
  || echo "Asset packs are usually under /data/app or /data/asset-packs — exact path depends on delivery mode"

# Force-clear app state (resets reading position, annotations, perf overlay)
adb shell pm clear com.your.package.name

# Tail JS console output from the WebView
adb logcat -s chromium
```

The `adb logcat -s chromium` line is genuinely useful — it shows `[jbMark] chapter-open 240ms` and `[jb-perf] cold-start {...}` from the perf overlay live as you use the app, even without Chrome DevTools attached.
