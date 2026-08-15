#!/bin/bash
# Deletes stale pre-migration audio files that were left in place because
# their v3 regeneration failed (network drop / quota exhaustion) during the
# earlier --force run. Once removed, re-running generate-el-tts.js WITHOUT
# --force will regenerate exactly these files and skip everything already
# correct, without wasting credits re-doing good clips.
#
# Written for bash 3.2 (macOS default) — no associative arrays.
set -e
cd "$(dirname "$0")"

FILES_fr="fr_ch27_p001_narrator.mp3 fr_ch27_p002_narrator.mp3 fr_ch27_p003_narrator.mp3 fr_ch27_p004_narrator.mp3 fr_ch27_p005_narrator.mp3 fr_ch27_p006_narrator.mp3 fr_ch27_p007_narrator.mp3 fr_ch27_p008_narrator.mp3 fr_ch27_p009_narrator.mp3 fr_ch27_p010_narrator.mp3 fr_ch28_p000_narrator.mp3 fr_ch28_p001_narrator.mp3 fr_ch28_p002_narrator.mp3 fr_ch28_p003_narrator.mp3 fr_ch28_p004_narrator.mp3 fr_ch28_p005_narrator.mp3 fr_ch28_p006_narrator.mp3 fr_ch29_p000_narrator.mp3 fr_ch29_p001_narrator.mp3 fr_ch29_p002_narrator.mp3 fr_ch29_p003_narrator.mp3 fr_ch29_p004_narrator.mp3 fr_ch29_p005_narrator.mp3 fr_ch29_p006_narrator.mp3 fr_ch29_p007_narrator.mp3 fr_ch30_p000_narrator.mp3 fr_ch30_p001_narrator.mp3 fr_ch30_p002_narrator.mp3 fr_ch30_p003_male.mp3 fr_ch30_p004_narrator.mp3 fr_ch30_p005_narrator.mp3 fr_ch30_p006_male.mp3 fr_ch30_p007_narrator.mp3 fr_ch30_p008_narrator.mp3 fr_ch30_p009_narrator.mp3 fr_ch30_p010_narrator.mp3 fr_ch30_p011_narrator.mp3 fr_ch31_p000_narrator.mp3 fr_ch31_p001_narrator.mp3 fr_ch32_p000_female.mp3 fr_ch32_p001_female.mp3 fr_ch32_p002_female.mp3"

FILES_hi="hi_ch01_p007_narrator.mp3 hi_ch02_p000_male.mp3 hi_ch02_p002_narrator.mp3 hi_ch04_p012_narrator.mp3 hi_ch05_p001_male.mp3 hi_ch05_p006_male.mp3 hi_ch05_p007_female.mp3 hi_ch05_p011_female.mp3 hi_ch05_p025_female.mp3 hi_ch06_p000_female.mp3 hi_ch06_p005_narrator.mp3 hi_ch07_p004_female.mp3 hi_ch08_p003_female.mp3 hi_ch08_p006_male.mp3 hi_ch08_p007_female.mp3 hi_ch08_p008_male.mp3 hi_ch08_p009_female.mp3 hi_ch09_p002_narrator.mp3 hi_ch10_p000_female.mp3 hi_ch10_p001_male.mp3 hi_ch10_p002_narrator.mp3 hi_ch10_p006_female.mp3 hi_ch10_p009_female.mp3 hi_ch10_p015_narrator.mp3 hi_ch10_p016_narrator.mp3 hi_ch10_p017_narrator.mp3 hi_ch14_p001_female.mp3 hi_ch15_p003_female.mp3 hi_ch15_p007_female.mp3 hi_ch18_p000_narrator.mp3 hi_ch20_p000_male.mp3 hi_ch20_p001_female.mp3 hi_ch21_p002_female.mp3 hi_ch22_p001_female.mp3 hi_ch22_p003_male.mp3 hi_ch22_p010_narrator.mp3 hi_ch22_p011_narrator.mp3 hi_ch24_p001_male.mp3 hi_ch24_p003_male.mp3 hi_ch24_p016_female.mp3 hi_ch24_p018_female.mp3 hi_ch24_p021_female.mp3 hi_ch25_p005_female.mp3 hi_ch25_p009_narrator.mp3 hi_ch25_p012_female.mp3 hi_ch25_p019_narrator.mp3 hi_ch25_p020_narrator.mp3 hi_ch25_p021_female.mp3 hi_ch28_p005_narrator.mp3 hi_ch30_p002_narrator.mp3 hi_ch31_p000_narrator.mp3"

FILES_zh="zh_ch01_p007_narrator.mp3 zh_ch02_p000_male.mp3 zh_ch02_p002_narrator.mp3 zh_ch03_p000_narrator.mp3 zh_ch05_p001_male.mp3 zh_ch05_p005_narrator.mp3 zh_ch05_p006_male.mp3 zh_ch05_p012_male.mp3 zh_ch05_p020_male.mp3 zh_ch05_p025_female.mp3 zh_ch06_p000_female.mp3 zh_ch06_p005_narrator.mp3 zh_ch06_p006_female.mp3 zh_ch07_p019_male.mp3"

# Updated after the latest --force run: 17 of the original 19 stale zh-tw
# files actually got fixed (written under a new speaker-suffix filename,
# since the speaker label for those units changed since the old v2 audio
# was made — the old files are now harmless orphans, not read by the app).
# Only these 2 are still genuinely stale, cut off by the quota error.
FILES_zhtw="zh-tw_ch30_p006_male.mp3 zh-tw_ch31_p000_narrator.mp3"

cleanup_lang() {
  lang="$1"
  files="$2"
  n=0
  for f in $files; do
    rm -f "audio/$lang/$f"
    rm -f "capacitor-project/audio-packs-android/audio_${lang}/src/main/assets/audio/${lang}/$f"
    rm -f "capacitor-project/ios/App/App/public/audio/${lang}/$f"
    n=$((n+1))
  done
  echo "$lang: removed $n stale files"
}

cleanup_lang "fr" "$FILES_fr"
cleanup_lang "hi" "$FILES_hi"
cleanup_lang "zh" "$FILES_zh"
cleanup_lang "zh-tw" "$FILES_zhtw"

echo
echo "Done. Now run (without --force):"
echo 'caffeinate bash -c "node generate-el-tts.js --key YOUR_KEY --lang fr && node generate-el-tts.js --key YOUR_KEY --lang hi && node generate-el-tts.js --key YOUR_KEY --lang zh && node generate-el-tts.js --key YOUR_KEY --lang zh-tw"'
