"""
Render docs/mascot/reference/ref-current.png: Amr as the packs show him today.

    python -I scripts/build-mascot-reference.py

ChatGPT gets this with every new sheet (docs/mascot/AMR-TOOLS-BRIEF.md), so it
copies the current Amr: his face, the haircut after hair rounds 2 and 3, and the
smooth rendering. The older ref-2-detail.png shows hair that isn't his.

Top row: four heads from the shipped 2x packs (front, turned, looking down,
looking up). Bottom row: two whole figures. Needs Pillow.
"""

import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public" / "mascot"
MANIFEST = ROOT / "src" / "components" / "agent" / "mascot" / "mascot-packs.ts"
OUT = ROOT / "docs" / "mascot" / "reference" / "ref-current.png"
CELL_W, PACK_H = 192, 224
HEADS = [("face.default", "front"), ("stroll.r-1", "turned"), ("rest.doze-a", "looking down"), ("stars.gaze", "looking up")]
FIGURES = [("face.default", "standing"), ("point.ur", "pointing")]
GROUND = (244, 241, 234, 255)


def cells():
    ts = MANIFEST.read_text(encoding="utf-8")
    src2x = dict(re.findall(r'^  (\w+): \{\s*src: "[^"]+",\s*src2x: "([^"]+)"', ts, re.M))
    frames = {f: (p, int(i)) for f, p, i in re.findall(r'^  "([^"]+)": \["(\w+)", (\d+)\]', ts, re.M)}
    sheets = {}

    def cell(fid):
        pack, i = frames[fid]
        if pack not in sheets:
            sheets[pack] = Image.open(PUBLIC / Path(src2x[pack]).name).convert("RGBA")
        x, y = (i % 8) * CELL_W * 2, (i // 8) * PACK_H * 2
        return sheets[pack].crop((x, y, x + CELL_W * 2, y + PACK_H * 2))

    return cell


def head(c: Image.Image) -> Image.Image:
    """The top of the figure: his head and shoulders, square."""
    box = c.getchannel("A").getbbox()
    x0, top, x1, _ = box
    alpha = c.getchannel("A").load()
    # Centre on the top third of the figure (his head), not on outstretched arms.
    band = [x for x in range(c.width) for y in range(top, min(top + 60, c.height)) if alpha[x, y] > 128]
    cx = (min(band) + max(band)) // 2 if band else (x0 + x1) // 2
    side = 200
    return c.crop((cx - side // 2, top - 12, cx + side // 2, top - 12 + side))


def font(size: int, bold: bool = False):
    try:
        return ImageFont.truetype("arialbd.ttf" if bold else "arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


def main() -> None:
    cell = cells()
    tile = 300
    pad = 30
    w = pad + 4 * (tile + pad)
    fig_h = 2 * PACK_H
    h = 70 + tile + 50 + fig_h + 70
    img = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    d = ImageDraw.Draw(img)
    d.text((pad, 20), "ref-current: Amr as he is today. Match this face, haircut and smooth rendering.", font=font(26, True), fill=(40, 90, 40))
    y = 70
    for i, (fid, caption) in enumerate(HEADS):
        t = Image.new("RGBA", (200, 200), GROUND)
        t.alpha_composite(head(cell(fid)))
        x = pad + i * (tile + pad)
        img.paste(t.resize((tile, tile), Image.LANCZOS), (x, y))
        d.text((x, y + tile + 8), caption, font=font(20), fill=(50, 50, 50))
    y += tile + 50
    for i, (fid, caption) in enumerate(FIGURES):
        t = Image.new("RGBA", (CELL_W * 2, fig_h), GROUND)
        t.alpha_composite(cell(fid))
        x = pad + i * (CELL_W * 2 + pad)
        img.paste(t, (x, y))
        d.text((x, y + fig_h + 8), caption, font=font(20), fill=(50, 50, 50))
    img.convert("RGB").save(OUT, optimize=True)
    print(OUT, img.size)


if __name__ == "__main__":
    main()
