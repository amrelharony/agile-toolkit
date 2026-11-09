"""
Check Amr's shipped packs against the live sprite: head size, skin colour and hair.

    python -I scripts/audit-mascot-heads.py [--json <file>] [--check]

Measures every frame of every pack in public/mascot (at 2x) the way the pack
builder does (scripts/mascot_heads.py) and prints, pack by pack, how far the skin
is from the live idle's (CIEDE2000; about 1 is just visible side by side) and how
big the head is against the live idle's. The live sheet's own frames are measured
too, as the yardstick: they differ from their idle by up to about ΔE 3.7, and their
heads range from about 93% to 111%.

It also prints two hair numbers against the live idle's, for reading rather than
for --check: how thick the hair down the sides of his head is (for a head facing
us), and how much of his head the hair covers (a dome on top shows as more).

With --check it exits 1 when a pack's median skin is more than ΔE 3 from live, or
its median head is more than 5% off.
"""

import json
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ beside the scripts
sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import mascot_heads as heads  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public" / "mascot"
MANIFEST = ROOT / "src" / "components" / "agent" / "mascot" / "mascot-packs.ts"
CELL_W, CELL_H, PACK_H, HEADROOM = 192, 208, 224, 16
SKIN_MAX, SIZE_OFF = 3.0, 0.05


def to_cell2x(cell1x: Image.Image) -> Image.Image:
    out = Image.new("RGBA", (CELL_W, PACK_H), (0, 0, 0, 0))
    out.paste(cell1x, (0, HEADROOM))
    return out.convert("RGBa").resize((CELL_W * 2, PACK_H * 2), Image.LANCZOS).convert("RGBA")


def sides(cell: Image.Image, m: dict) -> float | None:
    """The hair down each side of his head, as a share of the head's width; None
    when his head is turned or a side can't be followed to his ear."""
    if not m.get("ok") or "turned" in m["flags"]:
        return None
    st = heads.side_strips(cell, m)
    if set(st) != {"l", "r"}:
        return None
    return float(np.mean([np.median(v["depth"]) / np.median(v["width"]) for v in st.values()]))


def main() -> None:
    args = sys.argv[1:]
    ts = MANIFEST.read_text(encoding="utf-8")
    src2x = dict(re.findall(r'^  (\w+): \{\s*src: "[^"]+",\s*src2x: "([^"]+)"', ts, re.M))
    frames = re.findall(r'^  "([^"]+)": \["(\w+)", (\d+)\]', ts, re.M)
    live = Image.open(next(PUBLIC.glob("amr.*.webp"))).convert("RGBA")
    idle = to_cell2x(live.crop((0, 0, CELL_W, CELL_H)))
    ref = heads.measure(idle)
    ref_sides, ref_cover = sides(idle, ref), ref["hair_area"] / ref["head_area"]

    def row(cell, fid):
        m = heads.measure(cell)
        lab = heads.skin_lab(m, ref)
        size = None if heads.covered(fid) else heads.size_against(m, ref)
        side = None if heads.covered(fid) else sides(cell, m)
        hairy = m.get("ok") and not heads.covered(fid) and not set(m["flags"]) & {"turned", "hands-at-head"}
        return {"id": fid, "dE": None if lab is None else heads.de2000(ref["lab"], lab),
                "lab": None if lab is None else [float(v) for v in lab], "size": size,
                "sides": None if side is None else side / ref_sides,
                "cover": m["hair_area"] / m["head_area"] / ref_cover if hairy else None}

    yard = []
    for r in range(live.height // CELL_H):
        for c in range(live.width // CELL_W):
            cell = live.crop((c * CELL_W, r * CELL_H, (c + 1) * CELL_W, (r + 1) * CELL_H))
            if (r, c) != (0, 0) and cell.getchannel("A").getbbox():
                yard.append(row(to_cell2x(cell), f"live.{r}.{c}"))
    sheets, out = {}, {}
    for fid, pack, i in frames:
        if pack not in sheets:
            sheets[pack] = Image.open(PUBLIC / Path(src2x[pack]).name).convert("RGBA")
        x, y = (int(i) % 8) * CELL_W * 2, (int(i) // 8) * PACK_H * 2
        out.setdefault(pack, []).append(row(sheets[pack].crop((x, y, x + CELL_W * 2, y + PACK_H * 2)), fid))

    def med(rs, k):
        xs = [r[k] for r in rs if r[k] is not None]
        return float(np.median(xs)) if xs else None

    def pct(rs, k, q):
        xs = [r[k] for r in rs if r[k] is not None]
        return float(np.percentile(xs, q)) if xs else None

    print(f"live sheet: skin dE p90 {pct(yard, 'dE', 90):.1f}, head size {pct(yard, 'size', 10):.0%}-{pct(yard, 'size', 90):.0%}, "
          f"sides {pct(yard, 'sides', 10):.0%}-{pct(yard, 'sides', 90):.0%}, hair cover {pct(yard, 'cover', 10):.0%}-{pct(yard, 'cover', 90):.0%}")
    print(f"{'pack':10} {'frames':>6} {'skin dE':>8} {'head':>6} {'sides':>6} {'cover':>6}")
    failed = []
    pc = lambda v: "-" if v is None else f"{v:.0%}"
    for pack, rs in out.items():
        de, size = med(rs, "dE"), med(rs, "size")
        bad = (de is not None and de > SKIN_MAX) or (size is not None and abs(size - 1) > SIZE_OFF)
        if bad:
            failed.append(pack)
        print(f"{pack:10} {len(rs):6} {'-' if de is None else f'{de:.1f}':>8} {pc(size):>6} "
              f"{pc(med(rs, 'sides')):>6} {pc(med(rs, 'cover')):>6}{'  <' if bad else ''}")
    allr = [r for rs in out.values() for r in rs]
    print(f"all frames: skin dE median {med(allr, 'dE'):.1f}, p90 {pct(allr, 'dE', 90):.1f}; "
          f"head median {med(allr, 'size'):.1%}, {pct(allr, 'size', 10):.0%}-{pct(allr, 'size', 90):.0%}; "
          f"sides median {med(allr, 'sides'):.0%}, hair cover median {med(allr, 'cover'):.0%}")
    if "--json" in args:
        Path(args[args.index("--json") + 1]).write_text(json.dumps({"live": yard, "packs": out}), encoding="utf-8")
    if "--check" in args and failed:
        raise SystemExit(f"off the live sprite: {', '.join(failed)}")


if __name__ == "__main__":
    main()
