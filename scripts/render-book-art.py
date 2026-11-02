"""
Render the book's front cover and the two share images into public/media, from
the printer's cover proof (back cover, spine and front cover on one page).

    python scripts/render-book-art.py <cover proof PDF> <Shantell Sans font> <Inter font>

The fonts are the site's own: after `npm run build`, they're the preloaded
`.next/static/media/*.p.woff2` files. Needs PyMuPDF and Pillow. Each file name
carries a hash of its bytes, so a new cover never meets an old cached one; paste
the printed names into src/lib/book/art.ts.
"""

import hashlib
import io
import os
import sys

import pymupdf
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "media")

# The proof is 1269 x 630 pt: two 8.5 in (612 pt) covers either side of a 27 pt
# spine, with 9 pt of bleed all round. This is the front cover's trim, less a
# hair on each side so the spine's ink doesn't leave a line down the left edge.
FRONT = pymupdf.Rect(648.5, 9.25, 1259.75, 620.5)
COVER_SIZES = (1080, 720, 540)

# The comic theme's paper, ink and accent (globals.css, the light block).
PAPER = "#f7f1e6"
CARD = "#fffcf5"
INK = "#2b2622"
TEXT = "#1d1a18"
SUB = "#574e44"
ACCENT = "#873a16"

SHARE = (1200, 630)


def save(data: bytes, stem: str, ext: str) -> str:
    name = f"{stem}.{hashlib.sha256(data).hexdigest()[:8]}.{ext}"
    with open(os.path.join(OUT, name), "wb") as f:
        f.write(data)
    return name


def encode(image: Image.Image, fmt: str, **options) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, fmt, **options)
    return buffer.getvalue()


def render_front(pdf_path: str) -> Image.Image:
    page = pymupdf.open(pdf_path)[0]
    if round(page.rect.width) != 1269 or round(page.rect.height) != 630:
        sys.exit(f"Expected a 1269 x 630 pt proof, found {page.rect}.")
    zoom = max(COVER_SIZES) / FRONT.width
    pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=FRONT, alpha=False)
    return Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")


def font(path: str, size: int, weight: int) -> ImageFont.FreeTypeFont:
    face = ImageFont.truetype(path, size)
    face.set_variation_by_axes([weight])
    return face


def wrap(draw: ImageDraw.ImageDraw, text: str, face, width: int) -> list[str]:
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=face) <= width:
            line = trial
        else:
            lines.append(line)
            line = word
    return lines + [line]


def panel(size=SHARE) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    """Paper, and one inked panel with the site's hard offset shadow."""
    image = Image.new("RGB", size, PAPER)
    draw = ImageDraw.Draw(image)
    w, h = size
    draw.rectangle((52, 52, w - 32, h - 32), fill=INK)
    draw.rectangle((40, 40, w - 44, h - 44), fill=CARD, outline=INK, width=5)
    return image, draw


def text_block(draw, x, y, width, title, lines, url, hand, sans):
    title_face = font(hand, 92, 700)
    for row in wrap(draw, title, title_face, width):
        draw.text((x, y), row, font=title_face, fill=TEXT)
        y += 104
    y += 18
    body_face = font(sans, 34, 500)
    for text in lines:
        for row in wrap(draw, text, body_face, width):
            draw.text((x, y), row, font=body_face, fill=SUB)
            y += 46
        y += 8
    draw.text((x, 500), url, font=font(sans, 30, 650), fill=ACCENT)


def share_book(cover: Image.Image, hand: str, sans: str) -> Image.Image:
    image, draw = panel()
    side = 470
    left, top = 1200 - 44 - 60 - side, (630 - side) // 2 - 6
    draw.rectangle((left + 12, top + 12, left + side + 12, top + side + 12), fill=INK)
    image.paste(cover.resize((side, side), Image.LANCZOS), (left, top))
    draw.rectangle((left, top, left + side, top + side), outline=INK, width=4)
    text_block(
        draw,
        100,
        110,
        left - 150,
        "Agile at Work",
        ["26 Stories About Working Better Together", "Volume 1 · Amr Elharony"],
        "agile.amrelharony.com/book",
        hand,
        sans,
    )
    return image


def share_site(sprite_path: str, hand: str, sans: str) -> Image.Image:
    image, draw = panel()
    sheet = Image.open(sprite_path).convert("RGBA")
    # Row 3 is waving (sprite-poses.ts); frame 1 has his hand up.
    cell = sheet.crop((192 * 1, 208 * 3, 192 * 2, 208 * 4))
    amr = cell.resize((round(192 * 2), round(208 * 2)), Image.LANCZOS)
    image.paste(amr, (1200 - 44 - 30 - amr.width, 630 - 44 - 4 - amr.height), amr)
    text_block(
        draw,
        100,
        110,
        750,
        "Agile Toolkit",
        [
            "Free tools for Scrum masters and agile teams.",
            "Plan the sprint, run the daily and the retro, estimate together.",
        ],
        "agile.amrelharony.com",
        hand,
        sans,
    )
    return image


def main(pdf_path: str, hand: str, sans: str) -> None:
    os.makedirs(OUT, exist_ok=True)
    front = render_front(pdf_path)
    for size in COVER_SIZES:
        image = front.resize((size, size), Image.LANCZOS)
        print(f"cover {size}:", save(encode(image, "WEBP", quality=82, method=6), f"cover-{size}", "webp"))
    print("share book:", save(encode(share_book(front, hand, sans), "JPEG", quality=86, optimize=True), "share-book", "jpg"))
    sprite = os.path.join(OUT, "..", "mascot")
    sheet = next(f for f in os.listdir(sprite) if f.startswith("amr.") and f.endswith(".webp"))
    site = share_site(os.path.join(sprite, sheet), hand, sans)
    print("share site:", save(encode(site, "JPEG", quality=86, optimize=True), "share-site", "jpg"))


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
