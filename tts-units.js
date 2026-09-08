// Ported verbatim (logic-for-logic) from reader.html's live speaker-detection
// system (_clean, _MV/_FV/_MA1/_FA1/_MA2/_FA2/_FA3/_I_RECV, _SPEAKER_OVERRIDE,
// _detectSpeaker) — the exact same code that decides speaker splits for the
// in-app "Listen" feature in any language, including Thai. getChapterTTSUnits()
// below replaces _getParas()'s DOM-reading front end (document.getElementById
// ('chapter-body').querySelectorAll('.para-wrap')) with plain iteration over a
// BOOK_DATA paragraphs array, but the inner algorithm — override resolution,
// quote-count boundary matching between English and translated text, and the
// unclosed-quote merge pass — is unchanged. This guarantees the same segment
// boundaries the app already produces live, instead of re-deriving split
// logic from scratch. Validated against the existing audio/th file set:
// 285/286 files matched exactly (same segment count, same speaker at every
// slot) across all 32 chapters — see thai_tts_review_FINAL.json.
//
// Used by generate-thai-tts.js for bulk Thai TTS regeneration.

function _clean(raw) {
  return raw
    .replace(/‘|’/g, "'")
    .replace(/“|”/g, '"')
    .replace(/—/g, ' — ')
    .replace(/(\d)\s*–\s*(\d)/g, '$1 to $2')
    .replace(/–/g, ' — ')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/\[\d+\]/g, '')
    // Bare inline endnote-reference digits (e.g. "exist5." / "ว่างเปล่า8") —
    // same pattern the app's own renderTransPara() uses to lift these into
    // <sup> for display, reused here to strip them instead so TTS doesn't
    // read the footnote number aloud. Requires no space before the digit
    // (footnote markers are always glued to the preceding word/punctuation,
    // unlike genuine numbers in prose), 1-2 digits, and not followed by
    // another digit or a CJK/Korean date suffix (year/month/day markers).
    .replace(/([^\s\d\-(])\d{1,2}(?=[^\d)年月日년월일]|$)/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// Recognizes a quote-mark character for the purposes of locating
// _SPEAKER_OVERRIDE split boundaries in TRANSLATED text (see
// getChapterTTSUnits below). Originally only checked "/“/” (straight and
// curly double quotes), which covers en/fr/hi/th/zh/es — but zh-tw commonly
// uses CJK corner-bracket quotes (「」, and occasionally 『』) instead, which
// were invisible to this check. That silently broke every _SPEAKER_OVERRIDE
// array-split whose translated paragraph used 「」 quotes: the boundary
// search would find zero quote characters, the proportional-position
// fallback would produce a degenerate (near-empty) slice for one side of the
// split, and that slice would get dropped by the `partText.length < 3`
// guard — collapsing a two-speaker split back into one unit voiced by the
// wrong speaker, and shifting every subsequent unit index in that chapter.
// Confirmed via full-book audit: 16 broken splits across 13 chapters, all
// zh-tw, zero in any other language.
function _isQuoteChar(ch) {
  return ch === '"' || ch === '“' || ch === '”' ||
         ch === '「' || ch === '」' || // 「 」
         ch === '『' || ch === '』';   // 『 』
}

const _MV = 'said|replied|countered|asked|answered|called|whispered|muttered|added|' +
            'continued|ventured|noted|observed|insisted|protested|admitted|conceded|declared|' +
            'stated|thought|pondered|wondered|mused|laughed|smiled|joked|sighed|returned|' +
            'yelled|cheered|enquired|exclaimed|groaned|beamed|breathed|repeated|pressed|' +
            'prompted|cried|murmured|shrugged|quipped|remarked|responded|grinned|teased|' +
            'affirmed|nodded|reflected|offered|proposed';
const _FV = 'said|replied|asked|answered|called|whispered|muttered|added|continued|noted|' +
            'observed|insisted|protested|admitted|conceded|declared|stated|smiled|laughed|' +
            'sighed|mused|suggested|invited|reasoned|explained|offered|acknowledged|expressed|' +
            'grinned|teased|quipped|remarked|affirmed|responded|nodded|reflected|returned|' +
            'prompted|pondered|wondered|shrugged';

const _MA1 = new RegExp('"[^"]*"\\s*[,.]?\\s*(?:\\w+\\s+){0,2}I\\s+(?:\\w+\\s+){0,2}(' + _MV + ')\\b', 'i');
const _FA1 = new RegExp('"[^"]*"\\s*[,.]?\\s*(?:\\w+\\s+){0,2}[Ss]he\\s+(?:\\w+\\s+){0,2}(' + _FV + ')\\b', 'i');
const _MA2 = new RegExp('\\bI\\s+(?:\\w+\\s+){0,2}(' + _MV + ')(?:\\s+\\w+){0,4}\\s*[,:]\\s*"', 'i');
const _FA2 = new RegExp('\\b[Ss]he\\s+(?:\\w+\\s+){0,2}(' + _FV + ')(?:\\s+\\w+){0,4}\\s*[,:]\\s*"', 'i');
const _FA3 = /\b[Ss]he\b[^".!?:]*:\s*"/;
const _I_RECV = /"[^"]*"\s*[,.]?\s*(?:\w+\s+){0,2}I\s+(?:\w+\s+){0,2}(heard|overheard|noticed)\b/i;

const _SPEAKER_OVERRIDE = {
  1: {
    1: [
      { speaker: 'female' },
      { text: 'I heard a voice', speaker: 'male' }
    ],
    2: 'male'
  },
  2: { 0: [
    { speaker: 'male' },
    { text: '"You must be still', speaker: 'female' }
  ]},
  4: {
    6: 'male',
    7: [
      { speaker: 'male' },
      { text: '"True,', speaker: 'female' }
    ],
    10: 'female', 11: 'female', 12: 'female', 13: 'female', 14: 'female'
  },
  5: {
    0: 'male',
    1: [
      { speaker: 'male' },
      { text: '"What happened?"', speaker: 'female' },
      { text: 'she asked', speaker: 'male' }
    ],
    2: 'male',
    4: [
      { speaker: 'male' },
      { text: '"The world is as it is', speaker: 'female' }
    ],
    6: [
      { speaker: 'female' },
      { text: 'She paused', speaker: 'male' },
      { text: '"You know', speaker: 'female' },
      { text: 'She looked', speaker: 'male' },
      { text: '"Why do you', speaker: 'female' }
    ],
    9: 'female', 11: 'female', 12: 'female',
    17: 'female', 18: 'female', 19: 'male',
    20: 'female', 21: 'female', 22: 'female', 23: 'male', 24: 'female'
  },
  6: {
    0: [
      { speaker: 'female' },
      { text: 'She must have been', speaker: 'male' }
    ],
    1: 'male',
    5: [
      { speaker: 'female' },
      { text: 'she mused', speaker: 'male' }
    ],
    7: 'female'
  },
  7: {
    22: [
      { speaker: 'male' },
      { text: '"Your suffering', speaker: 'female' }
    ],
    24: [
      { speaker: 'male' },
      { text: '"But all of these', speaker: 'female' }
    ],
    26: [
      { speaker: 'male' },
      { text: '"Go with the flow', speaker: 'female' }
    ],
    27: [
      { speaker: 'male' },
      { text: '"Let me ask you this:', speaker: 'female' }
    ],
    33: [
      { speaker: 'female' },
      { text: 'I was surprised', speaker: 'male' }
    ],
    34: [
      { speaker: 'male' },
      { text: '"If it soothes', speaker: 'female' }
    ]
  },
  8: {
    0: 'male',
    3: [
      { speaker: 'female' },
      { text: 'For a moment, she paused.', speaker: 'male' },
      { text: '"But what about', speaker: 'female' }
    ],
    6: [
      { speaker: 'male' },
      { text: '"I\'m glad', speaker: 'female' }
    ]
  },
  11: {
    0: 'male'
  },
  10: {
    0: [
      { speaker: 'female' },
      { text: 'she declared', speaker: 'male' }
    ],
    2: [
      { speaker: 'male' },
      { text: '"The mind knows', speaker: 'female' }
    ],
    9: [
      { speaker: 'female' },
      { text: 'My questioning', speaker: 'male' },
      { text: '"Men have it too,"', speaker: 'female' },
      { text: 'she smiled', speaker: 'male' },
      { text: '"Even if', speaker: 'female' }
    ]
  },
  17: {
    0: 'male',
    4: 'female'
  },
  20: {
    0: [
      { speaker: 'male' },
      { text: '"Can you sense', speaker: 'female' }
    ]
  },
  21: {
    7: [
      { speaker: 'female' },
      { text: 'I suspected Evangelical', speaker: 'male' }
    ],
    8: 'female'
  },
  22: {
    1: [
      { speaker: 'female' },
      { text: 'she suggested', speaker: 'male' }
    ],
    2: 'male',
    3: [
      { speaker: 'female' },
      { text: 'she invited', speaker: 'male' }
    ]
  },
  13: {
    0: 'male'
  },
  14: {
    0: 'male'
  },
  15: {
    0: 'male'
  },
  16: {
    0: 'male'
  },
  23: {
    0: 'male',
    3: 'female'
  },
  24: {
    0: 'male',
    1: [
      { speaker: 'male' },
      { text: '"I am open to love', speaker: 'female' }
    ],
    14: [
      { speaker: 'male' },
      { text: '"You know, there is immense', speaker: 'female' }
    ],
    16: 'female',
    18: [
      { speaker: 'female' },
      { text: 'she acknowledged', speaker: 'male' },
      { text: '"Focusing on', speaker: 'female' }
    ],
    21: [
      { speaker: 'female' },
      { text: 'she chuckled', speaker: 'male' },
      { text: '"Whilesoever', speaker: 'female' }
    ]
  },
  25: {
    1: 'female',
    8: 'male',
    5: [
      { speaker: 'female' },
      { text: 'she grinned', speaker: 'male' },
      { text: '"And yours?', speaker: 'female' }
    ],
    9: [
      { speaker: 'male' },
      { text: '"You are God incarnate', speaker: 'female' },
      { text: 'she insisted', speaker: 'male' }
    ],
    12: [
      { speaker: 'male' },
      { text: '"Just as a child', speaker: 'female' }
    ],
    16: 'female'
  },
  30: {
    3: 'male'
  },
  32: {
    0: 'female',
    1: 'female',
    2: 'female'
  }
};

function _detectSpeaker(text, lastKnown) {
  if (text.includes('"')) {
    if (_I_RECV.test(text)) return 'female';
    if (_MA1.test(text) || _MA2.test(text)) return 'male';
    if (_FA1.test(text) || _FA2.test(text) || _FA3.test(text)) return 'female';
  }
  if (text.startsWith('"')) return lastKnown === 'female' ? 'male' : 'female';
  return 'narrator';
}

// Ported from _getParas(). engParagraphs = ch.paragraphs (BOOK_DATA, raw
// strings, may include a trailing blank). transChapterObj =
// TRANSLATIONS[lang].chapters[String(chapterNum)] (object keyed by the SAME
// raw paragraph-array index as engParagraphs — verified against
// translate-book.js's indexing and confirmed chapter 1's one blank paragraph
// is trailing/last, so no index drift occurs for any chapter).
function getChapterTTSUnits(chapterNum, engParagraphs, transChapterObj) {
  const out = [];
  let lastSpeaker = 'male';
  let prevUnclosed = false;
  const chOverrides = _SPEAKER_OVERRIDE[chapterNum] || {};
  const _transParas = transChapterObj || null;

  engParagraphs.forEach((raw, paraIdx) => {
    const engText = _clean(raw || '');
    if (!engText) return; // mirrors DOM renderer skipping blank paragraphs
    const transText = _transParas ? _clean(_transParas[String(paraIdx)] || '') : '';
    const text = (transText.length >= 3) ? transText : engText;
    if (text.length < 3) return;

    const ovr = chOverrides[paraIdx];
    if (Array.isArray(ovr)) {
      const useTransSplit = (text !== engText && engText.length > 0);
      const splits = [];
      let engRemaining = engText;
      let engOffset = 0;
      ovr.forEach((part, i) => {
        if (part.text) {
          const start = engRemaining.indexOf(part.text);
          if (start < 0) return;
          engOffset += start;
          engRemaining = engRemaining.slice(start);
        }
        const nextMarker = ovr.slice(i + 1).find(p => p.text);
        let engPartLen;
        if (nextMarker) {
          const nextStart = engRemaining.indexOf(nextMarker.text);
          engPartLen = nextStart >= 0 ? nextStart : engRemaining.length;
        } else {
          engPartLen = engRemaining.length;
        }
        splits.push({ engStart: engOffset, engEnd: engOffset + engPartLen, speaker: part.speaker });
        engOffset += engPartLen;
        engRemaining = engRemaining.slice(engPartLen);
      });

      const _countQuotes = (str, end) => {
        let n = 0;
        const lim = Math.min(end, str.length);
        for (let ci = 0; ci < lim; ci++) { if (_isQuoteChar(str[ci])) n++; }
        return n;
      };
      const _findNthQuote = (str, n) => {
        if (n <= 0) return -1;
        let cnt = 0;
        for (let ci = 0; ci < str.length; ci++) {
          if (_isQuoteChar(str[ci])) {
            cnt++;
            if (cnt === n) return ci;
          }
        }
        return -1;
      };
      const _snapWord = (str, pos) => {
        if (pos <= 0) return 0;
        if (pos >= str.length) return str.length;
        let fwd = str.indexOf(' ', pos);
        let bwd = str.lastIndexOf(' ', pos);
        if (fwd < 0) fwd = str.length;
        if (bwd < 0) bwd = 0;
        return (fwd - pos) <= (pos - bwd) ? fwd + 1 : bwd + 1;
      };

      const transBoundaries = [0];
      for (let bi = 0; bi < splits.length - 1; bi++) {
        const engBoundary = splits[bi].engEnd;
        const engCharAtBoundary = engText[engBoundary] || '';
        const proportional = Math.round((engBoundary / engText.length) * text.length);
        let tBoundary;
        if (engCharAtBoundary === '“' || engCharAtBoundary === '"') {
          const prevBoundary = transBoundaries[transBoundaries.length - 1];
          const searchFrom = Math.max(prevBoundary, Math.round(proportional * 0.3));
          let qPos = -1;
          for (let ci = searchFrom; ci < text.length; ci++) {
            if (_isQuoteChar(text[ci])) { qPos = ci; break; }
          }
          tBoundary = (qPos >= 0) ? qPos : proportional;
        } else {
          const nQ = _countQuotes(engText, engBoundary);
          if (nQ > 0) {
            const qPos = _findNthQuote(text, nQ);
            tBoundary = (qPos >= 0) ? qPos + 1 : _snapWord(text, proportional);
          } else {
            tBoundary = _snapWord(text, proportional);
          }
        }
        transBoundaries.push(tBoundary);
      }
      transBoundaries.push(text.length);

      splits.forEach((sp, i) => {
        let partText;
        if (useTransSplit) {
          const tStart = transBoundaries[i];
          const tEnd = transBoundaries[i + 1];
          partText = text.slice(tStart, tEnd).trim();
        } else {
          partText = engText.slice(sp.engStart, sp.engEnd).trim();
        }
        if (partText.length < 3) return;
        if (sp.speaker !== 'narrator') lastSpeaker = sp.speaker;
        out.push({ text: partText, engText: engText.slice(sp.engStart, sp.engEnd).trim(), speaker: sp.speaker, paraIdx, splitFirst: i === 0 });
        prevUnclosed = engText.slice(sp.engStart, sp.engEnd).startsWith('"') && !engText.slice(sp.engStart, sp.engEnd).endsWith('"');
      });
    } else {
      let speaker;
      if (ovr) {
        speaker = ovr;
      } else if (prevUnclosed && engText.startsWith('"')) {
        speaker = lastSpeaker;
      } else {
        speaker = _detectSpeaker(engText, lastSpeaker);
      }
      if (speaker !== 'narrator') lastSpeaker = speaker;
      out.push({ text, engText, speaker, paraIdx });
      prevUnclosed = engText.startsWith('"') && !engText.endsWith('"');
    }
  });

  const merged = [];
  for (let i = 0; i < out.length; i++) {
    const cur = out[i];
    if (merged.length > 0) {
      const prev = merged[merged.length - 1];
      const prevEndsUnclosed = (prev.engText || prev.text).startsWith('"') && !(prev.engText || prev.text).endsWith('"');
      const EL_CHAR_LIMIT = 4800;
      if (prev.speaker === cur.speaker && prevEndsUnclosed && (cur.engText || cur.text).startsWith('"') &&
          !cur.splitFirst &&
          prev.text.length + cur.text.length + 2 <= EL_CHAR_LIMIT) {
        prev.text += '\n\n' + cur.text;
        continue;
      }
    }
    merged.push({ ...cur });
  }
  return merged;
}

module.exports = { getChapterTTSUnits, _clean, _SPEAKER_OVERRIDE, _detectSpeaker };

// ── Mood map ─────────────────────────────────────────────────────────────────
// Keyed by chapter number → TTS unit index (same zero-based index as the "pNNN"
// in the output filename). Values are short bracketed mood/style hints that are
// prepended to the TTS text before sending to ElevenLabs or Google TTS.
// Format: '[mood]' — e.g. '[hushed, epiphanic]'.
// Split units (Array overrides in _SPEAKER_OVERRIDE) use sub-indices a, b, c…
// stored as strings: e.g. '0a', '0b'.
// If a unit has no entry here, no prefix is added (defaults to base style).
const _MOOD_MAP = {
  1: {
    0:  '[mysterious, ethereal, loudly calling out to Ishwar, slow, deliberate]',
    1:  '[calm, reflective, softly calling out to Ishwar, slow, deliberate]',
    2:  '[cautious, wary]',
    3:  '[gentle, knowing]',
    4:  '[assertive]',
    5:  '[serene, profound]',
    6:  '[unsettled, dismissive]',
  },
  2: {
    '0a': '[calm, open]',
    '0b': '[gentle, earnest]',
    1:    '[quiet, contemplative]',
  },
  3: {
    0: '[warm, uplifted]',
    1: '[reflective, awed]',
  },
  4: {
    0:  '[conversational]',
    1:  '[gentle, philosophical]',
    2:  '[matter-of-fact]',
    3:  '[calm, clarifying]',
    4:  '[genuinely curious]',
    5:  '[warm, encouraging]',
    6:  '[bewildered]',
    7:  '[thoughtful, precise]',
    8:  '[sceptical]',
    9:  '[gently playful, then profound]',
    10: '[earnest, illuminating]',
    11: '[deeply philosophical]',
    12: '[clear, incisive]',
    13: '[compassionate]',
    14: '[inspiring, warm]',
    15: '[uneasy, defensive]',
    16: '[wry, self-aware]',
  },
  5: {
    0:   '[nostalgic, slightly sheepish]',
    '1a': '[braced, then surprised]',
    '1b': '[warmly curious]',
    2:   '[rueful]',
    3:   '[amused, warm]',
    4:   '[earnest, serious]',
    5:   '[sincere, concerned]',
    '6a': '[probing]',
    '6b': '[direct]',
    7:   '[humbled, contrite]',
    8:   '[firm, compassionate]',
    9:   '[encouraging, wise]',
    10:  '[vulnerable, confessional]',
    11:  '[affirming, strong]',
    12:  '[calm, authoritative]',
    13:  '[pushing back]',
    14:  '[cautionary]',
    15:  '[determined]',
    16:  '[gently challenging]',
    17:  '[gentle, liberating]',
    18:  '[tender, freeing]',
    19:  '[conflicted]',
    20:  '[warm, reassuring]',
    21:  '[peaceful, inviting]',
    22:  '[serene]',
    23:  '[troubled, resistant]',
    24:  '[tender, transcendent]',
  },
  6: {
    '0a': '[softly reassuring]',
    '0b': '[sheepish]',
    1:   '[self-deprecating]',
    2:   '[gently correcting]',
    3:   '[wry, slightly combative]',
    4:   '[warm, admiring]',
    '5a': '[musing, quiet]',
    '5b': '[neutral narrator]',
    6:   '[calm, instructive]',
    7:   '[earnest, liberating]',
    8:   '[clear, decisive]',
  },
  7: {
    0:   '[gently concerned]',
    1:   '[heavy, confessional]',
    2:   '[firm but kind]',
    3:   '[flat, defensive]',
    4:   '[measured, wise]',
    5:   '[anguished, raw]',
    6:   '[matter-of-fact, bracing]',
    7:   '[disbelieving]',
    8:   '[clear, instructive]',
    9:   '[earnest, burdened]',
    10:  '[perceptive, wry]',
    11:  '[despairing]',
    12:  '[grave, urgent]',
    13:  '[stubborn, pained]',
    14:  '[warm, compassionate]',
    15:  '[encouraging]',
    16:  '[incisive, frank]',
    17:  '[calm, clarifying]',
    18:  '[direct, bracing]',
    19:  '[gentle, practical]',
    20:  '[liberating, firm]',
    21:  '[compassionate, freeing]',
    22:  '[consoling, tender]',
    23:  '[gentle, urging]',
    24:  '[sighing, resolved]',
    25:  '[profound, healing]',
    26:  '[peaceful, flowing]',
    27:  '[quiet narrator]',
    '27b': '[thoughtful]',
    28:  '[tentative, hopeful]',
    29:  '[affirming]',
    30:  '[quietly realising]',
    31:  '[warm, brief]',
    32:  '[fragile, hopeful]',
    33:  '[warm, triumphant]',
    '33b': '[moved, reflective]',
    34:  '[tender, smiling]',
  },
  8: {
    0:   '[playful, epiphanic]',
    1:   '[musing, gentle]',
    2:   '[light, wondering]',
    '3a': '[joyful]',
    '3b': '[curious]',
    4:   '[innocent, pondering]',
    5:   '[quietly suggestive]',
    '6a': '[puzzled]',
    '6b': '[warm, redirecting]',
  },
  9: {
    0: '[wrestling, searching]',
    1: '[contemplative, unfolding]',
    2: '[doubtful, careful]',
    3: '[honest, unresolved]',
  },
  10: {
    '0a': '[perceptive, direct]',
    '0b': '[quiet narrator]',
    '2a': '[curious, uncertain]',
    '2b': '[illuminating, building]',
    3:   '[honest, hesitant]',
    4:   '[intimate, sincere]',
    5:   '[quiet, assured]',
    6:   '[reflective, musing]',
    7:   '[genuinely curious]',
    8:   '[calm, knowing]',
    '9a': '[warm, gently teasing]',
    '9b': '[quiet narrator]',
    '9c': '[warm]',
    10:  '[urgent, encouraging]',
    11:  '[firm, clear]',
    12:  '[reflective, explaining]',
    13:  '[philosophical, deepening]',
    14:  '[quietly resolved]',
  },
  11: {
    0:  '[despondent, hollow]',
    1:  '[concerned, perceptive]',
    2:  '[probing, philosophical]',
    3:  '[calm, inviting]',
    4:  '[liberating, grounded]',
    5:  '[empathetic, firm]',
    6:  '[profound, expansive]',
    7:  '[cautionary, observational]',
    8:  '[reflective, inclusive]',
    9:  '[warm, building to transcendent]',
    10: '[empowering, practical]',
    11: '[gentle, pointing inward]',
  },
  12: {
    0: '[sceptical, challenging]',
    1: '[measured, reassuring]',
    2: '[empowering, clear]',
    3: '[vast, awe-inspiring]',
  },
  13: {
    0: '[tentative, probing]',
    1: '[warm, intimate]',
    2: '[quietly searching]',
    3: '[firm, assured]',
    4: '[thoughtful, cautionary]',
    5: '[guiding, clear]',
    6: '[devotional, serene]',
  },
  14: {
    0: '[genuinely puzzled]',
    1: '[philosophical, measured]',
    2: '[grave, explanatory]',
    3: '[solemn, clarifying]',
  },
  15: {
    0:  '[tentative, exploring]',
    1:  '[gently permissive]',
    2:  '[confused, honest]',
    3:  '[patient, clarifying]',
    4:  '[concerned]',
    5:  '[reassuring, then expansive]',
    6:  '[genuinely awed]',
    7:  '[majestic, calm]',
    8:  '[stunned]',
    9:  '[grounding, practical]',
    10: '[testing, persistent]',
    11: '[measured, thoughtful]',
    12: '[evocative, building]',
    13: '[serene, detached]',
    14: '[curious, expectant]',
    15: '[wondrous, expansive]',
    16: '[wry, humble]',
  },
  16: {
    0:  '[curious, direct]',
    1:  '[expansive, building]',
    2:  '[genuinely wondering]',
    3:  '[assured, illuminating]',
    4:  '[intimate, encouraging]',
    5:  '[practical, warm]',
    6:  '[sweeping, empowering]',
    7:  '[precise, instructive]',
    8:  '[sceptical, wrestling]',
    9:  '[gently correcting]',
    10: '[honestly puzzled]',
    11: '[clear, empowering]',
    12: '[grounding, liberating]',
    13: '[sobering, empowering]',
    14: '[gentle, instructive]',
    15: '[warm, revelatory]',
    16: '[excited, hopeful]',
    17: '[calm, transcendent]',
  },
  17: {
    0: '[genuinely puzzled]',
    1: '[patient, clarifying]',
    2: '[serene, transcendent]',
    3: '[tender, homecoming]',
    4: '[grounding, resolved]',
  },
  18: {
    0: '[quietly awed, tender]',
  },
  19: {
    0: '[detached, luminous]',
    1: '[still, observational]',
    2: '[quietly astonished]',
  },
  20: {
    '0a': '[quiet narrator]',
    '0b': '[challenging, inviting]',
  },
  21: {
    0:  '[ominous narrator]',
    1:  '[grave, measured]',
    2:  '[clear, emphatic]',
    3:  '[observational, compassionate]',
    4:  '[firm, instructive]',
    5:  '[cautionary, serious]',
    6:  '[vast, wrestling with words]',
    7:  '[urgent, clarifying]',
    '7b': '[quiet narrator]',
    8:  '[stern, warning]',
    9:  '[clear, decisive]',
    10: '[devotional, commanding]',
    11: '[shaken, subdued]',
  },
  22: {
    0:  '[curious, eager]',
    '1a': '[warm, playful]',
    '1b': '[quiet narrator]',
    2:  '[surprised, tentative]',
    '3a': '[gently teasing]',
    '3b': '[quiet narrator]',
    4:  '[careful, settling]',
    5:  '[quietly reflective]',
    6:  '[hushed, overwhelmed with wonder]',
    7:  '[awestruck, overflowing with love]',
    8:  '[wistful, grateful]',
    9:  '[yearning, bittersweet]',
  },
  23: {
    0: '[clingy, self-aware]',
    1: '[gentle, observant]',
    2: '[rueful, self-conscious]',
    3: '[calm, clarifying]',
    4: '[resistant, honest]',
    5: '[warm, liberating]',
  },
  24: {
    0:    '[curious, tentative]',
    '1a': '[curious, tentative narrator]',
    '1b': '[considered, serene]',
    2:    '[admiring, observational]',
    3:    '[peaceful, candid]',
    4:    '[reflective, pragmatic]',
    5:    '[probing, unsettled]',
    6:    '[honest, sobering]',
    7:    '[disillusioned, searching]',
    8:    '[warm, hopeful]',
    9:    '[probing, profound]',
    10:   '[softly realising]',
    11:   '[warm, quiet]',
    12:   '[thoughtful, testing]',
    13:   '[gentle, perceptive]',
    14:   '[wry, honest]',
    15:   '[rueful, understanding]',
    16:   '[empathetic, candid]',
    17:   '[tentative, searching]',
    '17b': '[gently prompting]',
    '18a': '[measured, wise]',
    '18b': '[quiet narrator]',
    '18c': '[measured, wise]',
    19:   '[searching, clarifying]',
    20:   '[reflective, nuanced]',
    '21a': '[warmly humorous]',
    '21b': '[gently firm]',
    22:   '[wistful, longing]',
    23:   '[quietly reverent]',
    24:   '[warm, flowing]',
    25:   '[mythic, expansive]',
    26:   '[balancing, practical]',
    27:   '[philosophical, resolving]',
    28:   '[wistfully curious]',
    29:   '[gently correcting, playful]',
    30:   '[intimate, beckoning]',
    31:   '[profound, encouraging]',
    32:   '[serene, conclusive]',
  },
  25: {
    0:    '[light, amused]',
    1:    '[simple, warm]',
    2:    '[curious]',
    3:    '[quietly pleased]',
    4:    '[playfully teasing]',
    '5a': '[grinning, playful]',
    '5b': '[teasing]',
    6:    '[quiet, slightly self-conscious]',
    7:    '[warm narrator]',
    8:    '[rueful, self-deprecating]',
    '9a': '[quiet narrator]',
    '9b': '[earnest, insistent]',
    '9c': '[quiet narrator]',
    10:   '[profound, tender]',
    11:   '[reflective, pondering]',
    '12a': '[quiet narrator]',
    '12b': '[illuminating, parallel]',
    13:   '[contemplative]',
    14:   '[troubled, thoughtful]',
    15:   '[wry, resigned]',
    16:   '[clear, grounding]',
    17:   '[warm, homecoming]',
    18:   '[humble, inviting]',
  },
  26: {
    0: '[admiring, reverent]',
    1: '[tender, awed]',
    2: '[insecure, yearning]',
    3: '[self-aware, resolving]',
  },
  27: {
    0:  '[bereft, hollow]',
    1:  '[confessional, wondering]',
    2:  '[restless, longing]',
    3:  '[bittersweet, aching]',
    4:  '[tormented, self-loathing]',
    5:  '[defeated, spiralling]',
    6:  '[raw, passionate, desperate]',
    7:  '[self-scorning, exhausted]',
    8:  '[nostalgic, sorrowful]',
    9:  '[quietly grieving]',
    10: '[resolving, determined]',
  },
  28: {
    0: '[descriptive, vivid]',
    1: '[observational, gentle]',
    2: '[peaceful, yearning]',
    3: '[meditative, ritualistic]',
    4: '[vivid, physical]',
    5: '[reflective, resolved]',
    6: '[steady, hopeful]',
  },
  29: {
    0: '[dismissive, restless]',
    1: '[hushed, epiphanic]',
    2: '[quietly awakening]',
    3: '[settled, practising]',
    4: '[deepening, reverent]',
    5: '[waking up, humbled]',
    6: '[liberated, clear]',
    7: '[renewed, determined]',
  },
  30: {
    0:  '[calm, transformed]',
    1:  '[warm, appreciative]',
    2:  '[peaceful, meditative]',
    3:  '[tearful, cathartic]',
    4:  '[trembling with anticipation]',
    5:  '[breathless, joyful]',
    6:  '[jubilant, rushing]',
    7:  '[elated, overwhelmed]',
    8:  '[warm, content]',
    9:  '[blissful, transcendent]',
    10: '[overflowing, grateful]',
    11: '[bittersweet, accepting]',
    12: '[tender, homecoming]',
  },
  31: {
    0: '[still, open, expectant]',
    1: '[quietly hopeful, wistful]',
  },
  32: {
    0: '[profound, direct, luminous]',
    1: '[calm, clarifying]',
    2: '[serene, transcendent, closing]',
  },
};

module.exports.getMood = function(chapterNum, unitIdx) {
  const chMap = _MOOD_MAP[chapterNum];
  if (!chMap) return '';
  const mood = chMap[unitIdx];
  return mood || '';
};
