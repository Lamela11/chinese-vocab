"""
vocab.py - checks the word lists in units/ (one folder per unit, and my-words for My words, the
words you add yourself) and keeps units/index.json up to date.

    python tools/vocab.py check          # check every unit and My words
    python tools/vocab.py check 6        # check one unit
    python tools/vocab.py check mine     # check My words
    python tools/vocab.py index          # rebuild units/index.json (word counts and versions)

The check makes sure every word has its fields, that no number is missing in a list, that the
pinyin only uses real pinyin letters (OCR look-alikes such as ã or ɑ are caught), compares the
pinyin with pypinyin, and compares the list with the book's 生词总表 (read by book.py glossary).
Differences are only reported: the page image decides, not pypinyin or OCR.

My words (units/my-words/words.json) have ids m1, m2, ... and no book fields (text, page, tag),
but the date they were added. Their English mustn't have Chinese in it: it's the front of a card.
The check also says which of them are in a unit already, or in the 生词总表 for a later unit: when
the hanzi and pinyin are the same, the app counts them as one word, with one history.

Run it with the second brain's Python (it has pypinyin).
"""

import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UNITS = ROOT / "units"
MINE = UNITS / "my-words" / "words.json"
sys.path.insert(0, str(Path(__file__).resolve().parent))

TEXTS = {"课文一", "课文二", "课文三", "补充词语"}
TAGS = {"word", "name", "extra"}
TONES = {}
for base, marked in {"a": "āáǎà", "e": "ēéěè", "i": "īíǐì", "o": "ōóǒò", "u": "ūúǔù", "ü": "ǖǘǚǜ"}.items():
    for tone, char in enumerate(marked, 1):
        TONES[char] = (base, tone)
PINYIN_CHARS = set("abcdefghijklmnopqrstuvwxyzü") | set(TONES) | set(" '’()")
CJK = re.compile(r"^[㐀-鿿]+$")
ID = re.compile(r"^(\d+)-(\d+)-(n?)(\d+)([a-z]?)$")
MINE_ID = re.compile(r"^m\d+$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def unit_files():
    return sorted(UNITS.glob("unit-*/words.json"))


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def norm(pinyin):
    """Lowercase pinyin without spaces or apostrophes, tone marks kept: "Bú kèqi" -> "búkèqi"."""
    return re.sub(r"[\s'’\-]", "", unicodedata.normalize("NFC", pinyin).lower())


def toneless(syllable):
    return "".join(TONES.get(c, (c, 0))[0] for c in syllable)


def tone(syllable):
    return next((TONES[c][1] for c in syllable if c in TONES), 0)


def forms(pinyin):
    """The main reading and any alternatives in brackets: "shéi (shuí)" -> ["shéi", "shuí"]."""
    main = re.sub(r"\s*\(.*?\)", "", pinyin).strip()
    return [main] + re.findall(r"\(\s*([^)]+?)\s*\)", pinyin)


# --- pypinyin -------------------------------------------------------------------

def py_syllables(hanzi, sandhi=False):
    from pypinyin import Style, pinyin
    try:
        result = pinyin(hanzi, style=Style.TONE, heteronym=False, tone_sandhi=sandhi)
    except TypeError:  # an old pypinyin without tone_sandhi
        result = pinyin(hanzi, style=Style.TONE, heteronym=False)
    return [norm(r[0]) for r in result]


def sandhi(hanzi, syllables, i):
    """The tone the book prints for 一 or 不 at position i when it marks the tone change, or None."""
    if hanzi[i] not in "一不" or i + 1 >= len(syllables):
        return None
    following = tone(syllables[i + 1])
    if hanzi[i] == "一" and following:
        return 2 if following == 4 else 4
    return 2 if hanzi[i] == "不" and following == 4 else None


def compare_pinyin(word):
    """How the book's pinyin compares with pypinyin: ("same", "") or (kind, explanation).
    Kinds: "tone change" (the book marks the tone change of 一/不, as it does), "neutral tone"
    (one side has a neutral tone, the other a full tone) and "differs" (look at the page again)."""
    readings = [norm(f) for f in forms(word["pinyin"])]
    plain = py_syllables(word["hanzi"])
    if "".join(plain) in readings:
        return "same", ""
    book = readings[0]
    if toneless(book) != toneless("".join(plain)):
        return "differs", f"pypinyin: {' '.join(plain)}"
    notes, kinds, start = [], set(), 0
    for i, (hanzi, syllable) in enumerate(zip(word["hanzi"], plain)):
        mine = book[start:start + len(syllable)]
        start += len(syllable)
        if mine == syllable:
            continue
        if tone(mine) and tone(mine) == sandhi(word["hanzi"], plain, i):
            kinds.add("tone change")
            notes.append(f"{hanzi}: book {mine} (tone change marked), pypinyin {syllable}")
        elif not tone(mine) or not tone(syllable):
            kinds.add("neutral tone")
            notes.append(f"{hanzi}: book {mine}{' (neutral)' if not tone(mine) else ''}, "
                         f"pypinyin {syllable}{' (neutral)' if not tone(syllable) else ''}")
        else:
            kinds.add("differs")
            notes.append(f"{hanzi}: book {mine}, pypinyin {syllable}")
    kind = "differs" if "differs" in kinds else " + ".join(sorted(kinds))
    return kind, "; ".join(notes)


# --- the checks -----------------------------------------------------------------

def check_unit(path, glossary=None):
    """Problems (must fix) and notes (look at the page image) for one unit file."""
    data = load(path)
    unit, words = data.get("unit"), data.get("words", [])
    problems, notes = [], []
    if not (isinstance(unit, int) and path.parent.name == f"unit-{unit:02d}"):
        problems.append(f"the folder {path.parent.name} doesn't match unit {unit!r}")
    for key in ("title", "en"):
        if not data.get(key):
            problems.append(f"the unit has no {key}")
    ids = [w.get("id") for w in words]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        problems.append(f"{dup}: id used twice")
    lists = {}
    for w in words:
        wid = w.get("id", "?")
        m = ID.match(wid)
        if not m or int(m.group(1)) != unit:
            problems.append(f"{wid}: id should look like {unit}-4-12, {unit}-4-12a or {unit}-4-n1")
            continue
        label, is_name, number, sub = m.group(2), m.group(3), int(m.group(4)), m.group(5)
        lists.setdefault((label, "names" if is_name else "words"), {}).setdefault(number, []).append(sub)
        for key in ("hanzi", "pinyin", "en", "text", "page", "tag"):
            if w.get(key) in (None, ""):
                problems.append(f"{wid}: no {key}")
        if not CJK.match(w.get("hanzi", "")):
            problems.append(f"{wid}: hanzi {w.get('hanzi')!r} isn't only Chinese characters")
        odd = sorted(set(unicodedata.normalize("NFC", w.get("pinyin", "")).lower()) - PINYIN_CHARS)
        if any(unicodedata.normalize("NFC", str(w.get(k, ""))) != str(w.get(k, "")) for k in ("hanzi", "pinyin", "en")):
            problems.append(f"{wid}: text isn't in Unicode NFC form (tone marks typed as two characters)")
        if odd:
            problems.append(f"{wid} {w.get('hanzi')}: pinyin {w.get('pinyin')!r} has characters that aren't pinyin: {' '.join(odd)}")
        if w.get("text") not in TEXTS:
            problems.append(f"{wid}: text {w.get('text')!r} should be one of {', '.join(sorted(TEXTS))}")
        if w.get("tag") not in TAGS:
            problems.append(f"{wid}: tag {w.get('tag')!r} should be word, name or extra")
        if (w.get("tag") == "extra") != (w.get("text") == "补充词语"):
            problems.append(f"{wid}: extras (tag extra) and 补充词语 go together")
        if (w.get("tag") == "name") != bool(is_name):
            problems.append(f"{wid}: names have ids with n (like {unit}-4-n1) and tag name")
        if "person" in w and (w["person"] is not True or w.get("tag") != "name"):
            problems.append(f"{wid}: \"person\": true marks people's names (tag name) only")
        if sub and w.get("parent") != wid[:-1]:
            problems.append(f"{wid}: a sub-entry needs \"parent\": \"{wid[:-1]}\"")
        if not sub and "parent" in w:
            problems.append(f"{wid}: only sub-entries (ids ending in a, b, ...) have a parent")
        for pair in w.get("mw", []):
            if len(pair) != 2 or not CJK.match(pair[0]) or not pair[1]:
                problems.append(f"{wid}: measure words look like [\"本\", \"běn\"], not {pair!r}")
        if not odd and CJK.match(w.get("hanzi", "")):
            for form in forms(w["pinyin"])[1:]:
                if toneless(norm(form)) != toneless("".join(py_syllables(w["hanzi"]))):
                    notes.append(f"{wid} {w['hanzi']}: alternative reading {form!r} isn't a pypinyin reading")
    for (label, kind), numbers in sorted(lists.items(), key=lambda kv: (int(kv[0][0]), kv[0][1])):
        missing = sorted(set(range(1, max(numbers) + 1)) - set(numbers))
        if missing:
            problems.append(f"list {unit}-{label} ({kind}): number(s) {', '.join(map(str, missing))} missing")
        for number, subs in numbers.items():
            letters = sorted(s for s in subs if s)
            if "" not in subs:
                problems.append(f"list {unit}-{label}: sub-entries of {number} without the main entry")
            if letters != [chr(ord("a") + i) for i in range(len(letters))]:
                problems.append(f"list {unit}-{label}: sub-entries of {number} should be a, b, ... ({letters})")
    pages = sorted({w.get("page") for w in words if isinstance(w.get("page"), int)})
    for w in words:
        if not CJK.match(w.get("hanzi", "")) or set(unicodedata.normalize("NFC", w.get("pinyin", "")).lower()) - PINYIN_CHARS:
            continue
        kind, why = compare_pinyin(w)
        if kind != "same":
            notes.append(f"pinyin {kind}: {w['id']} {w['hanzi']} {w['pinyin']}: {why}")
    if glossary is not None:
        notes += compare_glossary(unit, words, glossary)
    return data, problems, notes, pages


def compare_glossary(unit, words, glossary):
    """The 生词总表 lists 生词 and, at the end, 专名, each with the unit(s) it's in. Report rows it gives
    for this unit that aren't in its lists, and words or names of this unit it doesn't give for it."""
    out = []
    for section, tag in (("生词", "word"), ("专名", "name")):
        mine = {w["hanzi"] for w in words if w.get("tag") == tag}
        elsewhere = {w["hanzi"]: w["tag"] for w in words if w.get("tag") != tag}
        rows = [r for r in glossary if r["section"] == section]
        found = {}
        for row in rows:
            found.setdefault(re.sub(r"[（）()…]", "", row["hanzi"]), []).append(row)
        for row in rows:
            key = re.sub(r"[（）()…]", "", row["hanzi"])
            if unit in row["units"] and key not in mine:
                where = f" (it's in this unit as {elsewhere[key]})" if key in elsewhere else ""
                out.append(f"{section}: 生词总表 row {row['id']} (PDF p.{row['page']}) gives ({unit}) for "
                           f"{row['text']!r}, which isn't in this unit's {section}{where}")
        for hanzi in sorted(mine):
            if not any(unit in r["units"] for r in found.get(hanzi, [])):
                seen = "; ".join(f"row {r['id']} says {tuple(r['units'])}" for r in found.get(hanzi, []))
                out.append(f"{section}: {hanzi} isn't given ({unit}) in the 生词总表 ({seen or 'OCR found no row for it'})")
    return out


def check_mine(path, units, glossary=None):
    """Problems and notes for My words. units: every unit's data, to say which words are in one."""
    data = load(path)
    words = data.get("words", [])
    problems, notes = [], []
    for key in ("title", "en"):
        if not data.get(key):
            problems.append(f"My words have no {key}")
    ids = [w.get("id") for w in words]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        problems.append(f"{dup}: id used twice")
    in_units = {}
    for unit in units:
        for w in unit["words"]:
            in_units.setdefault(w["hanzi"], []).append((unit["unit"], w))
    seen = {}
    for w in words:
        wid, hanzi, pinyin = w.get("id", "?"), w.get("hanzi", ""), w.get("pinyin", "")
        if not MINE_ID.match(str(wid)):
            problems.append(f"{wid}: ids in My words look like m1, m2, m3, ...")
        for key in ("hanzi", "pinyin", "en", "added"):
            if w.get(key) in (None, ""):
                problems.append(f"{wid}: no {key}")
        if not CJK.match(hanzi):
            problems.append(f"{wid}: hanzi {hanzi!r} isn't only Chinese characters")
        odd = sorted(set(unicodedata.normalize("NFC", pinyin).lower()) - PINYIN_CHARS)
        if odd:
            problems.append(f"{wid} {hanzi}: pinyin {pinyin!r} has characters that aren't pinyin: {' '.join(odd)}")
        if any(unicodedata.normalize("NFC", str(w.get(k, ""))) != str(w.get(k, "")) for k in ("hanzi", "pinyin", "en")):
            problems.append(f"{wid}: text isn't in Unicode NFC form (tone marks typed as two characters)")
        if re.search(r"[㐀-鿿]", str(w.get("en", ""))):
            problems.append(f"{wid}: the English has Chinese in it, which would give the answer away on a card")
        if w.get("added") and not DATE.match(str(w["added"])):
            problems.append(f"{wid}: added {w['added']!r} should be a date like 2026-10-29")
        if not CJK.match(hanzi) or odd:
            continue
        key = (hanzi, norm(forms(pinyin)[0]))
        if key in seen:
            problems.append(f"{wid} {hanzi}: the same word as {seen[key]}")
        seen.setdefault(key, wid)
        kind, why = compare_pinyin(w)
        if kind != "same":
            notes.append(f"pinyin {kind}: {wid} {hanzi} {pinyin}: {why}")
        for number, other in in_units.get(hanzi, []):
            same = norm(forms(other["pinyin"])[0]) == key[1]
            notes.append(f"{wid} {hanzi}: also in Unit {number} as {other['id']} {other['pinyin']}"
                         + ("" if same else " (other pinyin: to the app they're two words)"))
        later = sorted({n for r in glossary or [] if r["section"] == "生词"
                        and re.sub(r"[（）()…]", "", r["hanzi"]) == hanzi for n in r["units"]})
        if later and not in_units.get(hanzi):
            notes.append(f"{wid} {hanzi}: the 生词总表 gives it for Unit {', '.join(map(str, later))}: "
                         "give it the same pinyin there, and its history carries over")
    return data, problems, notes


def glossary_rows():
    """The 生词总表 rows from book.py, with the corrections made after looking at the page images
    (glossary_fixes.json, next to the rows). None if the rows haven't been read yet."""
    from book import PRIVATE
    rows_file, fixes_file = PRIVATE / "glossary_rows.json", PRIVATE / "glossary_fixes.json"
    if not rows_file.exists():
        return None
    rows = load(rows_file)
    fixes = load(fixes_file) if fixes_file.exists() else {}
    for row in rows:
        fix = fixes.get(str(row["id"]))
        if fix:
            row.update(hanzi=fix.get("same_as", fix["hanzi"]), units=fix["units"])
    return rows


def check(selected=()):
    glossary = glossary_rows()
    if glossary is None:
        print("(No 生词总表 rows yet: run  python tools/book.py glossary  to compare with it.)\n")
    bad = 0
    for path in unit_files():
        data, problems, notes, pages = check_unit(path, glossary)
        if selected and data.get("unit") not in selected:
            continue
        counts = {t: sum(w.get("tag") == t for w in data["words"]) for t in ("word", "name", "extra")}
        print(f"Unit {data.get('unit')} · {data.get('title')}: {len(data['words'])} entries "
              f"({counts['word']} words, {counts['name']} names, {counts['extra']} extras), printed pages {pages}")
        for p in problems:
            print("  PROBLEM " + p)
        for n in notes:
            print("  check   " + n)
        bad += len(problems)
        print()
    if MINE.exists() and (not selected or "mine" in selected):
        data, problems, notes = check_mine(MINE, [load(path) for path in unit_files()], glossary)
        print(f"{data.get('en')} · {data.get('title')}: {len(data.get('words', []))} words")
        for p in problems:
            print("  PROBLEM " + p)
        for n in notes:
            print("  check   " + n)
        bad += len(problems)
        print()
    print("No problems." if not bad else f"{bad} problem(s) to fix.")
    return bad == 0


def version(path):
    """A hash of a word list, the same whether the file has Windows or plain line endings (git
    keeps plain ones)."""
    return hashlib.sha1(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()[:10]


def index():
    """Rebuild units/index.json: every unit with its title, counts and a version (a hash of its words),
    so the app can tell which units are new or changed. "words" counts everything you study,
    "people" the names of people (专名 such as 马丁), which quizzes skip unless you turn them on.
    My words get a line of their own, "mine", which copies of the app from before them don't read."""
    units = []
    for path in unit_files():
        data = load(path)
        words = data["words"]
        units.append({
            "unit": data["unit"], "title": data["title"], "en": data["en"],
            "file": path.relative_to(ROOT).as_posix(),
            "words": sum(not w.get("person") for w in words), "people": sum(bool(w.get("person")) for w in words),
            "version": version(path),
        })
    out = {"book": "Developing Chinese (2nd ed.), Elementary Comprehensive Course I", "units": units}
    if MINE.exists():
        data = load(MINE)
        out["mine"] = {"title": data["title"], "en": data["en"], "file": MINE.relative_to(ROOT).as_posix(),
                       "words": len(data["words"]), "version": version(MINE)}
    text = json.dumps(out, ensure_ascii=False, indent=2) + "\n"
    (UNITS / "index.json").write_text(text, encoding="utf-8", newline="\n")
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    command, args = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else ("", [])
    if command == "check":
        sys.exit(0 if check({a if a == "mine" else int(a) for a in args}) else 1)
    elif command == "index":
        out = index()
        for u in out["units"]:
            print(f"Unit {u['unit']} · {u['title']}: {u['words']} words + {u['people']} people's names, version {u['version']}")
        if "mine" in out:
            m = out["mine"]
            print(f"{m['en']} · {m['title']}: {m['words']} words, version {m['version']}")
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
