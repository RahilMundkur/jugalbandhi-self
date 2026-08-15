/**
 * strip-mood-audio.js — Remove the spoken mood-tag phrase (e.g. "[hushed,
 * epiphanic]") from the START of already-generated audio files, WITHOUT
 * re-running any TTS. This is the no-cost alternative to full regeneration
 * for the mood-tag bug fixed in generate-el-tts.js/generate-thai-tts.js
 * (those scripts no longer prepend mood text to the synthesized text; this
 * script fixes the audio that was already generated back when they did).
 *
 * _MOOD_MAP / getMood() in tts-units.js is left completely alone — the mood
 * data itself is still there for possible future use (e.g. properly wiring
 * it into a real style/prompt parameter instead of spoken text). This script
 * only touches the AUDIO, cutting off the portion where the mood phrase was
 * spoken, using speech-to-text (Whisper) to find exactly where each file's
 * real sentence begins. See find-mood-cuts.py for the detection logic.
 *
 * IMPORTANT — this only fixes the mood-phrase bug, not voice identity. The
 * English-male and Spanish-male speaker files also need a NEW VOICE (Cassian
 * / Efrayn replacing the old ones), which trimming can't do — those must
 * still go through generate-el-tts.js --force --lang en / --lang es (which
 * will regenerate ALL speakers for those two languages, incidentally also
 * fixing the mood bug there in the same pass — so don't bother running this
 * script for en/es; use full regeneration for those two languages instead).
 *
 * Requirements:
 *   - ffmpeg/ffprobe on PATH
 *   - Python 3 with faster-whisper: pip install faster-whisper --break-system-packages
 *   - (First run per model size downloads model weights from Hugging Face —
 *     needs normal internet access.)
 *
 * Usage:
 *   node strip-mood-audio.js --lang fr --dry-run
 *     List every file affected by the mood bug for French, no processing.
 *
 *   node strip-mood-audio.js --lang fr --limit 5
 *     Run detection + ffmpeg trim on just 5 files, writing results into
 *     mood-trim-review/fr/ (originals untouched) so you can LISTEN to a
 *     sample before trusting this at scale.
 *
 *   node strip-mood-audio.js --lang fr --chapter 12
 *     Review-mode run scoped to one chapter.
 *
 *   node strip-mood-audio.js --lang fr --apply
 *     Apply trims for real — backs up each original once to
 *     audio-mood-backup/fr/ before overwriting the 2 synced copies
 *     (audio/fr and the Android asset-pack copy; iOS copy too if present).
 *
 *   node strip-mood-audio.js --lang fr --apply --results results-fr.json
 *     Skip re-running Whisper and reuse a previous detection pass's output
 *     (useful if you already reviewed results-fr.json from a review run and
 *     just want to apply the same cuts for real).
 *
 * Languages needing this: fr, hi, th, zh, zh-tw (en/es should be fully
 * regenerated instead — see note above).
 *
 * Low-confidence files (Whisper/text match too uncertain to trust) are never
 * touched — they're listed at the end for manual review or fallback to
 * targeted regeneration (generate-el-tts.js/generate-thai-tts.js --chapter
 * N --unit M --force).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const { getChapterTTSUnits, getMood } = require('./tts-units.js');

const ROOT = __dirname;
const HTML_FILE = path.join(ROOT, 'reader.html');

// ── CLI args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };

const LANG = getArg('lang', null);
const ONLY_CHAPTER = getArg('chapter', null);
const CHAPTERS_ARG = getArg('chapters', null);
const UNIT_ARG = getArg('unit', null);
const LIMIT = getArg('limit', null) ? parseInt(getArg('limit'), 10) : null;
const DRY_RUN = args.includes('--dry-run');
const APPLY = args.includes('--apply');
const MODEL = getArg('model', 'small');
const THRESHOLD = getArg('threshold', '0.5');
const REUSE_RESULTS = getArg('results', null);
const REVIEW_DIR = getArg('review-dir', path.join(ROOT, 'mood-trim-review'));
const BACKUP_DIR = path.join(ROOT, 'audio-mood-backup');

const WHISPER_LANG = { en: 'en', fr: 'fr', hi: 'hi', th: 'th', zh: 'zh', 'zh-tw': 'zh', es: 'es' };

if (!LANG || !WHISPER_LANG[LANG]) {
  console.error('Usage: node strip-mood-audio.js --lang <en|fr|hi|th|zh|zh-tw|es> [--dry-run] [--apply] [--chapter N] [--chapters 1,5,27-30] [--unit N] [--limit N] [--model small] [--threshold 0.5]');
  process.exit(1);
}
if (['en', 'es'].includes(LANG) && APPLY) {
  console.error(`--apply for '${LANG}' is blocked: this language needs a full voice change (Cassian/Efrayn) which trimming can't do.\nRun instead: node generate-el-tts.js --key YOUR_KEY --lang ${LANG} --force`);
  process.exit(1);
}
if (UNIT_ARG && !ONLY_CHAPTER && !CHAPTERS_ARG) {
  console.error('--unit requires --chapter or --chapters.');
  process.exit(1);
}

function parseSelector(selector) {
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
const CHAPTER_SET = parseSelector(CHAPTERS_ARG);
const UNIT_SET = parseSelector(UNIT_ARG);

function extractFromHTML(html) {
  const bookMatch = html.match(/const BOOK_DATA = (\[[\s\S]*?\]);[\s\n]*(?=const|\/\/|<)/);
  if (!bookMatch) throw new Error('Could not find BOOK_DATA in reader.html');
  const bookData = JSON.parse(bookMatch[1]);
  const transMatch = html.match(/const TRANSLATIONS = (\{[\s\S]*?\});[\s\n]*(?=const|\/\/|<)/);
  const translations = transMatch ? JSON.parse(transMatch[1]) : {};
  return { bookData, translations };
}

const AUDIO_DESTS = [
  path.join(ROOT, 'audio', LANG),
  path.join(ROOT, 'capacitor-project', 'audio-packs-android', `audio_${LANG}`, 'src', 'main', 'assets', 'audio', LANG),
  path.join(ROOT, 'capacitor-project', 'ios', 'App', 'App', 'public', 'audio', LANG),
].filter(d => fs.existsSync(path.dirname(d)) || fs.existsSync(d));

function runFfmpegTrim(srcPath, destPath, cutSeconds) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmp = destPath + '.tmp.mp3';
  // -ss before -i: fast input seeking. -acodec copy: no re-encode (no
  // quality loss, near-instant). -avoid_negative_ts make_zero keeps the
  // output's internal timestamps clean after the cut.
  execFileSync('ffmpeg', [
    '-y', '-ss', String(cutSeconds), '-i', srcPath,
    '-acodec', 'copy', '-avoid_negative_ts', 'make_zero',
    tmp,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  fs.renameSync(tmp, destPath);
}

function main() {
  const html = fs.readFileSync(HTML_FILE, 'utf8');
  const { bookData, translations } = extractFromHTML(html);
  const langChapters = (translations[LANG] && translations[LANG].chapters) || {};

  const candidates = [];
  for (const ch of bookData) {
    if (!ch.num) continue;
    if (ONLY_CHAPTER && String(ch.num) !== String(ONLY_CHAPTER)) continue;
    if (CHAPTER_SET && !CHAPTER_SET.has(ch.num)) continue;

    const transObj = LANG === 'en' ? null : (langChapters[String(ch.num)] || {});
    const units = getChapterTTSUnits(ch.num, ch.paragraphs, transObj);

    for (let i = 0; i < units.length; i++) {
      if (UNIT_SET && !UNIT_SET.has(i)) continue;
      const mood = getMood(ch.num, i);
      if (!mood) continue; // this file was never affected by the bug

      const u = units[i];
      const pStr = String(i).padStart(3, '0');
      const chStr = String(ch.num).padStart(2, '0');
      const fname = `${LANG}_ch${chStr}_p${pStr}_${u.speaker}.mp3`;
      const srcPath = path.join(AUDIO_DESTS[0], fname);
      if (!fs.existsSync(srcPath)) continue; // not generated yet

      candidates.push({ fname, srcPath, ref: u.text, chapter: ch.num, unit: i, mood });
    }
  }

  console.log(`Found ${candidates.length} file(s) affected by the mood-tag bug for lang=${LANG}${ONLY_CHAPTER ? ` (chapter ${ONLY_CHAPTER})` : ''}${CHAPTERS_ARG ? ` (chapters ${CHAPTERS_ARG})` : ''}.`);

  const limited = LIMIT ? candidates.slice(0, LIMIT) : candidates;
  if (LIMIT && candidates.length > LIMIT) {
    console.log(`--limit ${LIMIT}: processing the first ${LIMIT} of ${candidates.length}.`);
  }

  if (DRY_RUN) {
    limited.forEach(c => console.log(`  ${c.fname}  mood=${c.mood}  ref="${c.ref.slice(0, 50)}..."`));
    console.log('\n(dry run — no audio processed)');
    return;
  }

  let results;
  if (REUSE_RESULTS) {
    console.log(`Reusing previous detection results from ${REUSE_RESULTS}`);
    results = JSON.parse(fs.readFileSync(REUSE_RESULTS, 'utf8'));
  } else {
    const manifest = limited.map(c => ({ file: c.srcPath, lang: WHISPER_LANG[LANG], ref: c.ref }));
    const manifestPath = path.join(os.tmpdir(), `mood-cut-manifest-${LANG}-${Date.now()}.json`);
    const resultsPath = path.join(os.tmpdir(), `mood-cut-results-${LANG}-${Date.now()}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    console.log(`\nRunning Whisper detection on ${manifest.length} file(s) (model=${MODEL})...\n`);
    const py = spawnSync('python3', [
      path.join(ROOT, 'find-mood-cuts.py'),
      '--manifest', manifestPath,
      '--out', resultsPath,
      '--model', MODEL,
      '--threshold', THRESHOLD,
    ], { stdio: 'inherit' });

    if (py.status !== 0) {
      console.error('\nfind-mood-cuts.py failed. If this is a missing-package error, run:\n  pip install faster-whisper --break-system-packages');
      process.exit(1);
    }
    results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    console.log(`\nResults saved to ${resultsPath} (pass --results ${resultsPath} to re-apply without re-running Whisper)`);
  }

  const byFile = new Map(results.map(r => [r.file, r]));
  const lowConfidence = [];
  let processed = 0;

  for (const c of limited) {
    const r = byFile.get(c.srcPath);
    if (!r || r.cut_seconds === null || r.cut_seconds === undefined) {
      lowConfidence.push({ ...c, confidence: r ? r.confidence : 0 });
      continue;
    }

    if (APPLY) {
      // Back up the pre-trim original once, from the canonical source dir.
      const backupPath = path.join(BACKUP_DIR, LANG, c.fname);
      if (!fs.existsSync(backupPath)) {
        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
        fs.copyFileSync(c.srcPath, backupPath);
      }
      for (const dir of AUDIO_DESTS) {
        const destFile = path.join(dir, c.fname);
        if (!fs.existsSync(destFile)) continue;
        runFfmpegTrim(destFile, destFile, r.cut_seconds);
      }
      console.log(`  ✓ applied ${c.fname} (cut ${r.cut_seconds}s, confidence ${r.confidence})`);
    } else {
      const reviewFile = path.join(REVIEW_DIR, LANG, c.fname);
      runFfmpegTrim(c.srcPath, reviewFile, r.cut_seconds);
      console.log(`  ✓ review copy written: ${reviewFile} (cut ${r.cut_seconds}s, confidence ${r.confidence})`);
    }
    processed++;
  }

  console.log(`\n${processed} file(s) ${APPLY ? 'applied' : 'written to review dir'}.`);
  if (lowConfidence.length) {
    console.log(`\n${lowConfidence.length} file(s) skipped — low confidence, needs manual review or targeted regeneration:`);
    lowConfidence.forEach(c => console.log(`  ${c.fname} (chapter ${c.chapter}, unit ${c.unit}, confidence ${c.confidence})  →  node generate-el-tts.js --lang ${LANG} --chapter ${c.chapter} --unit ${c.unit} --force`));
  }
  if (!APPLY) {
    console.log(`\nListen to the files in ${path.join(REVIEW_DIR, LANG)} before applying. Once satisfied, re-run with --apply (add --results <path printed above> to skip re-running Whisper).`);
  }
}

main();
