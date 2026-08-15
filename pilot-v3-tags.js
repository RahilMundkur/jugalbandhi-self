/**
 * pilot-v3-tags.js — Small, non-destructive pilot to evaluate ElevenLabs'
 * eleven_v3 model + audio tags (e.g. "[excited]", "[whispers]") as a
 * legitimate replacement for the old (buggy) mood-hint-in-text approach.
 *
 * Unlike generate-el-tts.js, this script:
 *   - Uses model_id "eleven_v3" instead of "eleven_multilingual_v2"
 *   - Prepends a real v3 audio tag to the text (v3 tags are designed to be
 *     interpreted as delivery direction, NOT spoken aloud — different from
 *     the old bug where bracket text was just literal words)
 *   - Writes output to pilot-v3-output/{lang}/ — a SEPARATE folder, never
 *     touches audio/, the Android pack, or iOS. Nothing production is at risk.
 *   - Only processes 3 hand-picked units per language (short + a longer one,
 *     female + male voice, three different emotional registers) to keep this
 *     cheap and fast to review by ear.
 *
 * Compare each output against the existing production file at the same
 * chapter/unit under audio/{lang}/ to judge:
 *   1) Is the tag text itself audible/spoken? (it should NOT be)
 *   2) Does delivery actually shift in the direction of the tag?
 *   3) Does the voice still sound like the same character (Ishwar/Vidya)?
 *
 * Usage:
 *   node pilot-v3-tags.js --key YOUR_KEY --lang fr
 *   node pilot-v3-tags.js --key YOUR_KEY --lang hi
 *   node pilot-v3-tags.js --key YOUR_KEY --lang zh
 *   node pilot-v3-tags.js --key YOUR_KEY --lang zh-tw
 *   node pilot-v3-tags.js --lang fr --dry-run   # preview only, no API calls
 *
 * Debugging a single glitchy unit (e.g. the hi ch6/u1 end-of-clip glitch):
 *   node pilot-v3-tags.js --key YOUR_KEY --lang hi --only 6:1 --label rerun1
 *   node pilot-v3-tags.js --key YOUR_KEY --lang hi --only 6:1 --label rerun2
 *   node pilot-v3-tags.js --key YOUR_KEY --lang hi --only 6:1 --stability 0.5 --label stab50
 *   --only <chapter>:<unit> restricts to one PILOT_UNITS entry (cheap re-runs).
 *   --stability <0-1> overrides the default 0.35 voice-setting for this run.
 *   --label <text> appends a suffix to the output filename so repeated runs
 *     don't overwrite each other (needed to compare multiple takes by ear).
 *   --tag-override "[tag]" swaps in a different tag for a single --only unit,
 *     without editing the curated tables (isolates whether a tag itself is
 *     causing a problem, independent of the unit's own content/length).
 *   --voice-id ID swaps in a different ElevenLabs voice for a single --only
 *     unit, without editing VOICE_IDS_BY_LANG (used to test whether an
 *     accent/character problem is specific to the currently configured
 *     voice, e.g. the en male "Cassian" voice on ch30/u6, vs. an alternate).
 *     Example: node pilot-v3-tags.js --key YOUR_KEY --lang en --only 30:6 \
 *       --voice-id NEW_VOICE_ID --stability 0.5 --label altvoice
 *
 * Note: chunking long units into smaller pieces before sending to v3 was
 * tried and tested (en ch30/u6, split at 220 chars/piece with a
 * loudnorm+crossfade stitch) as a fix for that clip's accent drift. It did
 * NOT fix the accent (still drifted American) and introduced a new audible
 * seam artifact at the chunk boundaries. Abandoned — not worth carrying as
 * script complexity. See project notes for the full diagnostic trail.
 */

const fs   = require('fs');
const path = require('path');
const { getChapterTTSUnits, getMood } = require('./tts-units.js');

const ROOT      = __dirname;
const HTML_FILE = path.join(ROOT, 'reader.html');

const args   = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };

const LANG      = getArg('lang', null);
const EL_KEY    = getArg('key', process.env.ELEVENLABS_API_KEY || '');
const DRY_RUN   = args.includes('--dry-run');
const ONLY_ARG  = getArg('only', null);          // "chapter:unit"
const LABEL     = getArg('label', null);         // filename suffix
const STABILITY_ARG = getArg('stability', null); // override, string -> float below

if (!['en', 'fr', 'hi', 'zh', 'zh-tw', 'es'].includes(LANG)) {
  console.error('Usage: node pilot-v3-tags.js --key YOUR_KEY --lang en|fr|hi|zh|zh-tw|es [--dry-run] [--only ch:unit] [--stability 0.35] [--label text]');
  process.exit(1);
}
if (!DRY_RUN && !EL_KEY) {
  console.error('ElevenLabs API key required. Use --key or set ELEVENLABS_API_KEY.');
  process.exit(1);
}
let ONLY_CHAPTER = null, ONLY_UNIT = null;
if (ONLY_ARG) {
  const m = ONLY_ARG.match(/^(\d+):(\d+)$/);
  if (!m) { console.error('--only must be "chapter:unit", e.g. --only 6:1'); process.exit(1); }
  ONLY_CHAPTER = Number(m[1]);
  ONLY_UNIT = Number(m[2]);
}
// --tag-override lets a diagnostic run swap in a different v3 tag than the
// one PILOT_UNITS/SHORT_TEST_UNITS has curated for that unit, without
// touching the curated tables (used to isolate whether a specific tag, e.g.
// "[excited]", is itself the cause of a problem independent of clip length).
// Requires --only, since it only makes sense for a single targeted unit.
const TAG_OVERRIDE = getArg('tag-override', null);
if (TAG_OVERRIDE && ONLY_CHAPTER === null) {
  console.error('--tag-override requires --only ch:unit');
  process.exit(1);
}
// --voice-id lets a diagnostic run swap in a completely different ElevenLabs
// voice for a single --only unit, without touching VOICE_IDS_BY_LANG (used
// to test whether an accent-drift problem is specific to the currently
// configured voice, e.g. the en male "Cassian" voice on ch30/u6, versus an
// alternate candidate voice). Requires --only for the same reason as above.
const VOICE_ID_OVERRIDE = getArg('voice-id', null);
if (VOICE_ID_OVERRIDE && ONLY_CHAPTER === null) {
  console.error('--voice-id requires --only ch:unit');
  process.exit(1);
}
if (STABILITY_ARG !== null && (isNaN(Number(STABILITY_ARG)) || Number(STABILITY_ARG) < 0 || Number(STABILITY_ARG) > 1)) {
  console.error('--stability must be a number between 0 and 1');
  process.exit(1);
}

const MODEL_ID = 'eleven_v3';

// Same voice IDs as production (generate-el-tts.js) — v3 is backward
// compatible with v2 voice IDs, though ElevenLabs notes results can be more
// variable than v2. That's exactly what this pilot is checking.
const VOICE_IDS_BY_LANG = {
  en:     { female: 'KleDBQ7etYG6NMjnQ9Jw', male: 'Veg2qijYoJAS8VPKOOmi', narrator: 'Veg2qijYoJAS8VPKOOmi' },
  fr:     { female: 'BpjGufoPiobT79j2vtj4', male: 'IKne3meq5aSn9XLyUdCD', narrator: 'IKne3meq5aSn9XLyUdCD' },
  hi:     { female: 'jPuxGMn4XLoGjUPrH2EM', male: 'tCFpS0oe1uFHQwE0P2QX', narrator: 'tCFpS0oe1uFHQwE0P2QX' },
  zh:     { female: 'APSIkVZudNbPAwyPoeVO', male: '4VZIsMPtgggwNg7OXbPY', narrator: '4VZIsMPtgggwNg7OXbPY' },
  'zh-tw':{ female: 'APSIkVZudNbPAwyPoeVO', male: '4VZIsMPtgggwNg7OXbPY', narrator: '4VZIsMPtgggwNg7OXbPY' },
  es:     { female: 'jPuxGMn4XLoGjUPrH2EM', male: '1MxuWc12WPRxDkgfT3kj', narrator: '1MxuWc12WPRxDkgfT3kj' },
};
const VOICE_IDS = VOICE_IDS_BY_LANG[LANG];

// Lower stability than production's 0.55 — ElevenLabs' own docs recommend
// "Creative" or "Natural" territory (roughly 0.3-0.5) for audio tags to
// actually have an effect; "Robust" (higher stability) suppresses them.
const VOICE_SETTINGS = {
  stability:         STABILITY_ARG !== null ? Number(STABILITY_ARG) : 0.35,
  similarity_boost:  0.75,
  style:             0.3,
  use_speaker_boost: true,
};

// Hand-picked test units: short female-voice line, short male-voice line,
// longer male-voice line — three distinct emotional registers, drawn from
// tts-units.js's existing _MOOD_MAP so we're testing against moods we
// already know these chapters call for. Tags chosen to match ElevenLabs'
// own documented vocabulary where possible (chuckles, excited) or a close,
// documented-style extrapolation (mysteriously) per their guidance that
// experimenting with new descriptive tags is expected to work.
const PILOT_UNITS = [
  { chapter: 1,  unit: 0, tag: '[mysteriously]', note: 'mood map: [mysterious, ethereal]' },
  { chapter: 6,  unit: 1, tag: '[chuckles]',      note: 'mood map: [self-deprecating]' },
  { chapter: 30, unit: 6, tag: '[excited]',       note: 'mood map: [jubilant, rushing]' },
];

// Diagnostic set: additional short clips (15-35 chars, similar length to the
// ch6/u1 clip that showed a trailing-decay/"snipped" tail at stability 0.5),
// pulled from different chapters/speakers/moods than PILOT_UNITS, to check
// whether that tail issue is a general short-clip quirk in v3 or specific to
// that one unit. Select with --set short.
const SHORT_TEST_UNITS = [
  { chapter: 4, unit: 4,  tag: '[curiously]',  note: 'mood map: [genuinely curious], male, 21 chars' },
  { chapter: 7, unit: 0,  tag: '[concerned]',  note: 'mood map: [gently concerned], female, 15 chars' },
  { chapter: 7, unit: 1,  tag: '[sighs]',      note: 'mood map: [heavy, confessional], male, 15 chars' },
];

const UNIT_SET = getArg('set', 'main');
if (!['main', 'short'].includes(UNIT_SET)) {
  console.error('--set must be "main" or "short"');
  process.exit(1);
}
const ACTIVE_UNITS = UNIT_SET === 'short' ? SHORT_TEST_UNITS : PILOT_UNITS;

const OUT_DIR = path.join(ROOT, 'pilot-v3-output', LANG);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractFromHTML(html) {
  const bookMatch = html.match(/const BOOK_DATA = (\[[\s\S]*?\]);[\s\n]*(?=const|\/\/|<)/);
  const bookData = JSON.parse(bookMatch[1]);
  const transMatch = html.match(/const TRANSLATIONS = (\{[\s\S]*?\});[\s\n]*(?=const|\/\/|<)/);
  const translations = JSON.parse(transMatch[1]);
  return { bookData, translations };
}

async function synthesize(text, speaker) {
  const voiceId = VOICE_ID_OVERRIDE || VOICE_IDS[speaker] || VOICE_IDS.male;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key':   EL_KEY,
      'Content-Type': 'application/json',
      'Accept':       'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id:       MODEL_ID,
      voice_settings: VOICE_SETTINGS,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  console.log(`\nEleven v3 audio-tag pilot — lang=${LANG}, model=${MODEL_ID}, stability=${VOICE_SETTINGS.stability}`);
  console.log('This writes ONLY to pilot-v3-output/ — no production files are touched.\n');
  if (DRY_RUN) console.log('(dry run — no API calls, no files written, no cost)\n');

  const html = fs.readFileSync(HTML_FILE, 'utf8');
  const { bookData, translations } = extractFromHTML(html);
  if (!DRY_RUN) fs.mkdirSync(OUT_DIR, { recursive: true });

  let totalChars = 0;

  const unitsToRun = ONLY_CHAPTER !== null
    ? ACTIVE_UNITS.filter(p => p.chapter === ONLY_CHAPTER && p.unit === ONLY_UNIT)
    : ACTIVE_UNITS;
  if (ONLY_CHAPTER !== null && unitsToRun.length === 0) {
    console.log(`  --only ${ONLY_CHAPTER}:${ONLY_UNIT} does not match any entry in --set ${UNIT_SET}. Available: ${ACTIVE_UNITS.map(p => `${p.chapter}:${p.unit}`).join(', ')}`);
    return;
  }

  for (const { chapter, unit, tag: curatedTag, note } of unitsToRun) {
    const tag = TAG_OVERRIDE || curatedTag;
    const ch = bookData.find(c => c.num === chapter);
    const transObj = LANG === 'en' ? null : (translations[LANG] && translations[LANG].chapters[String(chapter)]);
    const units = getChapterTTSUnits(chapter, ch.paragraphs, transObj);
    const u = units[unit];
    if (!u) { console.log(`  ch${chapter}/u${unit}: NOT FOUND, skipping`); continue; }

    const pStr = String(unit).padStart(3, '0');
    const chStr = String(chapter).padStart(2, '0');
    const labelSuffix = LABEL ? `_${LABEL}` : '';
    const fname = `${LANG}_ch${chStr}_p${pStr}_${u.speaker}_v3${labelSuffix}.mp3`;
    const taggedText = `${tag} ${u.text}`;
    totalChars += taggedText.length;

    console.log(`  ${fname}`);
    console.log(`    speaker: ${u.speaker} | tag: ${tag}${TAG_OVERRIDE ? ' (OVERRIDE, curated was ' + curatedTag + ')' : ` (${note})`} | stability: ${VOICE_SETTINGS.stability}`);
    if (VOICE_ID_OVERRIDE) console.log(`    voice: ${VOICE_ID_OVERRIDE} (OVERRIDE, curated was ${VOICE_IDS[u.speaker] || VOICE_IDS.male})`);
    console.log(`    compare against: audio/${LANG}/${LANG}_ch${chStr}_p${pStr}_${u.speaker}.mp3`);

    if (DRY_RUN) { console.log(`    [dry run] ${taggedText.length} chars\n`); continue; }

    try {
      const audio = await synthesize(taggedText, u.speaker);
      fs.writeFileSync(path.join(OUT_DIR, fname), audio);
      console.log(`    written to pilot-v3-output/${LANG}/${fname}\n`);
    } catch (e) {
      console.log(`    ERROR: ${e.message}\n`);
    }
    await sleep(1500);
  }

  console.log(`Total characters sent this run: ${totalChars} (${unitsToRun.length} clip${unitsToRun.length === 1 ? '' : 's'} — should be a trivial fraction of a cent to a few cents at typical per-character pricing; check your ElevenLabs plan for exact v3 rates, which may differ from v2).`);
  if (!DRY_RUN) console.log(`\nListen in pilot-v3-output/${LANG}/ and compare against the matching files in audio/${LANG}/.`);
}

main().catch(e => { console.error(e); process.exit(1); });
