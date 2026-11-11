"""
Cut the 104 lettered panels out of the finished posters, for the episode pages
of the book's 26 episodes (/comics?ep=NN, where each poster's QR code leads).

    python scripts/cut-poster-panels.py --check <posters PDF>
    python scripts/cut-poster-panels.py <posters PDF> <out folder> --manifest <ts file>
        [--font <Segoe UI Semibold .ttf>]

The PDF is the universal A2 set, Agile_At_Work_All_26_Posters_Universal_A2.pdf:
26 pages, one poster per episode, each with four framed panels in a 2x2 grid. The
artwork zips' PNGs have no lettering (the balloons and speech are a separate,
vector layer of the PDF), so each panel is cut from the PDF along its frame and
rendered straight at each size, which keeps the lettering sharp. The frame, not
the embedded picture, gives the box: corrected art can be patched over the
original with extra pictures (episode 16's page has ten).

Each panel becomes a 768 and a 1536 px WebP, with the same sizes, quality and
credit as the portal's import (src/lib/comics/image-pipeline.ts). The credit goes
where CREDIT_CORNERS says, checked by eye on every panel so it never covers a
balloon. Each episode also gets a 1200 x 630 JPEG for link previews: the top of
its poster as printed (the title, then the first two panels) on the poster's
paper, with the credit on a strip of paper below the art. A strip from the middle
of one panel, as the import crops, would cut the square panels' balloons in half.

    <out>/posters/ep-01.p1.<hash>.768.webp   ...
    <out>/posters/ep-01.share.<hash>.jpg     ...

Every name carries a hash of its bytes, so re-cut art never meets an old cached
file. --manifest writes those names to the TypeScript file the site reads
(src/lib/comics/poster-panels.generated.ts). Upload the folder's `posters/` to
the `comic-panels` bucket (see RUNBOOK). The output folder must be new or empty,
and outside this repository: the art is the owner's and is never committed.

--check reads every page and reports what's wrong, writing nothing.

Needs PyMuPDF and Pillow.
"""

import hashlib
import io
import os
import re
import sys

import pymupdf
from PIL import Image, ImageDraw, ImageFont

EPISODES = 26
PANELS = 4
SMALL_WIDTH = 768
FULL_WIDTH = 1536
SHARE = (1200, 630)
WEBP_QUALITY = 78
JPEG_QUALITY = 82

# image-pipeline.ts: CREDIT_TEXT, and system-ui at 600 as Windows draws it.
CREDIT_TEXT = "\u00a9 Amr Elharony \u00b7 agile.amrelharony.com/comics"
DEFAULT_FONT = r"C:\Windows\Fonts\seguisb.ttf"

LINK = "https://agile.amrelharony.com/comics?ep={:02d}&src=poster"
PRINTED = re.compile(r"EPISODE (\d{2}) / 26")

DEFAULT_CORNER = "bottom-right"
# Where the default corner would sit on a balloon or its lettering, by
# episode:panel, checked on every panel at 768 px.
CREDIT_CORNERS = {
    "5:3": "top-right",
    "6:3": "top-left",
    "11:4": "bottom-left",
    "19:3": "bottom-left",
    "20:3": "top-left",
    "22:1": "top-left",
    "22:3": "top-right",
    "23:3": "top-right",
    "24:1": "top-left",
    "24:2": "top-right",
    "26:1": "top-left",
    "26:3": "top-left",
}
# The poster's paper, from its page fill.
PAPER = (255, 252, 245)
# The share image's art: the poster from just above its header to just below the
# first row of panels, which the frames place on every page.
SHARE_TOP = 26
SHARE_BELOW_PANELS = 3
# Room under the art for the credit, so it sits on paper alone.
SHARE_CREDIT_STRIP = 50

REPO = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))


def frames(page) -> list:
    """The panel frames, in reading order: rows top to bottom, then left to right."""
    boxes = [
        pymupdf.Rect(d["rect"])
        for d in page.get_drawings()
        if d.get("type") == "s" and d["rect"].width > 300 and d["rect"].height > 300
    ]
    return sorted(boxes, key=lambda box: (round(box.y0 / 50), box.x0))


def read_page(page, number: int) -> tuple[list, list]:
    """The page's frames, and every problem with it."""
    problems = []
    printed = PRINTED.search(page.get_text())
    if not printed or int(printed.group(1)) != number:
        problems.append(f"Page {number} doesn't say it is episode {number:02d}.")
    links = {link.get("uri") for link in page.get_links() if link.get("uri")}
    if links != {LINK.format(number)}:
        problems.append(f"Page {number} links to {sorted(links)}, not {LINK.format(number)}.")
    boxes = frames(page)
    if len(boxes) != PANELS:
        problems.append(f"Page {number} has {len(boxes)} panel frames, not {PANELS}.")
    elif any(abs(box.width - box.height) > 1 for box in boxes):
        problems.append(f"Page {number} has a panel that isn't square.")
    return boxes, problems


def render(page, clip, width: int) -> Image.Image:
    zoom = width / clip.width
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip, alpha=False)
    image = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    height = round(clip.height * width / clip.width)
    if image.size != (width, height):
        image = image.resize((width, height), Image.LANCZOS)
    return image


def draw_credit(image: Image.Image, corner: str, font_path: str) -> Image.Image:
    """creditBox and drawCredit from image-pipeline.ts."""
    width, height = image.size
    size = max(12, round(width * 0.02))
    face = ImageFont.truetype(font_path, size)
    margin = round(size * 0.5)
    pad = round(size * 0.4)
    text_width = face.getlength(CREDIT_TEXT)
    box_w = min(width - margin * 2, int(-(-text_width // 1)) + pad * 2)
    box_h = round(size * 1.5)
    x = width - margin - box_w if corner.endswith("right") else margin
    y = height - margin - box_h if corner.startswith("bottom") else margin
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.rectangle((x, y, x + box_w - 1, y + box_h - 1), fill=(255, 255, 255, round(255 * 0.85)))
    draw.text((x + pad, y + box_h / 2), CREDIT_TEXT, font=face, fill=(26, 26, 26, 255), anchor="lm")
    return Image.alpha_composite(image.convert("RGBA"), layer).convert("RGB")


def share_image(page, boxes, font_path: str) -> Image.Image:
    """The poster's title and first row of panels, centred on its paper."""
    width, height = SHARE
    clip = pymupdf.Rect(0, SHARE_TOP, page.rect.width, boxes[1].y1 + SHARE_BELOW_PANELS)
    art_height = height - SHARE_CREDIT_STRIP
    art_width = round(clip.width * art_height / clip.height)
    art = render(page, clip, art_width)
    image = Image.new("RGB", SHARE, PAPER)
    image.paste(art, ((width - art.width) // 2, 0))
    return draw_credit(image, DEFAULT_CORNER, font_path)


def encode(image: Image.Image, fmt: str) -> bytes:
    buffer = io.BytesIO()
    if fmt == "webp":
        image.save(buffer, "WEBP", quality=WEBP_QUALITY, method=6)
    else:
        image.save(buffer, "JPEG", quality=JPEG_QUALITY, optimize=True)
    return buffer.getvalue()


def save(out: str, stem: str, ext: str, data: bytes) -> str:
    name = f"posters/{stem}.{hashlib.sha256(data).hexdigest()[:10]}.{ext}"
    with open(os.path.join(out, name), "wb") as f:
        f.write(data)
    return name


def manifest(source: str, art: dict) -> str:
    lines = [
        "/**",
        " * GENERATED by scripts/cut-poster-panels.py from",
        f" * {source}. Don't edit: re-cut the",
        " * posters instead, which renames every file that changed.",
        " *",
        " * Each book episode's four poster panels (768 and 1536 px WebP) and its",
        " * 1200 x 630 share image, as paths in the public `comic-panels` bucket.",
        " */",
        "",
        f"export const POSTER_PANEL_WIDTH = {FULL_WIDTH};",
        f"export const POSTER_PANEL_HEIGHT = {FULL_WIDTH};",
        "",
        "export interface PosterPanelFiles {",
        "  /** The 768 px file: what every page loads. */",
        "  small: string;",
        "  /** The 1536 px file, loaded only full screen. */",
        "  full: string;",
        "}",
        "",
        "export interface PosterArt {",
        "  panels: readonly [PosterPanelFiles, PosterPanelFiles, PosterPanelFiles, PosterPanelFiles];",
        "  share: string;",
        "}",
        "",
        "export const POSTER_ART: Readonly<Record<number, PosterArt>> = {",
    ]
    for ep in sorted(art):
        lines.append(f"  {ep}: {{")
        lines.append("    panels: [")
        for small, full in art[ep]["panels"]:
            lines.append("      {")
            lines.append(f'        small: "{small}",')
            lines.append(f'        full: "{full}",')
            lines.append("      },")
        lines.append("    ],")
        lines.append(f'    share: "{art[ep]["share"]}",')
        lines.append("  },")
    lines.append("};")
    return "\n".join(lines) + "\n"


def parse_args(argv):
    check, manifest_path, font_path, rest = False, None, DEFAULT_FONT, []
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--check":
            check = True
            i += 1
        elif arg in ("--manifest", "--font"):
            if i + 1 >= len(argv):
                sys.exit(f"{arg} needs a value.\n{__doc__}")
            if arg == "--manifest":
                manifest_path = argv[i + 1]
            else:
                font_path = argv[i + 1]
            i += 2
        elif arg.startswith("-"):
            sys.exit(f"Unknown option {arg}.\n{__doc__}")
        else:
            rest.append(arg)
            i += 1
    if check:
        if len(rest) != 1:
            sys.exit(__doc__)
        return True, rest[0], None, None, font_path
    if len(rest) != 2 or not manifest_path:
        sys.exit(__doc__)
    return False, rest[0], rest[1], manifest_path, font_path


def main(argv):
    check, pdf_path, out, manifest_path, font_path = parse_args(argv)
    if not check:
        real = os.path.realpath(out)
        if real == REPO or real.startswith(REPO + os.sep):
            sys.exit(f"{out} is inside the repository. Choose a folder outside it.")
        if os.path.exists(out) and os.listdir(out):
            sys.exit(f"{out} isn't empty. Choose a new folder.")
        if not os.path.isfile(font_path):
            sys.exit(f"No font at {font_path}: pass --font <Segoe UI Semibold .ttf>.")

    doc = pymupdf.open(pdf_path)
    problems = []
    if doc.page_count != EPISODES:
        problems.append(f"Expected {EPISODES} posters, found {doc.page_count}.")
    pages = []
    for index in range(min(doc.page_count, EPISODES)):
        boxes, found = read_page(doc[index], index + 1)
        problems.extend(found)
        pages.append(boxes)
    if problems:
        sys.exit("\n".join(problems))
    if check:
        print(f"{EPISODES} posters, {EPISODES * PANELS} panels: all as expected.")
        return

    os.makedirs(os.path.join(out, "posters"), exist_ok=True)
    art = {}
    for index, boxes in enumerate(pages):
        ep = index + 1
        page = doc[index]
        files = []
        for n, box in enumerate(boxes, 1):
            corner = CREDIT_CORNERS.get(f"{ep}:{n}", DEFAULT_CORNER)
            names = []
            for width in (SMALL_WIDTH, FULL_WIDTH):
                image = draw_credit(render(page, box, width), corner, font_path)
                names.append(save(out, f"ep-{ep:02d}.p{n}", f"{width}.webp", encode(image, "webp")))
            files.append(tuple(names))
        share = share_image(page, boxes, font_path)
        art[ep] = {
            "panels": files,
            "share": save(out, f"ep-{ep:02d}.share", "jpg", encode(share, "jpeg")),
        }
        print(f"Episode {ep:02d} cut")

    with open(manifest_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(manifest(os.path.basename(pdf_path), art))
    print(f"Cut {EPISODES * PANELS} panels and {EPISODES} share images into {out}")
    print(f"Wrote {manifest_path}")


if __name__ == "__main__":
    main(sys.argv[1:])
