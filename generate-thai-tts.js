/**
 * generate-thai-tts.js — Regenerate Thai narration audio for the whole book
 * using Google Cloud's Gemini 3.1 Flash TTS (preview), respecting the same
 * per-paragraph speaker-turn segmentation the app already uses live for
 * Thai "Listen" playback (see tts-units.js — ported from reader.html's own
 * _getParas()/_detectSpeaker()/_SPEAKER_OVERRIDE, validated against the
 * existing audio/th file set: 285/286 files matched exactly).
 *
 * Voices: Zephyr (female / Vidya), Umbriel (male / Ishwar, also narrator).
 *
 * Requirements:
 *   - Node.js 18+ (built-in fetch — no npm packages needed)
 *   - gcloud CLI installed and authenticated:
 *       gcloud auth application-default login
 *   - The Cloud Text-to-Speech API enabled on your Google Cloud project
 *
 * Usage:
 *   node generate-thai-tts.js --dry-run                 # preview only, no API calls, no cost
 *   node generate-thai-tts.js --chapter 9                # generate just one chapter
 *   node generate-thai-tts.js --chapters 4,7,11,24-32     # generate a specific list/range of chapters
 *   node generate-thai-tts.js --chapter 24 --unit 10 --force   # regenerate just one segment (unit index
 *                                                                10 = the "p010" in th_ch24_p010_female.mp3)
 *   node generate-thai-tts.js --chapter 24 --unit 4,7,23-25 --force  # a list/range of units, same syntax as --chapters
 *   node generate-thai-tts.js                             # generate everything (skips existing files)
 *   node generate-thai-tts.js --force                     # regenerate everything, overwriting existing files
 *   node generate-thai-tts.js --project YOUR_PROJECT_ID   # override project (defaults to 'jugalbandhi-self')
 *
 * Safe to re-run — skips any file that already exists in audio/th unless
 * --force is passed, so an interrupted run (network error, quota, etc.) can
 * just be re-run to pick up where it left off. NOTE: because every file in
 * audio/th already existed before this script was ever used (the original
 * full-book generation), "already exists" does NOT distinguish freshly
 * regenerated files from old ones — use --chapters/--chapter (optionally
 * narrowed further with --unit) with --force to explicitly redo specific
 * chapters/segments rather than relying on skip-if-exists to find gaps left
 * by a partial/failed run.
 *
 * --unit filters by TTS UNIT INDEX (the zero-based "pNNN" number in the
 * output filename), not the paragraph index in BOOK_DATA — these can differ
 * because consecutive same-speaker paragraphs get merged into one unit (see
 * tts-units.js). Run --dry-run first if you're not sure which unit number
 * corresponds to the segment you want. --unit requires --chapter or
 * --chapters, since unit numbering restarts from 0 in every chapter.
 *
 * Segments longer than ~3800 UTF-8 bytes (Gemini-TTS's real per-request
 * input.text limit — Thai runs ~3 bytes/char, so this is roughly 1250-1300
 * Thai characters) are automatically split at the nearest safe boundary,
 * synthesized as separate requests, and stitched back into the one expected
 * output file with a short ffmpeg crossfade at each seam (requires ffmpeg on
 * PATH — falls back to raw concatenation if it's not found) — the
 * file-per-speaker-turn structure doesn't change.
 *
 * The gcloud access token is re-fetched before every request (tokens expire
 * after ~1 hour, which a single long run can easily exceed).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { getChapterTTSUnits, getMood } = require('./tts-units.js');

const ROOT = __dirname;
const HTML_FILE = path.join(ROOT, 'reader.html');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const PROJECT_ID = getArg('project', process.env.GOOGLE_CLOUD_PROJECT || 'jugalbandhi-self');
const ONLY_CHAPTER = getArg('chapter', null);
const CHAPTERS_ARG = getArg('chapters', null); // e.g. "4,7,11,24-32"
const UNIT_ARG = getArg('unit', null); // e.g. "10" or "4,7" or "10-12" — TTS unit index (the "pNNN" in the output filename), NOT the paragraph index in BOOK_DATA. Requires --chapter/--chapters.
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');
const MODEL = 'gemini-3.1-flash-tts-preview';
const REQUEST_DELAY_MS = 1200; // gentle pacing to avoid rate limits
const MAX_RETRIES = 3;
// Gemini-TTS's real limit for input.text is 4,000 UTF-8 bytes (this applies
// to single-speaker requests too, not just the documented multi-speaker
// case). Chunking below this with margin for encoding overhead.
const MAX_TEXT_BYTES = 3800;

function parseChapterSelector(selector) {
  if (!selector) return null;
  const set = new Set();
  selector.split(',').forEach(part => {
    part = part.trim();
    if (!part) return;
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(n => parseInt(n, 10));
      for (let n = a; n <= b; n++) set.add(n);
    } else {
      set.add(parseInt(part, 10));
    }
  });
  return set;
}
const CHAPTER_SET = parseChapterSelector(CHAPTERS_ARG);
const UNIT_SET = parseChapterSelector(UNIT_ARG); // same list/range syntax works for unit indices

if (UNIT_SET && !ONLY_CHAPTER && !CHAPTER_SET) {
  console.error('--unit requires --chapter (or --chapters) to also be specified — unit indices are only meaningful within a specific chapter (they\'re the "pNNN" number in the output filename, which restarts from 0 in every chapter).');
  process.exit(1);
}

// Base styling instruction sent as the TTS "prompt" field alongside each
// segment's text. Edit this if the default delivery doesn't match what
// you're after — it's applied to every request regardless of speaker.
// getMood()/_MOOD_MAP hints ARE applied, via buildPrompt() below, which
// appends a natural-language tone instruction derived from the bracketed
// mood hint (e.g. '[hushed, epiphanic]') onto this base prompt. This is the
// Gemini TTS API's legitimate silent style-steering input field — text sent
// here shapes delivery but is never spoken aloud, unlike the old bug where
// mood hints were prepended directly onto the spoken `text` itself and got
// read out as literal words.
const STYLE_PROMPT = 'Narrate the following in a warm, natural, reflective spoken-word style, as part of an audiobook.';

// Turns a bracketed mood hint like '[hushed, epiphanic]' into a natural-
// language tone instruction appended to STYLE_PROMPT, e.g. 'Deliver this
// line with a hushed, epiphanic tone.' Returns STYLE_PROMPT unchanged if
// there's no mood hint for this unit.
function buildPrompt(mood) {
  if (!mood) return STYLE_PROMPT;
  const words = mood.replace(/^\[|\]$/g, '').trim();
  if (!words) return STYLE_PROMPT;
  return `${STYLE_PROMPT} Deliver this line with a ${words} tone.`;
}

const VOICE_FOR_SPEAKER = {
  female: 'Zephyr',    // Vidya
  male: 'Umbriel',     // Ishwar
  narrator: 'Umbriel'  // Ishwar also narrates
};

// The project's established 4-copy sync convention, adapted for audio files.
const AUDIO_DESTS = [
  path.join(ROOT, 'audio', 'th'),
  path.join(ROOT, 'capacitor-project', 'audio-packs-android', 'audio_th', 'src', 'main', 'assets', 'audio', 'th'),
  path.join(ROOT, 'capacitor-project', 'ios', 'App', 'th'),
];

function getAccessToken() {
  return execSync('gcloud auth application-default print-access-token', { encoding: 'utf8' }).trim();
}

function extractFromHTML(html) {
  const bookMatch = html.match(/const BOOK_DATA = (\[[\s\S]*?\]);[\s\n]*(?=const|\/\/|<)/);
  if (!bookMatch) throw new Error('Could not find BOOK_DATA in reader.html');
  const bookData = JSON.parse(bookMatch[1]);
  const transMatch = html.match(/const TRANSLATIONS = (\{[\s\S]*?\});[\s\n]*(?=const|\/\/|<)/);
  const translations = transMatch ? JSON.parse(transMatch[1]) : {};
  return { bookData, translations };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Splits text into chunks each safely under maxBytes (measured as actual
// UTF-8 byte length, not JS string .length — Thai runs ~3 bytes/char, so
// character count alone is misleading). Snaps to the nearest preceding
// space when one exists within the chunk, to avoid cutting mid-word.
function splitIntoByteSafeChunks(text, maxBytes) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (Buffer.byteLength(remaining, 'utf8') <= maxBytes) {
      chunks.push(remaining);
      break;
    }
    // Binary-search-ish: find the longest prefix (in characters) whose UTF-8
    // byte length is still <= maxBytes.
    let lo = 1, hi = remaining.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (Buffer.byteLength(remaining.slice(0, mid), 'utf8') <= maxBytes) lo = mid;
      else hi = mid - 1;
    }
    let cut = lo;
    // Prefer cutting at the last space within this prefix, if one exists
    // reasonably close to the end (avoids splitting mid-word).
    const lastSpace = remaining.lastIndexOf(' ', cut);
    if (lastSpace > cut * 0.5) cut = lastSpace + 1;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  return chunks.filter(c => c.length > 0);
}

async function synthesizeChunk(text, speaker, prompt, attemptRefreshToken) {
  const voiceName = VOICE_FOR_SPEAKER[speaker];
  const body = {
    input: { text, prompt },
    voice: { languageCode: 'th-TH', name: voiceName, model_name: MODEL },
    audioConfig: { audioEncoding: 'MP3' }
  };
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const accessToken = attemptRefreshToken();
      const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-goog-user-project': PROJECT_ID,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
      }
      const json = await res.json();
      if (!json.audioContent) throw new Error('No audioContent in response');
      return Buffer.from(json.audioContent, 'base64');
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES) await sleep(2000 * attempt);
    }
  }
  throw lastErr;
}

// Multi-chunk segments used to be joined with a plain Buffer.concat of the
// independently-synthesized MP3 streams. That plays back fine technically,
// but each chunk is a separate TTS call, so loudness/tone can shift slightly
// request to request — leaving an audible seam right at the join. Below,
// stitchWithCrossfade() re-joins chunks through a brief ffmpeg acrossfade
// instead, which blends across each seam rather than butting the two clips
// together. Falls back to raw concatenation if ffmpeg isn't installed.
//
// The crossfade alone only blends the waveform/amplitude at the seam — it
// doesn't fix a chunk that's simply louder, quieter, or perceptibly
// "clearer" than its neighbor throughout its own duration (observed on a
// 3-chunk ch4 segment, confirmed by timing the seam against the byte-split
// boundaries). Each chunk is now loudness-normalized (ffmpeg loudnorm, single
// pass) to a common target BEFORE crossfading, so the two clips match in
// level going into the blend rather than just at the blend itself.
const CROSSFADE_MS = 200; // short enough to not blur adjacent words, long enough to smooth a level/tone jump
const LOUDNORM_ARGS = 'loudnorm=I=-16:TP=-1.5:LRA=11'; // spoken-word/audiobook-style target

let _ffmpegChecked = false, _ffmpegAvailable = false;
function hasFfmpeg() {
  if (_ffmpegChecked) return _ffmpegAvailable;
  _ffmpegChecked = true;
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    _ffmpegAvailable = true;
  } catch (e) {
    _ffmpegAvailable = false;
  }
  return _ffmpegAvailable;
}

function stitchWithCrossfade(buffers) {
  if (buffers.length === 1) return buffers[0];
  if (!hasFfmpeg()) {
    console.warn('\n    (ffmpeg not found — falling back to raw concatenation for this multi-chunk segment; install ffmpeg for smoother seams)');
    return Buffer.concat(buffers);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jb-tts-'));
  try {
    const inputFiles = buffers.map((buf, i) => {
      const p = path.join(tmpDir, `chunk${i}.mp3`);
      fs.writeFileSync(p, buf);
      return p;
    });
    const outFile = path.join(tmpDir, 'out.mp3');
    const d = (CROSSFADE_MS / 1000).toFixed(3);

    const inputArgs = [];
    inputFiles.forEach(f => inputArgs.push('-i', f));

    let filter = '';
    // Normalize each chunk's loudness first, so any level/clarity mismatch
    // between separate TTS calls is evened out before the chunks are joined
    // — not just smoothed over at the crossfade seam itself.
    inputFiles.forEach((_, i) => {
      filter += `[${i}:a]${LOUDNORM_ARGS}[n${i}];`;
    });
    let prevLabel = 'n0';
    for (let i = 1; i < inputFiles.length; i++) {
      const outLabel = i === inputFiles.length - 1 ? 'out' : `a${i}`;
      filter += `[${prevLabel}][n${i}]acrossfade=d=${d}:c1=tri:c2=tri[${outLabel}];`;
      prevLabel = outLabel;
    }
    filter = filter.replace(/;$/, '');

    const ffArgs = [...inputArgs, '-filter_complex', filter, '-map', '[out]', '-y', outFile];
    const result = spawnSync('ffmpeg', ffArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    if (result.status !== 0 || !fs.existsSync(outFile)) {
      const errMsg = result.stderr ? result.stderr.toString().slice(0, 200) : 'unknown error';
      console.warn(`\n    (ffmpeg crossfade failed — falling back to raw concatenation: ${errMsg})`);
      return Buffer.concat(buffers);
    }
    return fs.readFileSync(outFile);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Synthesizes a full segment, transparently splitting it into byte-safe
// chunks if it's too long for a single request, and stitching the results
// back into one file with a short crossfade at each seam (see above).
async function synthesizeSegment(text, speaker, prompt, getFreshToken) {
  const chunks = splitIntoByteSafeChunks(text, MAX_TEXT_BYTES);
  const buffers = [];
  for (const chunk of chunks) {
    buffers.push(await synthesizeChunk(chunk, speaker, prompt, getFreshToken));
    if (chunks.length > 1) await sleep(REQUEST_DELAY_MS);
  }
  return { audio: stitchWithCrossfade(buffers), chunkCount: chunks.length };
}

async function main() {
  console.log(`\nThai TTS generator — model ${MODEL}, project ${PROJECT_ID}`);
  console.log(`Voices: female/Vidya = Zephyr, male+narrator/Ishwar = Umbriel`);
  if (DRY_RUN) console.log('(dry run — no API calls, no files written, no cost)\n');
  else console.log('');

  const html = fs.readFileSync(HTML_FILE, 'utf8');
  const { bookData, translations } = extractFromHTML(html);
  const thChapters = (translations.th && translations.th.chapters) || {};

  // Fetched fresh before every request rather than once here — access
  // tokens expire after ~1 hour, which a full-book run can exceed.
  const getFreshToken = () => getAccessToken();
  if (!DRY_RUN) {
    try {
      getFreshToken();
    } catch (e) {
      console.error('Failed to get an access token. Run this first:\n  gcloud auth application-default login\n');
      process.exit(1);
    }
    AUDIO_DESTS.forEach(dir => fs.mkdirSync(dir, { recursive: true }));
  }

  let totalUnits = 0, generated = 0, skipped = 0, errors = 0;
  const errorList = [];

  for (const ch of bookData) {
    if (!ch.num) continue; // skip front/back matter entries
    if (ONLY_CHAPTER && String(ch.num) !== String(ONLY_CHAPTER)) continue;
    if (CHAPTER_SET && !CHAPTER_SET.has(ch.num)) continue;

    const transObj = thChapters[String(ch.num)] || {};
    const units = getChapterTTSUnits(ch.num, ch.paragraphs, transObj);
    if (units.length === 0) continue;

    console.log(`Chapter ${ch.num} "${ch.title || ''}" — ${units.length} segments`);

    for (let i = 0; i < units.length; i++) {
      if (UNIT_SET && !UNIT_SET.has(i)) continue;
      totalUnits++;
      const u = units[i];
      const pStr = String(i).padStart(3, '0');
      const chStr = String(ch.num).padStart(2, '0');
      const fname = `th_ch${chStr}_p${pStr}_${u.speaker}.mp3`;
      const primaryDest = path.join(AUDIO_DESTS[0], fname);

      if (!FORCE && !DRY_RUN && fs.existsSync(primaryDest)) {
        skipped++;
        continue;
      }

      // getMood() hints are routed into the request's silent `prompt` field
      // (via buildPrompt(), see above) rather than into the spoken `text` —
      // this steers delivery without ever being read aloud.
      const mood = getMood(ch.num, i);
      const prompt = buildPrompt(mood);
      const ttsText = u.text;
      const byteLen = Buffer.byteLength(ttsText, 'utf8');
      process.stdout.write(`  ${fname} (${u.speaker}, ${ttsText.length} chars / ${byteLen} bytes${mood ? ', mood: ' + mood : ''})...`);
      if (DRY_RUN) { console.log(byteLen > MAX_TEXT_BYTES ? ' [dry run, will auto-split]' : ' [dry run]'); continue; } // ttsText used for byte check

      try {
        const { audio, chunkCount } = await synthesizeSegment(ttsText, u.speaker, prompt, getFreshToken);
        AUDIO_DESTS.forEach(dir => fs.writeFileSync(path.join(dir, fname), audio));
        generated++;
        process.stdout.write(chunkCount > 1 ? ` ✓ (${chunkCount} chunks stitched)\n` : ' ✓\n');
      } catch (e) {
        errors++;
        errorList.push({ fname, error: e.message });
        process.stdout.write(` ✗ (${e.message.slice(0, 150)})\n`);
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }

  console.log(`\nDone. ${totalUnits} total segments — ${generated} generated, ${skipped} skipped (already existed), ${errors} errors.`);
  if (errorList.length) {
    console.log('\nErrors:');
    errorList.forEach(e => console.log(`  ${e.fname}: ${e.error}`));
    console.log('\nRe-run the same command to retry just the missing/failed files.');
  }
  if (!DRY_RUN && generated > 0) {
    console.log(`\nAudio written to ${AUDIO_DESTS.length} location(s):`);
    AUDIO_DESTS.forEach(d => console.log(`  ${d}`));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
