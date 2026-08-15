#!/usr/bin/env node
/**
 * Jugalbandhi Self — regression checks.
 *
 * reader.html and index.html are maintained as two near-duplicate files and
 * are always edited in lockstep. Every fix this project has gone through
 * has been verified by hand with small throwaway scripts (diff the two
 * files, syntax-check the <script> blocks, simulate a bit of logic in
 * isolation). This file collects the checks worth keeping around instead
 * of re-deriving them from scratch each time.
 *
 * Run from the repo root:  node verify.js
 * Or from capacitor-project:  npm run verify
 *
 * Exits non-zero (and prints what failed) if anything's wrong.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const READER = path.join(ROOT, 'reader.html');
const INDEX  = path.join(ROOT, 'index.html');
const WWW_READER = path.join(ROOT, 'capacitor-project', 'www', 'reader.html');
const WWW_INDEX  = path.join(ROOT, 'capacitor-project', 'www', 'index.html');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  - ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  - ${name}`);
    console.log(`        ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ── 1. reader.html / index.html stay in lockstep ───────────────────────────
// The only expected difference between the two files is one pre-existing
// cosmetic blank line early on. Anything else means an edit was applied to
// one file and not the other.
check('reader.html and index.html only differ by the known cosmetic blank line (or not at all)', () => {
  let diffOutput = null; // null = diff exited 0 (files identical)
  try {
    execFileSync('diff', [READER, INDEX], { encoding: 'utf8' });
  } catch (e) {
    // `diff` exits 1 (not a script error) when the files differ.
    if (typeof e.status === 'number' && e.status === 1) {
      diffOutput = e.stdout || '';
    } else {
      throw e;
    }
  }
  if (diffOutput === null) return; // perfectly identical is fine (better than the known diff, even)
  // The known-good diff is a single blank line present in index.html but not
  // reader.html — e.g. "1570a1571" followed by "> " (diff's marker for an
  // added blank line). The exact line number isn't stable: it drifts by
  // however many lines get added earlier in both files by an unrelated,
  // equal-sized edit (which is the normal, expected way these two files
  // change). So match the diff's *shape* (one line added, and that line is
  // blank) instead of hardcoding a specific line number, which would only
  // ever go stale.
  const lines = diffOutput.replace(/\n$/, '').split('\n');
  assert(
    lines.length === 2 && /^\d+a\d+$/.test(lines[0]) && lines[1].replace(/^>\s?/, '') === '',
    `unexpected diff between reader.html and index.html (expected only a single blank-line insertion):\n${diffOutput}`
  );
});

// ── 2. www/ copies match the root files exactly ────────────────────────────
// It's easy to edit reader.html/index.html and forget the `cp` into
// capacitor-project/www/ before syncing — this catches that.
check('capacitor-project/www/reader.html matches root reader.html', () => {
  assert(fs.existsSync(WWW_READER), 'capacitor-project/www/reader.html does not exist — run the www sync');
  const a = fs.readFileSync(READER, 'utf8');
  const b = fs.readFileSync(WWW_READER, 'utf8');
  assert(a === b, 'root reader.html and capacitor-project/www/reader.html have diverged — re-run: cp reader.html capacitor-project/www/reader.html');
});
check('capacitor-project/www/index.html matches root index.html', () => {
  assert(fs.existsSync(WWW_INDEX), 'capacitor-project/www/index.html does not exist — run the www sync');
  const a = fs.readFileSync(INDEX, 'utf8');
  const b = fs.readFileSync(WWW_INDEX, 'utf8');
  assert(a === b, 'root index.html and capacitor-project/www/index.html have diverged — re-run: cp index.html capacitor-project/www/index.html');
});

// ── 3. Every inline <script> block is syntactically valid JS ───────────────
function extractInlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
}
for (const [label, file] of [['reader.html', READER], ['index.html', INDEX]]) {
  check(`${label}: all inline <script> blocks parse as valid JS`, () => {
    const html = fs.readFileSync(file, 'utf8');
    const scripts = extractInlineScripts(html);
    assert(scripts.length > 0, 'no inline <script> blocks found — extraction regex may need updating');
    for (const s of scripts) {
      // Throws SyntaxError on malformed JS. Doesn't execute the script.
      // eslint-disable-next-line no-new-func
      new Function(s);
    }
  });
}

// ── 4. Backup/restore: no plaintext API keys in the export list ───────────
function extractBackupKeys(html) {
  const m = html.match(/const BACKUP_KEYS = \[([\s\S]*?)\];/);
  assert(m, 'BACKUP_KEYS array not found');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}
for (const [label, file] of [['reader.html', READER], ['index.html', INDEX]]) {
  check(`${label}: BACKUP_KEYS excludes API keys, includes core progress data`, () => {
    const html = fs.readFileSync(file, 'utf8');
    const keys = extractBackupKeys(html);
    for (const secret of ['jb_el_key', 'jb_deepl_key']) {
      assert(!keys.includes(secret), `BACKUP_KEYS still includes ${secret} — this is a plaintext API key and shouldn't be in a shareable backup file`);
    }
    for (const required of ['jugalbandhi_progress', 'jb_annotations', 'jb_lang']) {
      assert(keys.includes(required), `BACKUP_KEYS is missing ${required} — backups would silently lose this`);
    }
  });
}
check('reader.html and index.html have identical BACKUP_KEYS', () => {
  const a = extractBackupKeys(fs.readFileSync(READER, 'utf8'));
  const b = extractBackupKeys(fs.readFileSync(INDEX, 'utf8'));
  assert(JSON.stringify(a) === JSON.stringify(b), `BACKUP_KEYS differ between the two files:\nreader.html: ${JSON.stringify(a)}\nindex.html:  ${JSON.stringify(b)}`);
});

// ── 5. Audio-pack download progress ring: geometry stays self-consistent ───
// stroke-dasharray must equal the circle's circumference (2*pi*r), or the
// ring will visually start/complete at the wrong point.
for (const [label, file] of [['reader.html', READER], ['index.html', INDEX]]) {
  check(`${label}: audio-pack progress ring dasharray matches its radius`, () => {
    const html = fs.readFileSync(file, 'utf8');
    const rMatch = html.match(/id="audio-pack-dl-progress"[^>]*\br="([\d.]+)"/);
    const dashMatch = html.match(/id="audio-pack-dl-progress"[^>]*stroke-dasharray="([\d.]+)"/);
    assert(rMatch && dashMatch, 'could not find the progress ring circle attributes');
    const r = parseFloat(rMatch[1]);
    const dash = parseFloat(dashMatch[1]);
    const expected = 2 * Math.PI * r;
    assert(Math.abs(dash - expected) < 0.01, `stroke-dasharray=${dash} but 2*pi*r(${r}) = ${expected.toFixed(3)}`);
    const circConst = html.match(/_AUDIO_PACK_RING_CIRC = ([\d.]+)/);
    assert(circConst, '_AUDIO_PACK_RING_CIRC constant not found');
    assert(Math.abs(parseFloat(circConst[1]) - expected) < 0.01, `_AUDIO_PACK_RING_CIRC=${circConst[1]} doesn't match the ring's actual circumference (${expected.toFixed(3)})`);
  });
}

// ── 6. Chapter nav-label format hasn't silently reverted ───────────────────
// This has been reworked ~6 times over the life of the project (brackets,
// parentheses, colon...). Just confirms the current "Chapter N: Title"
// colon format is still what getNavItemLabel produces.
for (const [label, file] of [['reader.html', READER], ['index.html', INDEX]]) {
  check(`${label}: getNavItemLabel still uses the "Chapter N: Title" format`, () => {
    const html = fs.readFileSync(file, 'utf8');
    const fnMatch = html.match(/function getNavItemLabel\(item\) \{[\s\S]*?\n\}/);
    assert(fnMatch, 'getNavItemLabel function not found');
    assert(/\$\{_ui\.chapter[^}]*\}\s*\$\{item\.num\}:\s*\$\{title\}/.test(fnMatch[0]),
      'getNavItemLabel no longer looks like `${chapter word} ${num}: ${title}` — nav label format may have regressed');
  });
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log('All checks passed.');
}
