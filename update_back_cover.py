"""
update_back_cover.py
────────────────────
Translates the new final paragraph of the reverse cover via DeepL
and updates index.html in place.

Run from the same folder as index.html:
    python3 update_back_cover.py

Requires: requests  (pip install requests)
"""

import json, re, sys
try:
    import requests
except ImportError:
    sys.exit("Please install requests first:  pip install requests")

# ── Config ────────────────────────────────────────────────────────────────────
API_KEY   = "5ddd04a9-8df0-4074-8150-8328ad7d881e"
API_URL   = "https://api.deepl.com/v2/translate"
HTML_FILE = "index.html"

NEW_PARA = (
    '\u201cJugalbandhi\u201d is an Indian term for an improvisatory musical '
    'to-and-fro between two skilled performers. In this case, the two '
    'protagonists are a man and a woman engaging in a profound and '
    'thought-provoking dialogue focused on fundamental spiritual Truth, '
    'thereby revealing its sweeping implications for living and being in '
    'the world.'
)

# App language code → DeepL target_lang code
LANG_MAP = {
    "es":    "ES",
    "fr":    "FR",
    "de":    "DE",
    "it":    "IT",
    "pt":    "PT-PT",
    "ru":    "RU",
    "zh":    "ZH-HANS",
    "zh-tw": "ZH-HANT",
    "ja":    "JA",
    "ko":    "KO",
    "ar":    "AR",
    "hi":    "HI",
    "nl":    "NL",
    "pl":    "PL",
    "sv":    "SV",
    "tr":    "TR",
    "id":    "ID",
    "uk":    "UK",
    "th":    "TH",
    "he":    "HE",
    "el":    "EL",
    "vi":    "VI",
    "mr":    "MR",   # Marathi
    "gu":    "GU",   # Gujarati
    "my":    "MY",   # Burmese
    "gom":   "KON",  # Konkani
    "sa":    "SA",   # Sanskrit
    "ur":    "UR",   # Urdu
    "fa":    "FA",   # Persian
    "ta":    "TA",   # Tamil
    "te":    "TE",   # Telugu
    "bn":    "BN",   # Bengali
    "ml":    "ML",   # Malayalam
    "pa":    "PA",   # Punjabi
    "ne":    "NE",   # Nepali
}

# ── Translate ─────────────────────────────────────────────────────────────────
def translate(text, target_lang):
    r = requests.post(
        API_URL,
        headers={"Authorization": f"DeepL-Auth-Key {API_KEY}",
                 "Content-Type": "application/json"},
        json={"text": [text], "target_lang": target_lang,
              "source_lang": "EN", "tag_handling": "html"},
        timeout=20
    )
    r.raise_for_status()
    return r.json()["translations"][0]["text"]

print("Reading index.html...")
with open(HTML_FILE, "r", encoding="utf-8") as f:
    content = f.read()

# Extract TRANSLATIONS JSON
m = re.search(r'(const TRANSLATIONS\s*=\s*)(\{.*?\})(;\s*\n)', content, re.DOTALL)
if not m:
    sys.exit("ERROR: Could not find TRANSLATIONS in index.html")

trans = json.loads(m.group(2))

skipped = []
updated = []
failed  = []

ONLY = ["gom"]  # Retry Konkani only

for app_lang, deepl_lang in LANG_MAP.items():
    if app_lang not in ONLY:
        skipped.append(app_lang)
        continue
    print(f"  Translating → {app_lang} ({deepl_lang})...", end=" ", flush=True)
    try:
        result = translate(NEW_PARA, deepl_lang)
        # Update key '3' in matter > back-cover for this language
        if app_lang not in trans:
            print(f"SKIP (lang not in TRANSLATIONS)")
            skipped.append(app_lang)
            continue
        if "matter" not in trans[app_lang]:
            trans[app_lang]["matter"] = {}
        if "back-cover" not in trans[app_lang]["matter"]:
            trans[app_lang]["matter"]["back-cover"] = {}
        trans[app_lang]["matter"]["back-cover"]["3"] = result
        updated.append(app_lang)
        print("✅")
    except Exception as e:
        print(f"❌ {e}")
        failed.append(app_lang)

# ── Write back ────────────────────────────────────────────────────────────────
print("\nWriting updated index.html...")
new_json   = json.dumps(trans, ensure_ascii=False, separators=(',', ':'))
new_content = content.replace(m.group(0),
    m.group(1) + new_json + m.group(3), 1)

with open(HTML_FILE, "w", encoding="utf-8") as f:
    f.write(new_content)

# ── Report ────────────────────────────────────────────────────────────────────
print(f"\n✅ Updated ({len(updated)}):  {', '.join(updated)}")
if skipped:
    print(f"⏭  Skipped ({len(skipped)}):  {', '.join(skipped)}")
if failed:
    print(f"❌ Failed  ({len(failed)}):  {', '.join(failed)}")
print("\nDone.")
