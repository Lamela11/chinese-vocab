"""
book.py - reads the textbook PDF for the vocab app: renders pages, finds the vocabulary
lists on them, and reads the book's full word list (生词总表) with OCR.

Page images and OCR results are saved in a private folder outside this repo (PRIVATE),
so nothing from the book can end up on GitHub.

    python tools/book.py lists 72-75 78     # images of the vocabulary lists on these PDF pages
    python tools/book.py page 74            # a whole page, as two images (top and bottom half)
    python tools/book.py glossary           # the 生词总表 as rows with their unit numbers
    python tools/book.py strips 12 40-45    # images of single 生词总表 rows, to check them

Run it with the second brain's Python, which has PyMuPDF and RapidOCR.
"""

import json
import os
import re
import sys
from pathlib import Path

BOOK = Path(os.environ.get("VOCAB_BOOK") or
            r"C:\Second_brain_Claude\notes\Comprehensive_Chinese\Chinese comprehensive book.pdf")
PRIVATE = Path(os.environ.get("VOCAB_PRIVATE") or
               Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "chinese-vocab")
PAGE_OFFSET = 21  # PDF page = printed page + 21
GLOSSARY_PAGES = range(358, 371)
DPI = 200  # for OCR
CROP_DPI = 220  # for the images Claude reads: tone marks need this
TOP = 58  # points: the running header (book or unit title) sits above this line

VOCAB_HEADS = ("生词", "专名", "补充词语")
SECTION_HEADS = ("课文", "注释", "综合注释", "练习", "课堂", "第一部分", "第二部分", "第三部分", "问题")
CJK = r"\u3400-\u9fff"


def page_list(specs):
    """["72-75", "78"] -> [72, 73, 74, 75, 78]."""
    pages = []
    for spec in specs:
        for part in re.split(r"[,\s]+", spec):
            if part:
                first, _, last = part.partition("-")
                pages.extend(range(int(first), int(last or first) + 1))
    return pages


_pdf = None


def pdf():
    global _pdf
    if _pdf is None:
        import pymupdf
        pymupdf.TOOLS.mupdf_display_errors(False)
        pymupdf.TOOLS.mupdf_display_warnings(False)
        _pdf = pymupdf.open(BOOK)
    return _pdf


def render(page, clip=None, dpi=DPI):
    """A PDF page (counted from 1), or the part of it inside clip (x0, y0, x1, y1 in points), as an image."""
    import pymupdf
    from PIL import Image
    pix = pdf()[page - 1].get_pixmap(dpi=dpi, clip=pymupdf.Rect(clip) if clip else None,
                                     colorspace=pymupdf.csRGB)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


_engine = None


def ocr_lines(page):
    """The text boxes on a page, top to bottom: [{"text", "box": [x0, y0, x1, y1] in points, "score"}]."""
    cache = PRIVATE / "ocr" / f"p{page:03d}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    global _engine
    import numpy as np
    if _engine is None:
        from rapidocr import RapidOCR
        _engine = RapidOCR(params={"Global.log_level": "warning"})
    result = _engine(np.asarray(render(page)))
    k = 72 / DPI
    lines = []
    for box, text, score in zip(result.boxes if result.boxes is not None else [], result.txts or (),
                                result.scores or ()):
        xs, ys = [float(p[0]) * k for p in box], [float(p[1]) * k for p in box]
        lines.append({"text": text, "box": [round(min(xs), 1), round(min(ys), 1), round(max(xs), 1), round(max(ys), 1)],
                      "score": round(float(score), 3)})
    lines.sort(key=lambda l: (round((l["box"][1] + l["box"][3]) / 2), l["box"][0]))
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(lines, ensure_ascii=False), encoding="utf-8")
    return lines


def _starts(text, heads):
    text = re.sub(r"\s+", "", text)
    return any(text.startswith(h) for h in heads)


def list_regions(page):
    """Where the vocabulary lists are on a page, as [(y0, y1)] in points. A list starts at
    生词, 专名 or 补充词语 (taking in a 课文 heading just above it) and runs to the next section
    heading or the bottom of the page. A page that opens in the middle of a list starts at the top."""
    lines = [l for l in ocr_lines(page) if l["box"][1] > TOP]
    if not lines:
        return []
    marks = [l for l in lines if l["box"][0] < 150 and _starts(l["text"], VOCAB_HEADS + SECTION_HEADS)]
    bottom = max(l["box"][3] for l in lines) + 6
    regions = []
    head = marks[0]["box"][1] if marks else bottom
    if any(re.match(rf"^\d{{1,2}}\s*[{CJK}]", l["text"]) for l in lines[:3] if l["box"][1] < head):
        regions.append([TOP, head - 3])  # the list began on the previous page
    for i, mark in enumerate(marks):
        if not _starts(mark["text"], VOCAB_HEADS):
            continue
        start = mark["box"][1] - 6
        if i and _starts(marks[i - 1]["text"], ("课文",)) and mark["box"][1] - marks[i - 1]["box"][1] < 45:
            start = marks[i - 1]["box"][1] - 6
        nxt = [m for m in marks[i + 1:] if not _starts(m["text"], VOCAB_HEADS)]
        end = nxt[0]["box"][1] - 3 if nxt else bottom
        if regions and start <= regions[-1][1] + 2:
            regions[-1][1] = max(regions[-1][1], end)
        else:
            regions.append([start, end])
    return [(round(a, 1), round(b, 1)) for a, b in regions]


def _split(page, y0, y1, most=380):
    """Cut a tall region into parts of at most `most` points, between lines of text."""
    if y1 - y0 <= most:
        return [(y0, y1)]
    gaps = sorted({round(l["box"][3] + 1, 1) for l in ocr_lines(page) if y0 < l["box"][3] < y1})
    cut = max((g for g in gaps if g - y0 <= most and not any(
        l["box"][1] < g < l["box"][3] for l in ocr_lines(page))), default=y0 + most)
    return [(y0, cut)] + _split(page, cut, y1, most)


def save_lists(pages):
    """Save the vocabulary lists on these pages as images. Returns [(page, path, (y0, y1))]."""
    out = []
    folder = PRIVATE / "lists"
    folder.mkdir(parents=True, exist_ok=True)
    for page in pages:
        width = pdf()[page - 1].rect.width
        n = 0
        for y0, y1 in list_regions(page):
            for a, b in _split(page, y0, y1):
                n += 1
                path = folder / f"p{page:03d}_{n}.png"
                render(page, (18, a, width - 12, b), dpi=CROP_DPI).save(path)
                out.append((page, path, (a, b)))
    return out


def save_page(page):
    """A whole page as two images (top and bottom half, overlapping a little)."""
    rect = pdf()[page - 1].rect
    folder = PRIVATE / "pages"
    folder.mkdir(parents=True, exist_ok=True)
    half = rect.height / 2
    paths = []
    for name, (a, b) in (("top", (0, half + 20)), ("bottom", (half - 20, rect.height))):
        path = folder / f"p{page:03d}_{name}.png"
        render(page, (0, a, rect.width, b), dpi=CROP_DPI).save(path)
        paths.append(path)
    return paths


# --- the 生词总表 ------------------------------------------------------------------

def glossary_rows():
    """Every row of the 生词总表 as {"id", "page", "box", "text", "hanzi", "units", "section"}. The table
    has two columns per page; a row is the OCR boxes at the same height in one column. "units" are
    the numbers in brackets at the end of the row as OCR read them, e.g. (5,18) -> [5, 18] (empty if
    it read none). "section" is 生词, or 专名 for the names listed at the end."""
    rows, names_from = [], None  # names_from: (page, y) of the 专名 heading; both columns switch there
    for page in GLOSSARY_PAGES:
        lines = [l for l in ocr_lines(page) if TOP < l["box"][1] < pdf()[page - 1].rect.height - 40]
        heading = next((l for l in lines if l["text"].replace(" ", "") == "专名"), None)
        if heading:
            names_from = (page, heading["box"][1])
        mid = pdf()[page - 1].rect.width / 2
        for side in (False, True):
            column = sorted((l for l in lines if ((l["box"][0] + l["box"][2]) / 2 > mid) == side),
                            key=lambda l: (l["box"][1] + l["box"][3]) / 2)
            groups = []
            for line in column:
                middle = (line["box"][1] + line["box"][3]) / 2
                if groups and abs(middle - groups[-1][0]) < 5:
                    groups[-1][1].append(line)
                else:
                    groups.append([middle, [line]])
            for _, group in groups:
                group.sort(key=lambda l: l["box"][0])
                text = " | ".join(l["text"] for l in group)
                if not re.search(rf"[{CJK}]|\(\s*\d", text):
                    continue  # a letter heading (A, B, ...) or stray marks
                if text.replace(" ", "") == "专名":
                    continue
                top = min(l["box"][1] for l in group)
                section = "专名" if names_from and (page, top) > names_from else "生词"
                tag = re.search(r"\(\s*(\d{1,2}(?:\s*[,，]\s*\d{1,2})*)\s*\)\s*$", text)
                # a letter heading (A, B, ...) at the same height can stick to the row: "B | 八 | bā"
                hanzi = re.match(rf"^[{CJK}…（）()]+", re.sub(r"^[A-Z]\|?", "", text.replace(" ", "")))
                rows.append({
                    "id": len(rows), "page": page,
                    "box": [min(l["box"][0] for l in group), min(l["box"][1] for l in group),
                            max(l["box"][2] for l in group), max(l["box"][3] for l in group)],
                    "text": text, "hanzi": hanzi.group(0) if hanzi else "",
                    "units": [int(n) for n in re.findall(r"\d+", tag.group(1))] if tag else [],
                    "section": section,
                })
    (PRIVATE / "glossary_rows.json").write_text(json.dumps(rows, ensure_ascii=False, indent=0), encoding="utf-8")
    return rows


def save_strips(ids, per_image=22):
    """Images of single 生词总表 rows, stacked with their row number on the left, so many rows
    can be checked in one picture. Returns the image paths."""
    from PIL import Image, ImageDraw
    rows = {r["id"]: r for r in json.loads((PRIVATE / "glossary_rows.json").read_text(encoding="utf-8"))}
    folder = PRIVATE / "strips"
    folder.mkdir(parents=True, exist_ok=True)
    paths = []
    for start in range(0, len(ids), per_image):
        strips = []
        for i in ids[start:start + per_image]:
            r = rows[i]
            width = pdf()[r["page"] - 1].rect.width
            x0 = 18 if r["box"][0] < width / 2 else width / 2 - 6
            image = render(r["page"], (x0, r["box"][1] - 4, x0 + width / 2 - 6, r["box"][3] + 4), dpi=260)
            strips.append((i, image))
        gutter = 70
        canvas = Image.new("RGB", (gutter + max(im.width for _, im in strips),
                                   sum(im.height + 6 for _, im in strips)), "white")
        draw, y = ImageDraw.Draw(canvas), 0
        for i, image in strips:
            canvas.paste(image, (gutter, y))
            draw.text((6, y + image.height // 2 - 6), str(i), fill="red")
            y += image.height + 6
            draw.line((0, y - 3, canvas.width, y - 3), fill=(200, 200, 200))
        path = folder / f"rows_{ids[start]}-{ids[min(start + per_image, len(ids)) - 1]}.png"
        canvas.save(path)
        paths.append(path)
    return paths


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    command, args = (sys.argv[1], sys.argv[2:]) if len(sys.argv) > 1 else ("", [])
    if command == "lists":
        for page, path, (a, b) in save_lists(page_list(args)):
            print(f"PDF p.{page} (printed p.{page - PAGE_OFFSET}) y {a:.0f}-{b:.0f}: {path}")
    elif command == "page":
        for page in page_list(args):
            print("\n".join(str(p) for p in save_page(page)))
    elif command == "crop":  # crop PAGE Y0 Y1: a band of a page (in points)
        page, y0, y1 = int(args[0]), float(args[1]), float(args[2])
        path = PRIVATE / "lists" / f"p{page:03d}_y{y0:.0f}-{y1:.0f}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        render(page, (18, y0, pdf()[page - 1].rect.width - 12, y1), dpi=CROP_DPI).save(path)
        print(path)
    elif command == "glossary":
        rows = glossary_rows()
        by_unit = {}
        for r in rows:
            for unit in r["units"] or [None]:
                by_unit.setdefault(unit, []).append(r)
        print(f"{len(rows)} rows ({sum(r['section'] == '专名' for r in rows)} in 专名). Per unit (as OCR read it): " +
              ", ".join(f"{u}: {len(v)}" for u, v in sorted(by_unit.items(), key=lambda kv: (kv[0] is None, kv[0] or 0))))
        for unit in map(int, args):
            print(f"\nUnit {unit}: " + "  ".join(f"{r['id']}:{r['hanzi'] or '?'}{'(专名)' if r['section'] == '专名' else ''}"
                                               for r in by_unit.get(unit, [])))
        print("\nNo unit number read: " + "  ".join(f"{r['id']}:{r['text'][:30]}" for r in by_unit.get(None, [])))
    elif command == "strips":
        print("\n".join(str(p) for p in save_strips(page_list(args))))
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
