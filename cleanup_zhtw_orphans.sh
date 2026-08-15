#!/bin/bash
# Removes 54 orphaned zh-tw audio files left over from before the
# _isQuoteChar corner-bracket fix (「」/『』) in tts-units.js. That fix
# corrected how split-speaker paragraphs are divided in zh-tw, which shifted
# the sequential unit numbering for every file after a split within the
# affected chapters (1, 5, 6, 7, 8, 10, 21, 22, 24, 25). The files below use
# the OLD numbering and are no longer referenced by the app — the current,
# correctly-numbered replacements were regenerated on 13 August 2026 and
# already exist under different filenames in the same folders.
#
# Verified via audit_zhtw.js: all 54 are absent from the current
# getChapterTTSUnits() output (i.e. genuinely orphaned, not still-in-use),
# and all 285 currently-expected files exist and are fresh. Safe to delete.
#
# Run this from anywhere; paths are absolute.

set -e

FILES="
zh-tw_ch01_p001_male.mp3
zh-tw_ch01_p003_female.mp3
zh-tw_ch01_p004_male.mp3
zh-tw_ch01_p005_female.mp3
zh-tw_ch01_p006_narrator.mp3
zh-tw_ch05_p004_narrator.mp3
zh-tw_ch05_p005_male.mp3
zh-tw_ch05_p006_female.mp3
zh-tw_ch05_p007_male.mp3
zh-tw_ch05_p008_female.mp3
zh-tw_ch05_p009_male.mp3
zh-tw_ch05_p010_female.mp3
zh-tw_ch06_p000_male.mp3
zh-tw_ch06_p002_female.mp3
zh-tw_ch06_p003_male.mp3
zh-tw_ch06_p004_narrator.mp3
zh-tw_ch06_p005_female.mp3
zh-tw_ch07_p030_female.mp3
zh-tw_ch08_p004_female.mp3
zh-tw_ch08_p005_male.mp3
zh-tw_ch08_p006_female.mp3
zh-tw_ch08_p007_male.mp3
zh-tw_ch08_p008_female.mp3
zh-tw_ch10_p001_narrator.mp3
zh-tw_ch10_p002_male.mp3
zh-tw_ch10_p003_female.mp3
zh-tw_ch10_p004_male.mp3
zh-tw_ch10_p005_female.mp3
zh-tw_ch10_p006_narrator.mp3
zh-tw_ch10_p007_male.mp3
zh-tw_ch10_p008_female.mp3
zh-tw_ch10_p009_male.mp3
zh-tw_ch10_p011_female.mp3
zh-tw_ch10_p012_narrator.mp3
zh-tw_ch10_p013_narrator.mp3
zh-tw_ch10_p014_narrator.mp3
zh-tw_ch21_p003_female.mp3
zh-tw_ch21_p004_narrator.mp3
zh-tw_ch22_p004_narrator.mp3
zh-tw_ch22_p005_narrator.mp3
zh-tw_ch24_p016_male.mp3
zh-tw_ch24_p017_female.mp3
zh-tw_ch24_p018_male.mp3
zh-tw_ch25_p006_female.mp3
zh-tw_ch25_p007_male.mp3
zh-tw_ch25_p008_narrator.mp3
zh-tw_ch25_p009_male.mp3
zh-tw_ch25_p011_female.mp3
zh-tw_ch25_p013_narrator.mp3
zh-tw_ch25_p014_male.mp3
zh-tw_ch25_p015_female.mp3
zh-tw_ch25_p016_narrator.mp3
zh-tw_ch25_p017_narrator.mp3
zh-tw_ch25_p019_female.mp3
"

DIRS="
/Users/rahilmundkur/code/jugalbandhi-self/audio/zh-tw
/Users/rahilmundkur/code/jugalbandhi-self/capacitor-project/audio-packs-android/audio_zh_tw/src/main/assets/audio/zh-tw
/Users/rahilmundkur/code/jugalbandhi-self/capacitor-project/ios/App/App/public/audio/zh-tw
"

removed=0
missing=0
for dir in $DIRS; do
  for f in $FILES; do
    [ -z "$f" ] && continue
    path="$dir/$f"
    if [ -f "$path" ]; then
      rm "$path"
      removed=$((removed+1))
    else
      missing=$((missing+1))
    fi
  done
done

echo "Done. Removed $removed files, $missing already absent (out of $((3*54)) possible)."
