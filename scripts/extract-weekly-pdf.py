"""
Cut the weekly stories out of the comic's review or final PDFs into a folder the
portal's import page reads (Settings > Comics > Import a batch).

    python scripts/extract-weekly-pdf.py <out folder> <PDF> [<PDF> ...]
        [--range 1-5] [--drafts drafts.json]
    python scripts/extract-weekly-pdf.py --check <PDF> [<PDF> ...] [--drafts drafts.json]

Each story page holds a header ("AAW-N001 | BATCH 1 | ..."), the title, the
cast ("HiPPO / Retrospective Turtle"), four panels in a 2x2 grid with a
"N001 / P1" label under each, then LESSON and SQUAD QUESTION. This writes:

    <out>/editorial/stories.json   the stories, in the shape import-weekly.ts reads
    <out>/art/N001_P01.jpg ...     each panel exactly as embedded, never re-encoded

--check reads every page and reports what it found or what's wrong, writing
nothing: run it on new PDFs first. --range keeps only those N numbers (for a
pilot). --drafts merges what Claude
drafted for each story, keyed by episode id ("AAW-N001"): guess, try_action,
try_tool, theme_ids and, per panel, alt and dialogue. Anything else in it is
ignored, and so are drafts for stories outside this run, so one drafts file
serves every PDF and every --range. Drafts arrive in the portal marked for
review and show nowhere until the owner approves them.

It stops, listing every problem, if a story page doesn't have exactly four
panels with their labels, if a number appears twice, or if numbers are missing
between the lowest and highest found. The output folder must be new or empty,
and outside this repository: the art is the owner's and is never committed.

Needs PyMuPDF.
"""

import json
import os
import re
import sys

import pymupdf

HEADER = re.compile(r"^AAW-N(\d{3,4}) \| BATCH")
LABEL = re.compile(r"^N(\d{3,4}) / P(\d)$")
DRAFT_ID = re.compile(r"AAW-N\d{3,4}")
PANELS_PER_STORY = 4
TITLE_MIN_SIZE = 14

DRAFT_STORY_KEYS = ("guess", "try_action", "try_tool", "theme_ids")
DRAFT_PANEL_KEYS = ("alt", "dialogue")


def lines_of(page):
    """Every text line on the page as (x0, y0, x1, y1, size, bold, text)."""
    out = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            spans = line["spans"]
            text = "".join(s["text"] for s in spans).strip()
            if not text:
                continue
            first = spans[0]
            x0, y0, x1, y1 = line["bbox"]
            out.append((x0, y0, x1, y1, first["size"], "Bold" in first["font"], text))
    return sorted(out, key=lambda l: (round(l[1]), l[0]))


def paragraph_after(lines, head):
    """
    The paragraph under a heading: lines in the first line's size, not bold, each
    close under the last. Stops at the next heading or a gap, so a footer never
    joins it wherever the page puts one.
    """
    if head is None:
        return ""
    below = [l for l in lines if l[1] >= head[3] - 0.5 and l is not head]
    if not below:
        return ""
    size, out, last = below[0][4], [], None
    for l in below:
        height = l[3] - l[1]
        if l[5] or abs(l[4] - size) > 0.3:
            break
        if last is not None and l[1] - last[3] > 1.5 * height:
            break
        out.append(l[6])
        last = l
    return " ".join(out).strip()


def read_story(doc, page, number_page):
    """One story page as (number, story dict, [(panel, xref)]), or raises ValueError."""
    lines = lines_of(page)
    header = next((l for l in lines if HEADER.match(l[6])), None)
    if header is None:
        return None
    n = int(HEADER.match(header[6]).group(1))
    where = f"N{n:03d} (page {number_page})"

    images = []
    for item in page.get_images(full=True):
        for rect in page.get_image_rects(item[0]):
            images.append((rect, item[0]))
    labels = []
    for l in lines:
        m = LABEL.match(l[6])
        if m:
            if int(m.group(1)) != n:
                raise ValueError(f"{where}: a panel label says N{int(m.group(1)):03d}")
            labels.append((int(m.group(2)), l))
    if len(images) != PANELS_PER_STORY or len(labels) != PANELS_PER_STORY:
        raise ValueError(
            f"{where}: found {len(images)} pictures and {len(labels)} panel labels, "
            f"not {PANELS_PER_STORY} of each"
        )

    # Each label sits just under its picture, at its left edge.
    panels = []
    for panel, label in labels:
        lx, ly = label[0], label[1]
        below = [(r, x) for r, x in images if ly >= r.y1 - 2]
        if not below:
            raise ValueError(f"{where}: no picture above the label for P{panel}")
        rect, xref = min(below, key=lambda rx: abs(rx[0].x0 - lx) + abs(ly - rx[0].y1))
        panels.append((panel, xref, rect))
    if sorted(p for p, _, _ in panels) != list(range(1, PANELS_PER_STORY + 1)):
        raise ValueError(f"{where}: the panel labels aren't P1 to P{PANELS_PER_STORY}")
    if len({x for _, x, _ in panels}) != PANELS_PER_STORY:
        raise ValueError(f"{where}: two labels point at the same picture")

    top_of_art = min(r.y0 for r, _ in images)
    title = " ".join(
        l[6] for l in lines if l[1] > header[3] and l[3] <= top_of_art and l[4] >= TITLE_MIN_SIZE
    ).strip()
    title_bottom = max(
        (l[3] for l in lines if l[1] > header[3] and l[4] >= TITLE_MIN_SIZE), default=header[3]
    )
    cast_line = " ".join(
        l[6] for l in lines if l[1] >= title_bottom and l[3] <= top_of_art and l[4] < TITLE_MIN_SIZE
    ).strip()
    cast = [c.strip() for c in cast_line.split(" / ") if c.strip()]

    lesson_head = next((l for l in lines if l[6] == "LESSON"), None)
    question_head = next((l for l in lines if l[6] == "SQUAD QUESTION"), None)
    if not title or not lesson_head or not question_head:
        raise ValueError(f"{where}: couldn't find its title, LESSON or SQUAD QUESTION")
    lesson = paragraph_after(lines, lesson_head)
    question = paragraph_after(lines, question_head)
    if not lesson or not question:
        raise ValueError(f"{where}: its lesson or squad question is empty")

    story = {
        "episode_id": f"AAW-N{n:03d}",
        "production_number": n,
        "working_title": title,
        "lesson": lesson,
        "squad_question": question,
        "cast_names": cast,
        "theme_ids": [],
        "art_files": [],
        "panels": [
            {"panel": p, "visual": "", "dialogue": [], "embedded_text": []}
            for p in range(1, PANELS_PER_STORY + 1)
        ],
    }
    return n, story, sorted((p, x) for p, x, _ in panels)


def merge_draft(story, draft):
    for key in DRAFT_STORY_KEYS:
        if key in draft:
            story[key] = draft[key]
    for panel, extra in zip(story["panels"], draft.get("panels") or []):
        if isinstance(extra, dict):
            for key in DRAFT_PANEL_KEYS:
                if key in extra:
                    panel[key] = extra[key]


REPO = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))


def parse_args(argv):
    out, pdfs, keep, drafts, check = None, [], None, None, False
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--check":
            check = True
            i += 1
        elif arg.startswith("-") and arg not in ("--range", "--drafts"):
            sys.exit(f"Unknown option {arg}.\n{__doc__}")
        elif arg == "--range":
            lo, _, hi = argv[i + 1].partition("-")
            keep = (int(lo), int(hi or lo))
            i += 2
        elif arg == "--drafts":
            drafts = argv[i + 1]
            i += 2
        elif out is None and not check:
            out = arg
            i += 1
        else:
            pdfs.append(arg)
            i += 1
    if (out is None and not check) or not pdfs:
        sys.exit(__doc__)
    return out, pdfs, keep, drafts, check


def main(argv):
    out, pdfs, keep, drafts_path, check = parse_args(argv)
    if not check:
        if os.path.realpath(out).startswith(REPO + os.sep) or os.path.realpath(out) == REPO:
            sys.exit(f"{out} is inside the repository. Choose a folder outside it.")
        if os.path.exists(out) and os.listdir(out):
            sys.exit(f"{out} isn't empty. Choose a new folder.")
    drafts = {}
    if drafts_path:
        with open(drafts_path, encoding="utf-8") as f:
            drafts = json.load(f)
        if not isinstance(drafts, dict):
            sys.exit(f"{drafts_path} should map episode ids to drafts.")

    problems, found = [], {}
    for path in pdfs:
        doc = pymupdf.open(path)
        for index in range(doc.page_count):
            try:
                read = read_story(doc, doc[index], index + 1)
            except ValueError as err:
                problems.append(f"{os.path.basename(path)}: {err}")
                continue
            if read is None:
                continue
            n, story, panels = read
            if keep and not keep[0] <= n <= keep[1]:
                continue
            if n in found:
                problems.append(f"N{n:03d} appears twice ({os.path.basename(path)}, page {index + 1})")
                continue
            found[n] = (doc, story, panels)

    if found:
        missing = [n for n in range(min(found), max(found) + 1) if n not in found]
        if missing:
            shown = ", ".join(f"N{n:03d}" for n in missing[:12])
            more = f" and {len(missing) - 12} more" if len(missing) > 12 else ""
            problems.append(f"Missing between N{min(found):03d} and N{max(found):03d}: {shown}{more}")
    else:
        problems.append("No story pages found.")
    # A key that isn't an episode id is a typo; one for a story outside this run
    # belongs to another PDF or range and is simply left out.
    misnamed = sorted(k for k in drafts if not DRAFT_ID.fullmatch(k))
    if misnamed:
        problems.append(f"Drafts keyed by something other than AAW-N001: {', '.join(misnamed[:12])}")
    if problems:
        sys.exit("Nothing written:\n  " + "\n  ".join(problems))
    in_run = {s["episode_id"] for _, s, _ in found.values()}
    matched = sum(1 for k in drafts if k in in_run)
    drafts_line = f"Drafts merged: {matched}" + (
        f" ({len(drafts) - matched} for stories outside this run, left out)." if len(drafts) > matched else "."
    )
    if check:
        numbers = sorted(found)
        print(
            f"OK: {len(numbers)} stories, N{numbers[0]:03d} to N{numbers[-1]:03d}, "
            f"{len(numbers) * PANELS_PER_STORY} panels. {drafts_line.replace('merged', 'matched')}"
        )
        return

    os.makedirs(os.path.join(out, "editorial"), exist_ok=True)
    os.makedirs(os.path.join(out, "art"), exist_ok=True)
    episodes = []
    for n in sorted(found):
        doc, story, panels = found[n]
        for panel, xref in panels:
            image = doc.extract_image(xref)
            ext = {"jpeg": "jpg", "png": "png"}.get(image["ext"])
            data = image["image"]
            if ext is None:
                # Not something every browser decodes: decode it once, losslessly, to PNG.
                pix = pymupdf.Pixmap(doc, xref)
                if pix.alpha or pix.n > 3:
                    pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                data, ext = pix.tobytes("png"), "png"
            name = f"art/N{n:03d}_P{panel:02d}.{ext}"
            with open(os.path.join(out, name), "wb") as f:
                f.write(data)
            story["art_files"].append(name)
        if story["episode_id"] in drafts:
            merge_draft(story, drafts[story["episode_id"]])
        episodes.append(story)

    with open(os.path.join(out, "editorial", "stories.json"), "w", encoding="utf-8") as f:
        json.dump({"source": "extract-weekly-pdf", "episodes": episodes}, f, ensure_ascii=False, indent=2)
    print(
        f"Wrote {len(episodes)} stories (N{episodes[0]['production_number']:03d} to "
        f"N{episodes[-1]['production_number']:03d}, episodes {26 + episodes[0]['production_number']} "
        f"to {26 + episodes[-1]['production_number']}) and {len(episodes) * PANELS_PER_STORY} panels "
        f"to {out}. {drafts_line}"
    )


if __name__ == "__main__":
    main(sys.argv[1:])
