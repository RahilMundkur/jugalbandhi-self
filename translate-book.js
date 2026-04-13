/**
 * translate-book.js — Pre-translate Jugalbandhi into any language via DeepL
 *
 * Translates every paragraph in every chapter AND all front/back matter
 * (copyright, dedication, acknowledgements, endnotes, recommendations, feedback)
 * and bakes the translations directly into the HTML file.
 *
 * Requirements: Node.js (no npm packages needed)
 *
 * Usage:
 *   node translate-book.js <language-code> [--key YOUR_KEY]
 *
 * Examples:
 *   node translate-book.js es
 *   node translate-book.js fr --key your-deepl-key-here
 *   DEEPL_KEY=your-key node translate-book.js de
 *
 * Supported language codes (DeepL):
 *   es  Spanish       fr  French        de  German
 *   it  Italian       pt  Portuguese    ru  Russian
 *   zh  Chinese (S)   ja  Japanese      ko  Korean
 *   ar  Arabic        hi  Hindi         nl  Dutch
 *   pl  Polish        sv  Swedish       tr  Turkish
 *   id  Indonesian    uk  Ukrainian     zh-TW Chinese (T)
 *   th  Thai          he  Hebrew        mr  Marathi
 *   gu  Gujarati      my  Burmese       gom Konkani
 *   sa  Sanskrit      el  Greek
 *   ur  Urdu          fa  Persian
 *   ta  Tamil         te  Telugu        bn  Bengali
 *   ml  Malayalam     pa  Punjabi       ne  Nepali
 *   vi  Vietnamese
 *
 * Safe to re-run — skips already-translated content.
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const HTML_FILE = path.join(__dirname, 'index.html');

const DEEPL_LANG_MAP = {
  'zh': 'ZH-HANS', 'zh-tw': 'ZH-HANT',
  'pt': 'PT-PT',   'pt-br': 'PT-BR',
};

const BATCH_DELAY = 800;

const args = process.argv.slice(2);
const langArg = args.find(a => !a.startsWith('--'));
const keyFlag = args.indexOf('--key');
const DEEPL_KEY = keyFlag >= 0 ? args[keyFlag + 1] : (process.env.DEEPL_KEY || '');

if (!langArg) {
  console.error('Usage: node translate-book.js <language-code> [--key YOUR_KEY]');
  process.exit(1);
}
if (!DEEPL_KEY) {
  console.error('No DeepL key found. Set DEEPL_KEY env variable or use --key flag.');
  process.exit(1);
}

const TARGET_LANG = (DEEPL_LANG_MAP[langArg.toLowerCase()] || langArg.toUpperCase());
const LANG_KEY    = langArg.toLowerCase();

function deeplTranslate(texts) {
  return new Promise((resolve, reject) => {
    const host    = DEEPL_KEY.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
    const body    = JSON.stringify({ text: texts, target_lang: TARGET_LANG, source_lang: 'EN' });
    const options = {
      hostname: host, path: '/v2/translate', method: 'POST',
      headers: {
        'Authorization': `DeepL-Auth-Key ${DEEPL_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`DeepL returned ${res.statusCode}: ${data}`)); return;
        }
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.translations.map(t => t.text));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractFromHTML(html) {
  const bookMatch = html.match(/const BOOK_DATA = (\[[\s\S]*?\]);[\s\n]*(?=const|\/\/|<)/);
  if (!bookMatch) throw new Error('Could not find BOOK_DATA in HTML file.');
  const bookData = JSON.parse(bookMatch[1]);

  const matterMatch = html.match(/const MATTER_DATA = (\{[\s\S]*?\});[\s\n]*(?=const|\/\/|<)/);
  if (!matterMatch) throw new Error('Could not find MATTER_DATA in HTML file.');
  const matterData = JSON.parse(matterMatch[1]);

  const transMatch = html.match(/const TRANSLATIONS = (\{[\s\S]*?\});[\s\n]*(?=const|\/\/|<)/);
  const translations = transMatch ? JSON.parse(transMatch[1]) : {};
  return { bookData, matterData, translations };
}

function writeback(html, translations) {
  const transJson = JSON.stringify(translations);
  let newHtml;
  if (/const TRANSLATIONS = \{[\s\S]*?\};/.test(html)) {
    newHtml = html.replace(/const TRANSLATIONS = \{[\s\S]*?\};/, `const TRANSLATIONS = ${transJson};`);
  } else {
    newHtml = html.replace(
      /(const BOOK_DATA = \[[\s\S]*?\];)([\s\n]*)(const MATTER_DATA)/,
      `$1\n\nconst TRANSLATIONS = ${transJson};\n\n$3`
    );
  }
  fs.writeFileSync(HTML_FILE, newHtml, 'utf8');
}

// Build the "rendered order" list for each matter section —
// must match exactly what openMatter() renders (same filtering, same order).
function getMatterQueues(matterData) {
  const queues = {};

  // copyright: filter out section-title-only strings
  queues.copyright = matterData.copyright
    .filter(p => !['DEDICATION','ACKNOWLEDGEMENTS','CONTENTS'].includes(p));

  // dedication: [names, ...wordLines] — same as openMatter() logic
  const ded = matterData.dedication || [];
  const names = ded.find(p => p.includes('Amma') || p.includes('Leena')) || '';
  const wordLines = ded.filter(p => !p.includes('Amma') && !p.includes('Leena') && p !== 'DEDICATION');
  queues.dedication = [names, ...wordLines];

  // acknowledgements: all strings (generic renderer, first item is NOT all-caps title)
  queues.acknowledgements = (matterData.acknowledgements || []).filter(p => typeof p === 'string');

  // endnotes: each note's text field (by index)
  queues.endnotes = (matterData.endnotes || []).map(n => n.text);

  // endnotes_closing: single string stored separately
  queues.endnotes_closing = matterData.endnotes_closing || null;

  // recommendations: all strings (first item is not all-caps title)
  queues.recommendations = (matterData.recommendations || []).filter(p => typeof p === 'string');

  // feedback: generic renderer skips first item if it looks like an all-caps title
  const fb = (matterData.feedback || []).filter(p => typeof p === 'string');
  const fbSkip = fb[0] && fb[0].toUpperCase() === fb[0].replace(/[^A-Z\s]/g,'') && fb[0].length < 40;
  queues.feedback = fbSkip ? fb.slice(1) : fb;

  // back-cover: blurb paragraphs (generic renderer, no title to skip)
  queues['back-cover'] = (matterData['back-cover'] || []).filter(p => typeof p === 'string');

  return queues;
}

async function translateSection(name, items, existing) {
  const toTranslate = items.map((p, i) => ({ p, i })).filter(({ p, i }) => p && p.trim() && !existing[i]);
  if (toTranslate.length === 0) { console.log(`  ${name} — already done`); return { updated: existing, errors: 0 }; }

  process.stdout.write(`  ${name} — ${toTranslate.length} items...`);
  try {
    const translated = await deeplTranslate(toTranslate.map(({ p }) => p));
    toTranslate.forEach(({ i }, j) => { existing[i] = translated[j]; });
    process.stdout.write(` ✓\n`);
    return { updated: existing, errors: 0 };
  } catch (e) {
    process.stdout.write(` ✗ (${e.message})\n`);
    if (e.message.includes('456') || e.message.includes('quota')) throw new Error('Quota exceeded.');
    return { updated: existing, errors: 1 };
  }
}

async function main() {
  console.log(`\nJugalbandhi pre-translator — ${TARGET_LANG}`);
  if (!fs.existsSync(HTML_FILE)) { console.error(`File not found: ${HTML_FILE}`); process.exit(1); }

  const html = fs.readFileSync(HTML_FILE, 'utf8');
  const { bookData, matterData, translations } = extractFromHTML(html);

  if (!translations[LANG_KEY]) translations[LANG_KEY] = { chapters: {}, matter: {} };
  if (!translations[LANG_KEY].chapters) translations[LANG_KEY].chapters = {};
  if (!translations[LANG_KEY].matter) translations[LANG_KEY].matter = {};
  const langData = translations[LANG_KEY];

  // ── Chapters ──────────────────────────────────────────────────────────────
  let totalParas = 0, alreadyDone = 0;
  for (const ch of bookData) {
    const paras = ch.paragraphs.filter(p => p.trim());
    totalParas += paras.length;
    const existing = langData.chapters[String(ch.num)];
    if (existing) alreadyDone += paras.filter((_, i) => existing[i]).length;
  }

  console.log(`\nChapters: ${totalParas} paragraphs total, ${alreadyDone} done, ${totalParas - alreadyDone} to translate`);

  let errors = 0;
  let quotaHit = false;

  for (const ch of bookData) {
    if (!langData.chapters[String(ch.num)]) langData.chapters[String(ch.num)] = {};
    const chTrans = langData.chapters[String(ch.num)];

    // Translate chapter title if not yet done
    if (!chTrans.title) {
      try {
        const [translatedTitle] = await deeplTranslate([ch.title]);
        chTrans.title = translatedTitle;
      } catch (e) {
        if (e.message.includes('456') || e.message.includes('quota')) {
          console.error('\nQuota exceeded. Saving progress...'); quotaHit = true; break;
        }
      }
      await sleep(BATCH_DELAY);
    }

    const toTranslate = ch.paragraphs.map((p, i) => ({ p, i })).filter(({ p, i }) => p.trim() && !chTrans[i]);

    if (toTranslate.length === 0) { process.stdout.write(`  Ch ${ch.num} "${ch.title}" — done\n`); continue; }
    process.stdout.write(`  Ch ${ch.num} "${ch.title}" — ${toTranslate.length} paragraphs...`);

    try {
      const translated = await deeplTranslate(toTranslate.map(({ p }) => p));
      toTranslate.forEach(({ i }, j) => { chTrans[i] = translated[j]; });
      process.stdout.write(` ✓\n`);
    } catch (e) {
      process.stdout.write(` ✗ (${e.message})\n`);
      errors++;
      if (e.message.includes('456') || e.message.includes('quota')) {
        console.error('\nQuota exceeded. Saving progress...'); quotaHit = true; break;
      }
    }
    await sleep(BATCH_DELAY);
  }

  writeback(fs.readFileSync(HTML_FILE, 'utf8'), translations);

  if (quotaHit) { console.log(`\nStopped early due to quota. Re-run to resume.\n`); process.exit(1); }

  // ── Matter ─────────────────────────────────────────────────────────────────
  console.log(`\nMatter sections:`);
  const queues = getMatterQueues(matterData);

  for (const [section, items] of Object.entries(queues)) {
    if (section === 'endnotes_closing') continue; // handled separately below
    if (!langData.matter[section]) langData.matter[section] = {};
    try {
      const { errors: e } = await translateSection(section, items, langData.matter[section]);
      errors += e;
    } catch (err) {
      console.error(`\nQuota exceeded during matter. Saving progress...\n`);
      writeback(fs.readFileSync(HTML_FILE, 'utf8'), translations);
      process.exit(1);
    }
    await sleep(BATCH_DELAY);
  }

  // endnotes_closing (single string)
  if (queues.endnotes_closing && !langData.matter.endnotes_closing) {
    process.stdout.write(`  endnotes_closing...`);
    try {
      const [t] = await deeplTranslate([queues.endnotes_closing]);
      langData.matter.endnotes_closing = t;
      process.stdout.write(` ✓\n`);
    } catch (e) {
      process.stdout.write(` ✗ (${e.message})\n`);
      errors++;
    }
    await sleep(BATCH_DELAY);
  } else if (langData.matter.endnotes_closing) {
    console.log(`  endnotes_closing — already done`);
  }

  // ── UI labels (sidebar) ───────────────────────────────────────────────────
  console.log(`\nUI labels:`);
  const UI_STRINGS = {
    coverTitle: 'Jugalbandhi Self', subtitle: 'a dialogue on non-dual spirituality', authorName: 'Rahil Mundkur',
    beginReading: 'Begin Reading', continueReading: 'Continue', previous: 'Previous', next: 'Next', cover: 'Cover',
    chapter: 'Chapter', translate: 'Translate', restoreOriginal: 'Restore Original',
    words: 'words', minRead: 'min read',
    frontMatter: 'Front Matter', backMatter: 'Back Matter', chapters: 'Chapters',
    reverseCover: 'Reverse Cover', copyright: 'Copyright', dedication: 'Dedication',
    acknowledgements: 'Acknowledgements', endnotes: 'Endnotes',
    recommendations: 'Recommendations', feedback: 'Feedback',
  };
  if (!langData.ui) langData.ui = {};
  const uiToTranslate = Object.entries(UI_STRINGS).filter(([k]) => !langData.ui[k]);
  if (uiToTranslate.length === 0) {
    console.log('  UI labels — already done');
  } else {
    process.stdout.write(`  ${uiToTranslate.length} labels...`);
    try {
      const translated = await deeplTranslate(uiToTranslate.map(([, v]) => v));
      uiToTranslate.forEach(([k], j) => { langData.ui[k] = translated[j]; });
      process.stdout.write(` ✓\n`);
    } catch (e) {
      process.stdout.write(` ✗ (${e.message})\n`);
      errors++;
    }
  }

  writeback(fs.readFileSync(HTML_FILE, 'utf8'), translations);
  console.log(`\nDone. ${errors} errors.\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
