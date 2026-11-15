"""
Crop Amr's face from every shipped frame, enlarged, beside the original's, for a
face-by-face review (docs/mascot/AMR-FACE-ROUND-1.md).

    python -I scripts/audit-mascot-faces.py <out folder> [pack ...]

For each pack in public/mascot (or only the packs named) it writes
<out>/strips/<pack>.png: the original pet's face first (from
docs/mascot/reference/ref-face.png, green border), then the head of every frame,
each labelled with its sheet, slot and frame id. The talk pack shows one frame
per gesture (its heads are S01's). <out>/index.json lists every frame with its
sheet and slot and the head numbers from scripts/mascot_heads.py (hair and head
width, head height, and their ratio "aspect": the live idle's is about 0.92).

The strips are for eyes, not for --check: face shape, brows, eyes, nose, smile and
age don't reduce to numbers here. Review each strip against ref-face.png: a slot
needs work when its features aren't his, beyond what its expression, angle and
props explain.

Needs Pillow and numpy only.
"""

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, str(ROOT / "scripts"))
_spec = importlib.util.spec_from_file_location("packs", ROOT / "scripts" / "build-mascot-packs.py")
packs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(packs)
heads = packs.heads

TILE, GAP, LABEL = 260, 6, 34
BG = (236, 233, 226)
REF_FACE = ROOT / "docs" / "mascot" / "reference" / "ref-face.png"
REF_FRONT = (30, 60, 590, 620)  # the big front face in ref-face.png


def font(size: int, bold: bool = False):
    for name in (("arialbd.ttf" if bold else "arial.ttf"), "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def head_box(cell: Image.Image):
    """A square round his head in a 2x cell, and his head's numbers."""
    m = heads.segment(cell)
    if m.get("ok"):
        u = m["masks"]["face"] | m["masks"]["hair"]
        uy, ux = np.nonzero(u)
        side = max(ux.max() - ux.min() + 1, uy.max() - uy.min() + 1, 0.9 * m["hair_w"]) * 1.3
        # the face mask stops at the neck: centre a little low, so his whole chin shows
        cx, cy = (ux.min() + ux.max()) / 2, (uy.min() + uy.max()) / 2 + 0.06 * side
        nums = {k: m[k] for k in ("hair_w", "head_w", "head_h")}
        nums["aspect"] = round(m["head_w"] / m["head_h"], 3) if m["head_h"] else None
        nums["flags"] = m["flags"]
    else:  # a hat or an umbrella over his hair: the top of the figure
        al = np.array(cell)[..., 3] > 64
        ys, _ = np.nonzero(al)
        top, h = ys.min(), ys.max() - ys.min()
        band = np.nonzero(al[top:int(top + 0.3 * h)].any(0))[0]
        cx, side = (band.min() + band.max()) / 2, 0.42 * h
        cy = top + side / 2 - 0.03 * h
        nums = {"why": m.get("why")}
    return (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2), nums


def tile(cell: Image.Image, box) -> Image.Image:
    pad = 300
    big = Image.new("RGBA", (cell.width + 2 * pad, cell.height + 2 * pad), (0, 0, 0, 0))
    big.paste(cell, (pad, pad))
    b = tuple(v + pad for v in box)
    face = big.convert("RGBa").resize((TILE, TILE), Image.LANCZOS, box=b).convert("RGBA")
    out = Image.new("RGBA", (TILE, TILE), BG + (255,))
    out.alpha_composite(face)
    return out.convert("RGB")


def strip(tiles, title: str, path: Path) -> None:
    out = Image.new("RGB", (len(tiles) * (TILE + GAP) + GAP, TILE + LABEL + 30), (255, 255, 255))
    d = ImageDraw.Draw(out)
    d.text((8, 6), title, fill=(20, 60, 30), font=font(16, True))
    for i, (img, label, original) in enumerate(tiles):
        x = GAP + i * (TILE + GAP)
        out.paste(img, (x, 28))
        if original:
            d.rectangle((x - 3, 25, x + TILE + 2, 28 + TILE + 2), outline=(30, 120, 40), width=3)
        d.text((x + 4, 28 + TILE + 6), label, fill=(0, 0, 0), font=font(15))
    out.save(path)


def slots() -> dict:
    """Frame id -> (sheet, slot number on that sheet)."""
    where = {}
    for stem, (_pack, _kind, fids) in packs.SHEETS.items():
        for i, f in enumerate(fids):
            if f:
                where[f[0] if isinstance(f, tuple) else f] = (stem.split("-")[0], i + 1)
    docs = ROOT / "docs" / "mascot"
    for s in json.loads((docs / "context-sheets.json").read_text(encoding="utf-8"))["sheets"]:
        for i, sl in enumerate(s["slots"]):
            where[sl["id"]] = (s["sheet"], i + 2)
    for s in json.loads((docs / "companion-scenes.json").read_text(encoding="utf-8"))["sheets"]:
        for i, sl in enumerate(s["slots"]):
            where[sl["id"]] = (s["id"], i + 2)
    return where


def main(args: list[str]) -> None:
    if not args:
        raise SystemExit(__doc__)
    out, only = Path(args[0]), set(args[1:])
    (out / "strips").mkdir(parents=True, exist_ok=True)
    ref = Image.open(REF_FACE).convert("RGB").crop(REF_FRONT).resize((TILE, TILE), Image.LANCZOS)
    where, index = slots(), {}
    first_mouth = next(iter(packs.MOUTHS))
    for pack, (entry, fids) in packs.shipped_packs().items():
        if only and pack not in only:
            continue
        sheet = Image.open(ROOT / "public" / entry["src2x"].lstrip("/")).convert("RGBA")
        cw, ch = packs.CELL_W * 2, packs.PACK_H * 2
        tiles, frames = [(ref, "ORIGINAL (target)", True)], []
        for i, fid in enumerate(fids):
            if pack == "talk" and not fid.endswith("-" + first_mouth):
                continue
            r, c = divmod(i, packs.COLUMNS)
            cell = sheet.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
            box, nums = head_box(cell)
            base = f"explain.{fid.split('.')[1].split('-')[0]}" if pack == "talk" else fid
            sid, slot = where.get(base, ("?", 0))
            tiles.append((tile(cell, box), f"{sid} slot {slot} · {fid}", False))
            frames.append({"fid": fid, "sheet": sid, "slot": slot, **nums})
        sheets = sorted({f["sheet"] for f in frames})
        strip(tiles, f"{', '.join(sheets)}  [pack {pack}]  - first tile = ORIGINAL target face", out / "strips" / f"{pack}.png")
        index[pack] = {"sheets": sheets, "frames": frames}
    (out / "index.json").write_text(json.dumps(index, indent=1, default=str), encoding="utf-8")
    print(f"{len(index)} packs, {sum(len(v['frames']) for v in index.values())} faces -> {out}")


if __name__ == "__main__":
    main(sys.argv[1:])
