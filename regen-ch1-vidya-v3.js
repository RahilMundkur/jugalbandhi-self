/**
 * regen-ch1-vidya-v3.js — One-off, scoped regeneration of chapter 1's two
 * opening Vidya lines (ch01_p000, ch01_p001) using eleven_v3 + the current
 * _MOOD_MAP hints from tts-units.js, for review before touching production.
 *
 * WHY THIS EXISTS INSTEAD OF generate-el-tts.js: production deliberately
 * forces en's female voice (Ruhani/Vidya) to eleven_multilingual_v2, never
 * v3 — see generate-el-tts.js's isV3ForSpeaker(): three alternate
 * Indian-accented voices were all piloted under v3 and every one of them
 * lost the accent, on top of the original Ruhani voice doing the same. That
 * finding was on a long (615-char), high-energy clip though; these two
 * lines are 3-4 words each, so it's untested whether the accent survives at
 * this length. This script deliberately overrides that guard for ONLY
 * chapter 1 / units 0 and 1, so the two lines can be judged by ear before
 * deciding whether to touch anything else.
 *
 * Writes to test-output/ (repo root) — NOT audio/en/ or any of the 3
 * production sync locations. Nothing shipped is at risk from running this.
 *
 * Usage:
 *   node regen-ch1-vidya-v3.js --key YOUR_KEY
 *   node regen-ch1-vidya-v3.js --key YOUR_KEY --dry-run
 *
 * After listening, compare against the current production files:
 *   audio/en/en_ch01_p000_female.mp3
 *   audio/en/en_ch01_p001_female.mp3
 * If the v3 takes hold the accent and fix the pacing, copy them over (and
 * to the other 2 sync locations) manually, or ask for a follow-up command.
 */

const fs   = require('fs');
const path = require('path');
const { getChapterTTSUnits, getMood } = require('./tts-units.js');

const ROOT      = __dirname;
const HTML_FILE = path.join(ROOT, 'reader.html');
const OUT_DIR   = path.join(ROOT, 'test-output');

const args   = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const EL_KEY  = getArg('key', process.env.ELEVENLABS_API_KEY || '');
const DRY_RUN = args.includes('--dry-run');
// --unit restricts to a single unit index (0 or 1) — useful for re-rolling
// just one line (v3 output is non-deterministic run to run) without
// re-spending on the one that already sounded right.
const UNIT_ARG = getArg('unit', null);
// --label appends a suffix to the filename so repeated takes on the same
// unit don't overwrite each other, letting you compare multiple attempts.
const LABEL = getArg('label', null);

if (!DRY_RUN && !EL_KEY) {
  console.error('ElevenLabs API key required. Use --key or set ELEVENLABS_API_KEY.');
  process.exit(1);
}

// Same voice ID and v3 voice settings as production's isV3ForSpeaker()==true
// path, for a fair comparison against how every other v3 unit in this book
// was generated.
const VOICE_ID_FEMALE_EN = 'KleDBQ7etYG6NMjnQ9Jw'; // Ruhani (Vidya)
const MODEL_ID = 'eleven_v3';
const VOICE_SETTINGS = {
  stability:         0.5,
  similarity_boost:  0.75,
  style:             0.3,
  use_speaker_boost: true,
};

const TARGET_UNITS = UNIT_ARG !== null ? [Number(UNIT_ARG)] : [0, 1]; // ch01_p000, ch01_p001

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractBookData(html) {
  const m = html.match(/const BOOK_DATA = (\[[\s\S]*?\]);[\s\n]*(?=const|\/\/|<)/);
  if (!m) throw new Error('Could not find BOOK_DATA in reader.html');
  return JSON.parse(m[1]);
}

async function synthesize(text) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID_FEMALE_EN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key':   EL_KEY,
      'Content-Type': 'application/json',
      'Accept':       'audio/mpeg',
    },
    body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: VOICE_SETTINGS }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  console.log(`\nch1 Vidya v3 test regen — model=${MODEL_ID}, stability=${VOICE_SETTINGS.stability}`);
  console.log(`Writing to ${OUT_DIR} only — production audio/ is untouched.\n`);
  if (DRY_RUN) console.log('(dry run — no API calls, no files written, no cost)\n');

  const html = fs.readFileSync(HTML_FILE, 'utf8');
  const bookData = extractBookData(html);
  const ch1 = bookData.find(c => c.num === 1);
  const units = getChapterTTSUnits(1, ch1.paragraphs, null);

  if (!DRY_RUN) fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const i of TARGET_UNITS) {
    const u = units[i];
    if (!u) { console.log(`  unit ${i}: NOT FOUND, skipping`); continue; }
    const mood = getMood(1, i);
    const ttsText = mood ? `${mood} ${u.text}` : u.text;
    const pStr = String(i).padStart(3, '0');
    const labelSuffix = LABEL ? `_${LABEL}` : '';
    const fname = `en_ch01_p${pStr}_${u.speaker}_v3test${labelSuffix}.mp3`;

    console.log(`  ${fname}`);
    console.log(`    speaker: ${u.speaker} | mood: ${mood || '(none)'}`);
    console.log(`    text: ${u.text}`);
    console.log(`    compare against: audio/en/en_ch01_p${pStr}_${u.speaker}.mp3`);

    if (DRY_RUN) { console.log(`    [dry run] ${ttsText.length} chars\n`); continue; }

    try {
      const audio = await synthesize(ttsText);
      fs.writeFileSync(path.join(OUT_DIR, fname), audio);
      console.log(`    written to test-output/${fname}\n`);
    } catch (e) {
      console.log(`    ERROR: ${e.message}\n`);
    }
    await sleep(1500);
  }

  console.log('Done. Listen in test-output/ and compare against the production files noted above.');
}

main().catch(e => { console.error(e); process.exit(1); });
