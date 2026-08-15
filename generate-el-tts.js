/**
 * generate-el-tts.js — Generate pre-baked audio for English, French, Hindi,
 * Chinese (Simplified/Traditional), and Spanish using the ElevenLabs API.
 *
 * Mirrors the structure of generate-thai-tts.js so both scripts behave the
 * same way (dry-run, --chapter/--chapters/--unit/--force, skip-if-exists,
 * 4-location sync, error reporting).
 *
 * Voices: configure VOICE_IDS below with your ElevenLabs voice IDs.
 *   - female: Vidya's voice
 *   - male:   Ishwar's voice
 *   - narrator: same as male (Ishwar narrates)
 *
 * Requirements:
 *   - Node.js 18+ (built-in fetch)
 *   - ElevenLabs API key (set as ELEVENLABS_API_KEY env var or --key flag)
 *
 * Usage:
 *   ELEVENLABS_API_KEY=your-key node generate-el-tts.js --lang en --dry-run
 *   node generate-el-tts.js --key your-key --lang en
 *   node generate-el-tts.js --key your-key --lang fr
 *   node generate-el-tts.js --key your-key --lang hi
 *   node generate-el-tts.js --key your-key --lang en --chapter 7
 *   node generate-el-tts.js --key your-key --lang en --chapters 1,5,27-30
 *   node generate-el-tts.js --key your-key --lang en --chapter 7 --unit 6 --force
 *   node generate-el-tts.js --key your-key --lang en --force   # regenerate all
 *
 * Safe to re-run — skips files that already exist unless --force is passed.
 *
 * --unit filters by TTS UNIT INDEX (the zero-based "pNNN" in the filename),
 * not the paragraph index. Run --dry-run first to confirm unit numbers.
 * --unit requires --chapter or --chapters.
 *
 * There is no reliable automatic way to detect a bad take (truncated tail,
 * accent drift, etc.) — acoustic checks tried this session didn't reliably
 * separate clips confirmed bad by ear from clips confirmed fine. So this
 * script generates each unit ONCE; spot-check by ear and use --chapter N
 * --unit M --force to regenerate anything that sounds off.
 *
 * ── Model / mood behavior (per-language, see V3_LANGS below) ───────────────
 * All 6 languages (fr, hi, zh, zh-tw, es, en) now use "eleven_v3" with
 * getMood()/_MOOD_MAP (tts-units.js) hints prepended as a v3 audio tag (e.g.
 * "[hushed, epiphanic] That was until I sank deep..."), which v3 treats as a
 * silent delivery direction — validated this session via a standalone pilot
 * (pilot-v3-tags.js): tags don't bleed into speech, and stability 0.5 (not
 * v3's often-recommended 0.3-0.4) was needed to avoid an intermittent glitch
 * found in one Hindi clip. Known open risks even at 0.5:
 *   - An intermittent truncated/snipped tail on some clips regardless of
 *     length or tag — no setting fixed it, only a plain regeneration did,
 *     non-deterministically. Expect an unpredictable few percent of clips
 *     to need a --force regen after listening.
 *   - Rare content substitution: one es clip briefly spoke the English
 *     source phrase instead of the translated text on a first attempt
 *     (self-corrected on retry) — most likely v3 pattern-matching toward a
 *     memorized English phrasing for a recognizable line rather than
 *     reading the given translation. Only seen once; flag anything that
 *     sounds like it's speaking the wrong language entirely.
 *
 * es was piloted on the same long/[excited]/high-energy clip profile (same
 * voice character, same length register) that originally broke en (below)
 * and came back clean.
 *
 * en's original voice, "Cassian" (Veg2qijYoJAS8VPKOOmi), had an unresolved
 * accent-drift failure on that same long/[excited] clip profile — drifted
 * American across 4 attempts (stability 0.5, stability 0.65, tag removed,
 * chunked) with no fix found. Replaced with "James England"
 * (pntCrkG74vr6oin3byQI), re-tested on both the failing long clip and a
 * short clip — held the British accent on both — and is now the configured
 * Ishwar voice for en below. If accent drift resurfaces on other en content,
 * that's the voice to revisit first. See VOICE_SETTINGS below for the
 * per-model style/stability knobs.
 *
 * en's female voice (Vidya) hit the same class of problem from the other
 * direction: Ruhani's Indian-accented English flattened out under v3. Three
 * alternate Indian-accented candidate voices (Arfa, Kavita, Monika Sogam)
 * were piloted as v3 replacements and ALL THREE lost their accent under v3
 * too — confirmed against their own v2 previews, which do sound properly
 * Indian-accented — pointing to a systemic v3 issue with this accent rather
 * than a bad voice pick (the same conclusion the Cassian saga reached, just
 * for a different accent). Rather than keep burning pilot attempts on more
 * voices, en's female speaker specifically is reverted to v2 (see
 * isV3ForSpeaker() below) — the one speaker-level exception to the
 * otherwise per-language V3_LANGS toggle. en's male/narrator (James
 * England) stays on v3 since that swap DID hold its accent.
 */

const fs   = require('fs');
const path = require('path');
const { getChapterTTSUnits, getMood } = require('./tts-units.js');

const ROOT      = __dirname;
const HTML_FILE = path.join(ROOT, 'reader.html');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const getArg = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };

const LANG         = getArg('lang', 'en');           // en | fr | hi
const EL_KEY       = getArg('key',  process.env.ELEVENLABS_API_KEY || '');
const ONLY_CHAPTER = getArg('chapter', null);
const CHAPTERS_ARG = getArg('chapters', null);
const UNIT_ARG     = getArg('unit', null);
const SPEAKER_ARG  = getArg('speaker', null);        // e.g. "female" or "male,narrator" — filters which speaker(s) to (re)generate, letting --force target just one voice without touching the others
const FORCE        = args.includes('--force');
const DRY_RUN      = args.includes('--dry-run');
const SPEAKER_SET  = SPEAKER_ARG ? new Set(SPEAKER_ARG.split(',').map(s => s.trim())) : null;
if (SPEAKER_SET) {
  for (const s of SPEAKER_SET) {
    if (!['female', 'male', 'narrator'].includes(s)) {
      console.error(`Unknown --speaker "${s}". Use female, male, narrator, or a comma list, e.g. --speaker male,narrator.`);
      process.exit(1);
    }
  }
}

if (!['en', 'fr', 'hi', 'zh', 'zh-tw', 'es'].includes(LANG)) {
  console.error(`Unknown --lang "${LANG}". Use en, fr, hi, zh, zh-tw, or es.`);
  process.exit(1);
}
if (!DRY_RUN && !EL_KEY) {
  console.error('ElevenLabs API key required. Use --key or set ELEVENLABS_API_KEY.');
  process.exit(1);
}
if (UNIT_ARG && !ONLY_CHAPTER && !CHAPTERS_ARG) {
  console.error('--unit requires --chapter or --chapters.');
  process.exit(1);
}

// ── ElevenLabs config ────────────────────────────────────────────────────────
// Languages validated for v3 + mood tags this session (pilot-v3-tags.js).
// en was originally excluded: the "Cassian" voice had an unresolved
// accent-drift failure on long/intense passages (drifted American on a
// 615-char [excited] clip across 4 attempts — stability 0.5, stability
// 0.65, tag removed, chunked — none fixed it). es was piloted on that same
// long/[excited]/high-energy profile (same voice character, same length
// register) and came back clean, so es was included despite sharing en's
// risk category. en itself was then re-tested with an alternate voice,
// "James England" (pntCrkG74vr6oin3byQI), on both the failing long clip and
// a short clip — held the British accent on both — and swapped in below,
// so en is now included too.
const V3_LANGS = new Set(['fr', 'hi', 'zh', 'zh-tw', 'es', 'en']);
const IS_V3    = V3_LANGS.has(LANG); // language-level default; see isV3ForSpeaker() for the en-female exception

// Per-speaker override on top of the per-language V3_LANGS toggle: en's
// female voice (Ruhani) does not hold its Indian accent under v3 (see header
// comment) and is reverted to v2. Every other language/speaker combination
// just follows V3_LANGS as before.
function isV3ForSpeaker(lang, speaker) {
  if (lang === 'en' && speaker === 'female') return false;
  return V3_LANGS.has(lang);
}
function modelIdFor(lang, speaker) {
  return isV3ForSpeaker(lang, speaker) ? 'eleven_v3' : 'eleven_multilingual_v2';
}
function voiceSettingsFor(lang, speaker) {
  return isV3ForSpeaker(lang, speaker) ? {
    stability:         0.5,
    similarity_boost:  0.75,
    style:             0.3,
    use_speaker_boost: true,
  } : {
    stability:         0.55,  // higher = more consistent, lower = more expressive
    similarity_boost:  0.80,
    style:             0.35,  // style exaggeration (0-1)
    use_speaker_boost: true,
  };
}

// ── Voice IDs per language ────────────────────────────────────────────────────
const VOICE_IDS_BY_LANG = {
  en: {
    female:   'KleDBQ7etYG6NMjnQ9Jw',  // Ruhani - Soft, Calm and Driven (Vidya)
    male:     'pntCrkG74vr6oin3byQI',  // James England (Ishwar) — replaced Cassian after accent-drift failure under v3
    narrator: 'pntCrkG74vr6oin3byQI',  // same as male
  },
  fr: {
    female:   'BpjGufoPiobT79j2vtj4',  // Priyanka - Calm, Neutral and Relaxed (Vidya)
    male:     'IKne3meq5aSn9XLyUdCD',  // Charlie - Deep, Confident, Energetic (Ishwar)
    narrator: 'IKne3meq5aSn9XLyUdCD',  // same as male
  },
  hi: {
    female:   'jPuxGMn4XLoGjUPrH2EM',  // Simran - Polished, Soft and Seductive (Vidya)
    male:     'tCFpS0oe1uFHQwE0P2QX',  // Ram - Inviting, Calm and Smooth (Ishwar)
    narrator: 'tCFpS0oe1uFHQwE0P2QX',  // same as male
  },
  zh: {
    female:   'APSIkVZudNbPAwyPoeVO',  // Sage - Soothing & Gentle (Vidya)
    male:     '4VZIsMPtgggwNg7OXbPY',  // James Gao - Calm, Friendly and Warm (Ishwar)
    narrator: '4VZIsMPtgggwNg7OXbPY',
  },
  'zh-tw': {
    female:   'APSIkVZudNbPAwyPoeVO',  // Sage - Soothing & Gentle (Vidya)
    male:     '4VZIsMPtgggwNg7OXbPY',  // James Gao - Calm, Friendly and Warm (Ishwar)
    narrator: '4VZIsMPtgggwNg7OXbPY',
  },
  es: {
    female:   'jPuxGMn4XLoGjUPrH2EM',  // Simran - Polished, Soft and Seductive (Vidya)
    male:     '1MxuWc12WPRxDkgfT3kj',  // Efrayn - Breathy, Serene and Expressive (Ishwar)
    narrator: '1MxuWc12WPRxDkgfT3kj',
  },
};
const VOICE_IDS = VOICE_IDS_BY_LANG[LANG];

// Rate limiting — ElevenLabs free/starter tiers allow ~2 requests/sec
const REQUEST_DELAY_MS = 1500;
const MAX_RETRIES      = 5;

// ElevenLabs limit per request (characters, not bytes)
const MAX_CHARS = 4800;

// ── Output locations ─────────────────────────────────────────────────────────
const AUDIO_DESTS = [
  path.join(ROOT, 'audio', LANG),
  path.join(ROOT, 'capacitor-project', 'audio-packs-android', `audio_${LANG}`, 'src', 'main', 'assets', 'audio', LANG),
  path.join(ROOT, 'capacitor-project', 'ios', 'App', 'App', 'public', 'audio', LANG),
];

// ── Helpers ──────────────────────────────────────────────────────────────────
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
const UNIT_SET    = parseSelector(UNIT_ARG);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Split long text at sentence boundaries to stay under MAX_CHARS
function splitText(text) {
  if (text.length <= MAX_CHARS) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > MAX_CHARS) {
    // Find last sentence boundary within limit
    const window = remaining.slice(0, MAX_CHARS);
    const lastDot = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('? '),
      window.lastIndexOf('! '),
      window.lastIndexOf('\n')
    );
    const cut = lastDot > MAX_CHARS * 0.5 ? lastDot + 1 : MAX_CHARS;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

function extractFromHTML(html) {
  const bookMatch = html.match(/const BOOK_DATA = (\[[\s\S]*?\]);[\s\n]*(?=const|\/\/|<)/);
  if (!bookMatch) throw new Error('Could not find BOOK_DATA in reader.html');
  const bookData = JSON.parse(bookMatch[1]);
  const transMatch = html.match(/const TRANSLATIONS = (\{[\s\S]*?\});[\s\n]*(?=const|\/\/|<)/);
  const translations = transMatch ? JSON.parse(transMatch[1]) : {};
  return { bookData, translations };
}

// ── ElevenLabs API call ──────────────────────────────────────────────────────
async function synthesizeChunk(text, speaker, modelId, voiceSettings) {
  const voiceId = VOICE_IDS[speaker] || VOICE_IDS.male;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key':   EL_KEY,
          'Content-Type': 'application/json',
          'Accept':       'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id:       modelId,
          voice_settings: voiceSettings,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
      }
      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf);
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES) await sleep(2000 * attempt);
    }
  }
  throw lastErr;
}

async function synthesizeSegment(text, speaker, modelId, voiceSettings) {
  const chunks = splitText(text);
  const buffers = [];
  for (const chunk of chunks) {
    buffers.push(await synthesizeChunk(chunk, speaker, modelId, voiceSettings));
    if (chunks.length > 1) await sleep(REQUEST_DELAY_MS);
  }
  return { audio: Buffer.concat(buffers), chunkCount: chunks.length };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const femaleIsV3 = isV3ForSpeaker(LANG, 'female');
  const maleIsV3   = isV3ForSpeaker(LANG, 'male');
  if (femaleIsV3 === maleIsV3) {
    console.log(`\nElevenLabs TTS generator — model ${modelIdFor(LANG, 'male')}, lang ${LANG}, stability ${voiceSettingsFor(LANG, 'male').stability}`);
    console.log(IS_V3 ? 'Mood tags: APPLIED (v3 audio tags)' : 'Mood tags: not applied (v2 has no silent style-cue mechanism)');
  } else {
    console.log(`\nElevenLabs TTS generator — lang ${LANG} (mixed models: female=${modelIdFor(LANG, 'female')}, male/narrator=${modelIdFor(LANG, 'male')})`);
    console.log(`Mood tags: applied to v3 speakers only (female=${femaleIsV3 ? 'yes' : 'no'}, male/narrator=${maleIsV3 ? 'yes' : 'no'})`);
  }
  console.log(`Voices: female/Vidya = ${VOICE_IDS.female}, male+narrator/Ishwar = ${VOICE_IDS.male}`);
  if (DRY_RUN) console.log('(dry run — no API calls, no files written, no cost)\n');
  else if (!EL_KEY) { console.error('No API key.'); process.exit(1); }
  else console.log('');

  // Validate voice IDs are configured
  if (!DRY_RUN && (!VOICE_IDS || !VOICE_IDS.female || !VOICE_IDS.male)) {
    console.error(`No voice IDs configured for language '${LANG}'. Check VOICE_IDS_BY_LANG in the script.`);
    process.exit(1);
  }

  const html = fs.readFileSync(HTML_FILE, 'utf8');
  const { bookData, translations } = extractFromHTML(html);
  const langChapters = (translations[LANG] && translations[LANG].chapters) || {};

  if (!DRY_RUN) {
    AUDIO_DESTS.forEach(dir => fs.mkdirSync(dir, { recursive: true }));
  }

  let totalUnits = 0, generated = 0, skipped = 0, errors = 0;
  const errorList = [];

  for (const ch of bookData) {
    if (!ch.num) continue;
    if (ONLY_CHAPTER && String(ch.num) !== String(ONLY_CHAPTER)) continue;
    if (CHAPTER_SET && !CHAPTER_SET.has(ch.num)) continue;

    // For English use raw paragraphs; for fr/hi use translations
    const transObj = LANG === 'en' ? null : (langChapters[String(ch.num)] || {});
    const units = getChapterTTSUnits(ch.num, ch.paragraphs, transObj);
    if (units.length === 0) continue;

    console.log(`Chapter ${ch.num} "${ch.title || ''}" — ${units.length} segments`);

    for (let i = 0; i < units.length; i++) {
      if (UNIT_SET && !UNIT_SET.has(i)) continue;
      const u = units[i];
      if (SPEAKER_SET && !SPEAKER_SET.has(u.speaker)) continue;
      totalUnits++;
      const pStr  = String(i).padStart(3, '0');
      const chStr = String(ch.num).padStart(2, '0');
      const fname = `${LANG}_ch${chStr}_p${pStr}_${u.speaker}.mp3`;
      const primaryDest = path.join(AUDIO_DESTS[0], fname);

      if (!FORCE && !DRY_RUN && fs.existsSync(primaryDest)) {
        skipped++;
        continue;
      }

      // See header comment: v3-eligible speakers get the mood hint prepended
      // as a real v3 audio tag — validated silent on v3 via pilot-v3-tags.js.
      // v2 speakers (all of en/es historically, now also just en's female)
      // never get mood applied: v2 has no silent style-cue mechanism and
      // would just speak it aloud (the original bug this comment used to
      // describe). isV3ForSpeaker() carries the one exception (en female).
      const unitIsV3      = isV3ForSpeaker(LANG, u.speaker);
      const modelId        = modelIdFor(LANG, u.speaker);
      const voiceSettings  = voiceSettingsFor(LANG, u.speaker);
      const mood    = getMood(ch.num, i);
      const ttsText = (unitIsV3 && mood) ? `${mood} ${u.text}` : u.text;

      const moodLabel = mood ? (unitIsV3 ? `, mood: ${mood}` : `, mood (unused, v2): ${mood}`) : '';
      process.stdout.write(`  ${fname} (${u.speaker}, ${modelId}, ${ttsText.length} chars${moodLabel})...`);
      if (DRY_RUN) { console.log(' [dry run]'); continue; }

      try {
        const { audio, chunkCount } = await synthesizeSegment(ttsText, u.speaker, modelId, voiceSettings);
        AUDIO_DESTS.forEach(dir => fs.writeFileSync(path.join(dir, fname), audio));
        generated++;
        process.stdout.write(chunkCount > 1 ? ` ✓ (${chunkCount} chunks)\n` : ' ✓\n');
      } catch (e) {
        errors++;
        errorList.push({ fname, error: e.message });
        process.stdout.write(` ✗ (${e.message.slice(0, 150)})\n`);
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }

  console.log(`\nDone. ${totalUnits} total — ${generated} generated, ${skipped} skipped, ${errors} errors.`);
  if (errorList.length) {
    console.log('\nErrors:');
    errorList.forEach(e => console.log(`  ${e.fname}: ${e.error}`));
    console.log('\nRe-run the same command to retry failed files.');
  }
  if (!DRY_RUN && generated > 0) {
    console.log(`\nAudio written to ${AUDIO_DESTS.length} location(s):`);
    AUDIO_DESTS.forEach(d => console.log(`  ${d}`));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
