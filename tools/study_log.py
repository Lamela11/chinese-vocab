"""
study_log.py - finds the words in the "Words and rules I keep forgetting" lists of your study log,
so the app can star them: they start out in Hard words.

    python tools/study_log.py            # show what it finds
    python tools/study_log.py --save     # also write local/brain.json for the app on this laptop

A word counts when a line of such a list names it with its pinyin (需要 xūyào), starts with it
(两 (before a measure word) ...) or compares it using "vs" (几 vs 多少). Only the characters are
kept: the app stars the words that match them, and a word of a unit it doesn't have yet gets its
star when that unit is added. Example sentences in the lines don't count.

Until sync is set up (step 3), local/brain.json is how the app on this laptop gets these stars.
The local folder is never committed. Run it with the second brain's Python (it has pypinyin).
"""

import json
import os
import re
import sys
import time
import unicodedata
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOG = Path(os.environ.get("VOCAB_STUDY_LOG") or
           r"C:\Second_brain_Claude\notes\Comprehensive_Chinese\my_notes\Study log.md")
HAN = r"[\u3400-\u9fff]+"
SYLLABLE = r"[A-Za-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüÜ]+"


def toneless(pinyin):
    """"Lǜshī" -> "lüshi"."""
    out = []
    for ch in unicodedata.normalize("NFC", pinyin).lower():
        out.append("ü" if ch in "üǖǘǚǜ" else unicodedata.normalize("NFD", ch)[0])
    return re.sub(r"[^a-zü]", "", "".join(out))


def reading(hanzi):
    from pypinyin import Style, lazy_pinyin
    return "".join(lazy_pinyin(hanzi, style=Style.NORMAL, v_to_u=True))


def entries(text):
    """The log's entries as [(when, body)], from their "## YYYY-MM-DD HH:MM" headings."""
    parts = re.split(r"^##\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*$", text, flags=re.M)
    return list(zip(parts[1::2], parts[2::2]))


def forgetting_lines(body):
    """The bullet lines under "Words and rules I keep forgetting" (or any heading with "keep forgetting")."""
    lines, inside = [], False
    for line in body.splitlines():
        if "keep forgetting" in line.lower():
            inside = True
            continue
        if not inside or not line.strip():
            continue
        bullet = re.match(r"\s*[-*•]\s+(.*)", line)
        if not bullet:
            inside = False  # the list has ended
            continue
        lines.append(re.sub(r"\*\*|`", "", bullet.group(1)))
    return lines


def candidates(line):
    """The words a list line is about (see the module docstring)."""
    found = []
    for run in re.finditer(HAN, line):  # a word followed by its pinyin: 需要 xūyào
        after = re.match(rf"\s*[(（]?\s*({SYLLABLE}(?:\s+{SYLLABLE}){{0,3}})", line[run.end():])
        if after:
            words, wanted = after.group(1).split(), toneless(reading(run.group()))
            if any(toneless(" ".join(words[:n])) == wanted for n in range(1, len(words) + 1)):
                found.append(run.group())
    first = re.match(rf"\s*({HAN})", line)  # a line that starts with a word: 两 (before ...
    if first:
        found.append(first.group(1))
    if re.search(r"\bvs\.?\s", line):  # comparisons: 几 vs 多少, 哪 nǎ vs 那 nà vs 这 zhè
        for part in re.split(r"\bvs\.?\s", line):
            word = re.search(HAN, part)
            if word:
                found.append(word.group())
    return list(dict.fromkeys(found))


def events(text):
    """One star per word and log entry, dated like the entry, so a star you remove later stays removed."""
    out = []
    for when, body in entries(text):
        t = int(time.mktime(datetime.strptime(when, "%Y-%m-%d %H:%M").timetuple()) * 1000)
        words = list(dict.fromkeys(w for line in forgetting_lines(body) for w in candidates(line)))
        out += [{"id": f"log-{when.replace(' ', 'T')}-{w}", "t": t, "type": "s", "hz": w, "on": 1,
                 "src": f"study log {when}"} for w in words]
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    found = events(LOG.read_text(encoding="utf-8"))
    known = {w["hanzi"] for path in ROOT.glob("units/unit-*/words.json")
             for w in json.loads(path.read_text(encoding="utf-8"))["words"]}
    for src in dict.fromkeys(e["src"] for e in found):
        words = [e["hz"] for e in found if e["src"] == src]
        print(f"{src}: " + "  ".join(w if w in known else f"({w})" for w in words))
    starred = sorted({e["hz"] for e in found} & known)
    print(f"\nIn the app's units: {len(starred)} words get a star. In brackets: not in any unit yet.")
    if "--save" in sys.argv:
        out = ROOT / "local" / "brain.json"
        out.parent.mkdir(exist_ok=True)
        out.write_text(json.dumps({"events": found}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"Saved {len(found)} stars to {out}")


if __name__ == "__main__":
    main()
