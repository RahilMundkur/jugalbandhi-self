#!/usr/bin/env python3
"""
find-mood-cuts.py — Given a batch of audio files that had a mood-tag phrase
(e.g. "[hushed, epiphanic]") spoken aloud before the real sentence (a bug in
generate-el-tts.js / generate-thai-tts.js, since fixed), find the timestamp
in each file where the REAL sentence actually starts, so strip-mood-audio.js
can cut the mood-phrase portion off without re-running any TTS.

How it works (per file):
  1. Transcribe the audio with faster-whisper, word-level timestamps on,
     using the file's target language as a hint.
  2. Expand the transcript into a flat, normalized character stream, each
     character tagged with the start time of the whisper "word" it came
     from.
  3. Slide a window over that character stream looking for the best fuzzy
     match against the first ~40 normalized characters of the file's KNOWN
     real sentence (passed in via the manifest — this is u.text from
     tts-units.js, the actual paragraph text, not the mood tag).
  4. The window with the highest similarity marks where the real sentence
     begins; its timestamp (minus a small safety buffer) is the cut point.
     Character-level matching (rather than word-splitting) is used
     deliberately so the same logic works unchanged across space-delimited
     scripts (en/fr/es/hi) and non-space-delimited scripts (zh/zh-tw/th).
  5. If the best match's similarity is below --threshold, the file is
     reported with cut_seconds=null ("low confidence") instead of guessing —
     strip-mood-audio.js will leave those files untouched.

This deliberately does NOT try to detect where the mood phrase *ends* (that
phrase is always short English bracket-text spoken in a target-language
voice, so how it gets transcribed is unpredictable across languages/accents).
Instead it looks for where the *known-correct* real sentence starts, which is
a much more reliable anchor since it's comparing real target-language speech
against its own real transcript.

Usage:
  pip install faster-whisper --break-system-packages
  python3 find-mood-cuts.py --manifest manifest.json --out results.json [--model small] [--threshold 0.5]

manifest.json: JSON array of {"file": "<path>", "lang": "<whisper lang code>", "ref": "<real sentence text>"}
results.json:  JSON array of {"file", "cut_seconds", "confidence", "matched_snippet"} in the same order
"""

import argparse
import json
import re
import sys
import unicodedata

def normalize(s):
    # Case-fold, strip whitespace/punctuation. Keeping this script-agnostic:
    # works fine for Latin/Devanagari (whitespace-separated) and CJK/Thai
    # (no whitespace) alike since we compare at the character level.
    s = unicodedata.normalize('NFKC', s)
    s = s.casefold()
    s = re.sub(r'[\s.,!?;:"\'‘’“”—–()\[\]—–…]', '', s)
    return s

def best_match_start(transcript_chars, transcript_times, ref_norm, window_pad=20):
    """
    transcript_chars: normalized flat string of all transcribed characters
    transcript_times: parallel list, transcript_times[i] = start time (sec)
                       of the whisper word that produced transcript_chars[i]
    ref_norm: normalized reference string (start of the real sentence)
    Returns (best_start_index, best_ratio) using a simple sliding-window
    SequenceMatcher comparison. Pure-Python, no extra deps beyond stdlib.
    """
    import difflib
    n = len(ref_norm)
    if n == 0 or len(transcript_chars) == 0:
        return None, 0.0
    best_ratio = 0.0
    best_idx = None
    # Slide with a small stride for speed on long transcripts; refine near
    # the best coarse hit with a stride-1 pass.
    L = len(transcript_chars)
    coarse_stride = max(1, n // 4)
    candidates = range(0, max(1, L - 1), coarse_stride)
    coarse_best = []
    for i in candidates:
        window = transcript_chars[i:i + n + window_pad]
        ratio = difflib.SequenceMatcher(None, window[:n], ref_norm).ratio()
        coarse_best.append((ratio, i))
    coarse_best.sort(reverse=True)
    refine_around = [i for _, i in coarse_best[:5]]
    for center in refine_around:
        lo = max(0, center - coarse_stride)
        hi = min(L, center + coarse_stride)
        for i in range(lo, hi):
            window = transcript_chars[i:i + n]
            ratio = difflib.SequenceMatcher(None, window, ref_norm).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_idx = i
    return best_idx, best_ratio

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--manifest', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--model', default='small', help='faster-whisper model size (tiny/base/small/medium/large-v3). Bigger = more accurate, slower.')
    ap.add_argument('--threshold', type=float, default=0.5, help='minimum match ratio (0-1) to trust a cut point')
    ap.add_argument('--ref-chars', type=int, default=40, help='how many normalized chars of the real sentence to match against')
    ap.add_argument('--safety-buffer', type=float, default=0.06, help='seconds to subtract from the detected cut point so the real sentence is not clipped')
    args = ap.parse_args()

    with open(args.manifest, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    print(f'Loading faster-whisper model "{args.model}"... (first run downloads it, may take a while)', file=sys.stderr)
    from faster_whisper import WhisperModel
    model = WhisperModel(args.model, device='cpu', compute_type='int8')
    print(f'Model loaded. Processing {len(manifest)} files...', file=sys.stderr)

    results = []
    for idx, entry in enumerate(manifest):
        fpath = entry['file']
        lang  = entry['lang']
        ref   = entry['ref']
        ref_norm = normalize(ref)[:args.ref_chars]

        sys.stderr.write(f'  [{idx+1}/{len(manifest)}] {fpath} ... ')
        sys.stderr.flush()

        try:
            segments, _info = model.transcribe(fpath, language=lang, word_timestamps=True, vad_filter=False)
            transcript_chars = []
            transcript_times = []
            for seg in segments:
                words = getattr(seg, 'words', None) or []
                for w in words:
                    norm_word = normalize(w.word)
                    for ch in norm_word:
                        transcript_chars.append(ch)
                        transcript_times.append(w.start)
            transcript_chars = ''.join(transcript_chars)

            idx_match, ratio = best_match_start(transcript_chars, transcript_times, ref_norm)
            if idx_match is not None and ratio >= args.threshold:
                cut = max(0.0, transcript_times[idx_match] - args.safety_buffer)
                results.append({
                    'file': fpath,
                    'cut_seconds': round(cut, 3),
                    'confidence': round(ratio, 3),
                    'matched_snippet': ref[:60],
                })
                sys.stderr.write(f'cut={cut:.2f}s conf={ratio:.2f}\n')
            else:
                results.append({
                    'file': fpath,
                    'cut_seconds': None,
                    'confidence': round(ratio, 3) if idx_match is not None else 0.0,
                    'matched_snippet': ref[:60],
                })
                sys.stderr.write(f'LOW CONFIDENCE ({ratio if idx_match is not None else 0:.2f}) — skipping\n')
        except Exception as e:
            results.append({'file': fpath, 'cut_seconds': None, 'confidence': 0.0, 'error': str(e)})
            sys.stderr.write(f'ERROR: {e}\n')

        # Flush progress incrementally so a long run can be monitored / killed
        # without losing completed work.
        with open(args.out, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=2)

    print(f'\nDone. Results written to {args.out}', file=sys.stderr)

if __name__ == '__main__':
    main()
