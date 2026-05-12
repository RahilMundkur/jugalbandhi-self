# Jugalbandhi Self — Performance Report & Runbook

This report has three parts:

1. Static-analysis findings, ranked by likely impact on a budget Android device.
2. How to use the perf overlay I added to `index.html` (it ships disabled).
3. A real-device runbook for Chrome DevTools remote debugging.

The static numbers are based on the patched `index.html` in your APIDeepL folder.

---

## 1. Static analysis

### Headline numbers

| Metric | Value | Notes |
|---|---|---|
| HTML on disk (UTF-8) | 9.06 MB | what gets bundled into the TWA APK |
| HTML char count | 5.28 M chars | what the parser walks |
| HTML gzipped (level 9) | 2.59 MB | what would transfer over the wire |
| Inline `<script>` payload | 4.53 MB | 86% of the HTML |
| `BOOK_DATA` literal | 119 KB | the book itself — small |
| **`TRANSLATIONS` literal** | **4.42 MB** | **35 languages × ~125 KB each** |
| `_BAKED_AUDIO` literal | 2 chars | empty stub (audio ships as packs) |
| `<style>` blocks | 55 KB | reasonable |

**The single biggest finding: `TRANSLATIONS` is 84% of the entire HTML payload and is parsed on every cold start.** Even though the user can only see one language at a time, the WebView eagerly parses all 35 of them before the cover is interactive. On a 4 GB-RAM Android with a slower V8, this is on the order of seconds of pure parse work.

### Per-language size of `TRANSLATIONS`

```
my (Burmese)    153 KB    de (German)     150 KB    fr (French)     146 KB
ta (Tamil)      152 KB    id (Indonesian) 149 KB    vi (Vietnamese) 144 KB
ml (Malayalam)  151 KB    ...                       ...
hi (Hindi)      128 KB    th (Thai)       113 KB    zh (Chinese)     44 KB
```

35 entries totalling 4.42 MB. Roughly 125 KB per language on average for full chapter translations, plus a ~1 KB UI strings block per language.

### Findings, ranked by impact

**1. Lazy-load `TRANSLATIONS` per language.** *(highest impact — ~4× HTML parse-time reduction expected on cold start)*

Today, `const TRANSLATIONS = { ... }` is a single 4.4 MB literal. Replace it with a small loader: a `LANG_INDEX` listing which languages exist, and an `async loadLang(code)` that fetches `translations/<code>.json` on demand and caches it. Keep English UI strings inline (1 KB) so the cover always renders. Net effect:

- HTML drops from 9 MB to roughly 1 MB on disk. Parse time drops proportionally.
- First language switch costs one fetch + parse of ~130 KB instead of zero. That's a one-time visible cost in exchange for a much faster cold start that every user sees.
- The service worker can pre-cache the most-likely languages (English UI is already there; consider precaching the user's device locale).

This is invasive — you'd be splitting one file into 36 — but the build script is straightforward (extract each top-level key to its own file). I'd estimate half a day of work to implement, validate, and update the SW manifest.

**2. `restoreAnnotations()` is O(n × m).** *(medium impact — visible on chapters with many highlights)*

```js
paras.forEach((p, pIdx) => {
  // ...
  chAnnots.filter(a => a.paraIdx === pIdx).forEach(a => { ... });
});
```

`chAnnots.filter(...)` runs once per paragraph. Re-index `chAnnots` by `paraIdx` into a `Map` once, then look up in O(1). Trivial change, ~10 lines, and removes the only superlinear hot path during chapter open.

**3. `buildSidebar()` is called 10 places, with no debouncing.** *(medium impact — chapter transitions feel laggy)*

`openChapter` alone calls it once directly and indirectly via `saveProgress` → `updateCoverContinue`. Each call wipes `list.innerHTML` and rebuilds 40+ DOM nodes. Two cheap fixes:

- Debounce: collapse rapid successive calls into one `requestAnimationFrame` callback.
- Diff: when only the active-chapter highlight or the read-state changes, mutate the existing nodes (`classList.toggle`) rather than rebuilding.

The sidebar isn't visible on mobile during reading anyway, so the rebuild cost is pure waste during chapter transitions.

**4. `42 innerHTML =` writes.** *(low-to-medium impact — reading-flow jank)*

Each `innerHTML` triggers HTML parsing in the WebView. For a long translated chapter the per-paragraph `block.innerHTML = ...` call inside `translatePage()` runs N times. Switching to `block.textContent = ...` plus `appendChild` for the language label would skip the parser. Same applies to `openChapter`'s body assembly — the `.map(...).join('')` then `body.innerHTML = ...` is fine because it batches; the per-paragraph wrappers added in the next `forEach` are the inefficient part.

**5. Sweep animation does layout work every frame.** *(visible on low-end)*

`openChapter` does a `requestAnimationFrame` sweep (1000 px / frame), reading `_sweepBody.scrollHeight` once but applying transforms repeatedly. `will-change: transform` is set and cleared correctly (good), but on a budget device this can still be choppy. Worth a measure on an A14 or Moto G-class device — if it's under 50 fps, consider shortening or skipping it (you already have a `prefers-reduced-motion` path).

**6. Two `setInterval` timers, plus 22 `setTimeout` calls ≥100 ms.** *(low impact — battery / wakelock concern only)*

- SW update poll every 30 minutes.
- Auto-dark check every 5 minutes.
- Two 60-second timers (auto-something cleanup).
- A handful of 5-second timers around the cover auto-scroll.

None are hot loops. The only one I'd revisit is the auto-dark 5-minute interval — could be replaced with a `prefers-color-scheme` media-query listener, which costs nothing and reacts instantly to the user changing system theme.

**7. localStorage is read 26 times and written 24 times.** *(low impact — but synchronous I/O)*

Each `getItem`/`setItem` is synchronous and triggers disk I/O on Android. The 24 writes are mostly bounded (saveProgress, saveAnnotations) and only fire on user actions, so this isn't a real problem — but if you ever profile and see "long task" warnings near save calls, this is the cause. A 50–100 ms debounce on `saveProgress` would help if it shows up.

**8. Translation cache lives in localStorage.** *(potential ceiling)*

If the user translates many chapters, `translation-cache` can fill localStorage's ~5–10 MB quota and silently start failing writes. Worth migrating to IndexedDB (which `_elCache` already uses for audio) — same storage interface, no quota wall, async.

### Things that already look good

- `will-change: transform` is correctly set and cleared around the sweep animation.
- `IntersectionObserver` and `ResizeObserver` are used appropriately.
- Service worker scope and registration are correct.
- Long-press selection-toolbar uses viewport coordinates (after the patch).
- IndexedDB caches decoded audio buffers — never re-decodes on replay.
- Fonts use `font-display: swap` so they don't block first paint.

---

## 2. The perf overlay

I added a hidden, gated overlay to your `index.html`. It's invisible to normal users and ships with the production build, but adds <1 KB of JS that does nothing unless activated.

### Activating it

**On a connected device:** append `?perf=1` to the URL once, e.g. `https://your-twa-host/?perf=1`. The setting persists in localStorage so you don't need to keep the parameter.

**Inside the TWA app (no URL bar):** tap the **top-left 60×60 px corner of the screen 5 times in under 3 seconds**. An alert confirms ON/OFF. Reload to apply.

**To turn it off:** five-tap again, or load `?perf=0`.

### What it shows

A small black tooltip in the bottom-right corner with five rows:

- **FPS** — sampled twice a second from rAF. Goes amber under 50, red under 30.
- **Heap** — `usedJSHeapSize / totalJSHeapSize` (Chromium-only; shows `n/a` on iOS / Firefox). Amber over 120 MB, red over 200 MB.
- **DOM** — total node count. Useful for spotting leaks during long sessions.
- **Long > 50 ms** — count and total ms of long tasks observed since load. Anything > 0 means the main thread blocked.
- **Last mark** — most recent named timing measurement (see below).

### What gets timed automatically

`window.jbMark(name, 'start' | 'end')` calls have been added at four hot paths:

| Mark | Starts | Ends |
|---|---|---|
| `chapter-open` | top of `openChapter` | after `chapter-opened` event dispatched |
| `translate-page` | start of `translatePage` | after final `showToast` |
| `tts-first-audio` | start of `toggleTTS` | when `_playElBuffer` plays the first paragraph (idx === 0) |
| `search` | start of `runSearch` | after results appended to DOM |

All marks log to the console as `[jbMark] <name> <ms>` so they're captured by remote DevTools.

### Suggested target numbers (budget Android device)

| Action | Acceptable | Bad |
|---|---|---|
| `chapter-open` | < 250 ms | > 500 ms |
| `translate-page` (cached) | < 200 ms | > 500 ms |
| `tts-first-audio` (English) | < 800 ms | > 2000 ms |
| `tts-first-audio` (FR/HI/TH local) | < 600 ms | > 1500 ms |
| `search` | < 300 ms | > 800 ms |
| Steady-state FPS | ≥ 55 | < 40 |
| Heap after 30 min Listen | < 120 MB | > 180 MB |

These are reasonable targets for a 4 GB-RAM device on Android 11+.

---

## 3. Real-device runbook (Chrome DevTools remote debugging)

This walks through capturing a proper performance trace on a physical Android device. You'll do this once per device.

### One-time setup

1. **On the Android phone**: Settings → About phone → tap *Build number* seven times to enable developer mode.
2. Settings → System → Developer options → enable **USB debugging**.
3. Plug the phone into your Mac with a USB cable. The phone will prompt to allow USB debugging — accept and tick "always allow".
4. **On the Mac**: open Chrome, navigate to `chrome://inspect/#devices`. The phone's name should appear, and below it any open Chrome tab and any TWA WebView.
5. If you don't see anything: install the [Android platform-tools](https://developer.android.com/tools/releases/platform-tools), run `adb devices` in Terminal, accept the device once. Reload `chrome://inspect`.

### Capturing a cold-start trace

1. Force-stop the app (Settings → Apps → Jugalbandhi Self → Force stop). This guarantees a real cold launch, not a resume.
2. In `chrome://inspect`, find the WebView entry for the app (it'll appear once you launch it — keep refreshing the page).
3. Tap the app icon on the phone.
4. The moment the WebView entry appears in `chrome://inspect`, click **inspect** next to it. A DevTools window opens. The cover screen will be loading at this point.
5. In DevTools: open **Performance** tab → click the gear icon → check "CPU: 4× slowdown" if you want to simulate budget hardware on a flagship; for a real budget device leave it off. Set **Network: No throttling** for cold start (it's already cold).
6. Click the round record button → wait for the cover to be interactive → click stop.
7. Read the flame chart. Look for:
   - **Long yellow "Parse HTML" or "Compile script" bands** at the start. The current 5 MB inline JS will dominate here.
   - **A long "Evaluate Script" bar** — this is the parse + first execution of `TRANSLATIONS`.
   - **First Contentful Paint** marker — should be < 1.5 s on a flagship, < 3 s on budget.

### Capturing a chapter-open trace

1. With DevTools already attached, navigate to the cover.
2. In DevTools Performance tab, start recording.
3. Tap a chapter.
4. Stop recording after the chapter is fully on screen (about 2 seconds).
5. Look at the **Main** thread track for long tasks (red triangles). Filter by "User Timing" in the Summary panel — your `chapter-open` measure should appear there with its duration.

### Capturing a long-session memory profile

This is the test for leaks during a 30-minute Listen session.

1. DevTools → **Memory** tab → choose **Heap snapshot** → click "Take snapshot". Note the size.
2. Start TTS in any language. Let it run for 5 minutes.
3. Take another snapshot. Compare with the first using the dropdown ("Comparison"). Look for high "Delta" rows.
4. Let TTS run another 25 minutes (skip chapters as needed). Take a final snapshot.
5. If the heap grows linearly with playback time, something is leaking. Common culprits in this codebase to check first: detached event listeners on para elements, accumulated `AudioBuffer`s in the IndexedDB cache (these should be on disk, not in memory — but the in-flight buffer count is worth verifying), and the `chapterScrollListener` / `tts-reading` class accumulators.

The perf overlay's DOM and Heap counters give you the same signal in real time without needing to take snapshots — useful for finding *when* a leak starts, then DevTools Memory tab tells you *what*.

### Capturing scroll/jank

1. Open a long chapter. Wait for it to settle.
2. DevTools → Performance → record.
3. Scroll smoothly from top to bottom over ~3 seconds.
4. Stop recording.
5. The **Frames** track shows green / yellow / red boxes per frame. Any red is a dropped frame. Hover for the cause (usually "Recalculate Style" or "Layout").
6. The perf overlay's FPS readout should match what DevTools reports.

### Reading network for the asset packs

Once Play has installed the FR/HI/TH packs, the audio fetches are local — they should never appear in the Network tab. If they do appear with a network URL, your asset-pack manifest is misconfigured and the audio is being served remotely. The Network tab is the simplest way to verify this.

---

## How I'd prioritize the fixes

If you have one afternoon:

1. Index annotations by paraIdx in `restoreAnnotations` (15 min).
2. Debounce `buildSidebar` (15 min).
3. Replace localStorage translation cache with IndexedDB (60 min).

If you have a day on top of that:

4. Lazy-load `TRANSLATIONS` per language. This is the biggest cold-start win. Half a day of refactoring + a build script + SW updates.

If you have a week:

5. Move BOOK_DATA out of the inline script too — fetch it from `book.json` on demand. Combined with #4, the HTML drops to ~600 KB and parse becomes near-instantaneous.

The first three are safe, surgical, easy to roll back. The fourth is the one that meaningfully changes the cold-start experience on budget Android — worth doing before the public launch if you can spare the time.
