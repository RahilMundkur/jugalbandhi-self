/**
 * translate-all.js — Bake all translations into Jugalbandhi in one command
 *
 * Runs translate-book.js for all 35 DeepL languages.
 * Stops gracefully if the DeepL quota is exceeded.
 *
 * Requirements: Node.js (no npm packages needed)
 *
 * Usage:
 *   node translate-all.js [--key YOUR_DEEPL_KEY] [--only es,fr,de]
 *
 * Examples:
 *   DEEPL_KEY=your-key node translate-all.js
 *   node translate-all.js --key your-key
 *   node translate-all.js --key your-key --only es,fr,ja   # just these languages
 *
 * All 35 languages (all via DeepL):
 *   es fr de it pt ru zh ja ko ar hi nl pl sv tr id uk zh-tw
 *   th he mr gu my gom sa el ur fa ta te bn ml pa ne vi
 */

const { spawn } = require('child_process');
const path      = require('path');
const args      = process.argv.slice(2);

// ---- Parse flags ----------------------------------------------------------

const keyFlag  = args.indexOf('--key');
const DEEPL_KEY = keyFlag >= 0 ? args[keyFlag + 1] : (process.env.DEEPL_KEY || '');

const onlyFlag = args.indexOf('--only');
const onlyList = onlyFlag >= 0 ? args[onlyFlag + 1].split(',').map(s => s.trim().toLowerCase()) : null;

if (!DEEPL_KEY) {
  console.error('No DeepL key found. Set DEEPL_KEY env variable or use --key flag.');
  process.exit(1);
}

// ---- Language list ---------------------------------------------------------

const DEEPL_LANGS = [
  'es','fr','de','it','pt','ru','zh','ja','ko','ar','hi','nl','pl','sv','tr','id','uk','zh-tw',
  'th','he','mr','gu','my','gom','sa','el','ur','fa',
  'ta','te','bn','ml','pa','ne','vi',
];

const langs = onlyList
  ? DEEPL_LANGS.filter(l => onlyList.includes(l))
  : DEEPL_LANGS;

// ---- Runner ----------------------------------------------------------------

function runScript(script, extraArgs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...extraArgs], {
      stdio: 'inherit',
      env: { ...process.env, DEEPL_KEY },
    });
    child.on('close', code => resolve(code));
  });
}

async function main() {
  const translateBook = path.join(__dirname, 'translate-book.js');

  const total   = langs.length;
  const results = [];
  let quotaHit  = false;

  console.log(`\nJugalbandhi translate-all — ${total} language(s)\n`);

  for (const lang of langs) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`  Language: ${lang.toUpperCase()}  (${langs.indexOf(lang) + 1} / ${total})`);
    console.log(`${'─'.repeat(50)}\n`);

    const code = await runScript(translateBook, [lang, '--key', DEEPL_KEY]);

    if (code === 0) {
      results.push({ lang, ok: true });
    } else {
      results.push({ lang, ok: false, code });
      quotaHit = true;
      console.error(`\n  ✗ ${lang} failed (exit ${code}). Stopping DeepL batch.\n`);
      break;
    }
  }

  // ---- Summary -------------------------------------------------------------

  console.log(`\n${'═'.repeat(50)}`);
  console.log('  SUMMARY');
  console.log(`${'═'.repeat(50)}`);
  for (const r of results) {
    const tick = r.ok ? '✓' : '✗';
    console.log(`  ${tick}  ${r.lang.padEnd(6)} ${r.ok ? 'OK' : `failed (exit ${r.code})`}`);
  }
  const succeeded = results.filter(r => r.ok).length;
  console.log(`\n  ${succeeded} / ${results.length} languages completed.\n`);

  if (succeeded < results.length) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
