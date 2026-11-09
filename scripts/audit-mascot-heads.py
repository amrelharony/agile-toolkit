"""
Check Amr's shipped packs against the live sprite: head size, the colour of his
skin, clothes and hair, how sharp he is, and where he stands in the cell.

    python -I scripts/audit-mascot-heads.py [--json <file>] [--check]

Measures every frame of every pack in public/mascot the way the pack builder does
(scripts/mascot_heads.py) and prints, pack by pack, against the live idle frame:

    skin, shirt, trousers, shoes   colour distance (CIEDE2000; about 1 is just
                                   visible side by side)
    hair                           colour distance in Lab, as the builder's hair
                                   step measures it
    head                           size (100% = the live idle's)
    sharp                          fine detail at 1x (100% = the live idle's)

The live sheet's own frames are measured too, as the yardstick: they differ from
their idle by up to about dE 3.7, their heads range from about 93% to 111%, and
they carry 100-120% of the idle's detail.

It also prints, for reading rather than for --check: how thick the hair down the
sides of his head is (for a head facing us), how much of his head the hair covers
(a dome on top shows as more), and how many frames stand off the floor row.

With --check it exits 1 when a pack's median is off: skin more than dE 3, a
garment more than dE 2.5, hair more than 4, head more than 5% (over at least
three heads that can be measured); when a standing frame's feet are more than a
pixel off the floor; or when the detail over all frames is outside 90-110%. A
pack's own detail is printed but not checked: a scene full of flat-coloured props
reads soft however sharp he is, and each sheet is sharpened by its stance.
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
CONTEXT_SPEC = ROOT / "docs" / "mascot" / "context-sheets.json"
CELL_W, CELL_H, PACK_H, HEADROOM = 192, 208, 224, 16
FLOOR_ROW = 201 + HEADROOM  # the lowest row of his shoes in a 1x pack cell
SKIN_MAX, SIZE_OFF = 3.0, 0.05
GARMENT_MAX, HAIR_MAX = 2.5, 4.0
SHARP_MIN, SHARP_MAX = 0.90, 1.10  # over all frames
HEADS_MIN = 3  # fewer measurable heads than this isn't a pack's size
# Held up by the collar: lined up on his hair, so his feet are wherever they swing.
OFF_FLOOR = ("lifted.hang", "lifted.swing-l", "lifted.swing-r", "lifted.flail")


def to_cell2x(cell1x: Image.Image) -> Image.Image:
    return pack_cell(cell1x).convert("RGBa").resize((CELL_W * 2, PACK_H * 2), Image.LANCZOS).convert("RGBA")


def pack_cell(cell1x: Image.Image) -> Image.Image:
    """A live-sheet cell where a pack's cell puts him: with the headroom above."""
    out = Image.new("RGBA", (CELL_W, PACK_H), (0, 0, 0, 0))
    out.paste(cell1x, (0, HEADROOM))
    return out


def sides(cell: Image.Image, m: dict) -> float | None:
    """The hair down each side of his head, as a share of the head's width; None
    when his head is turned or a side can't be followed to his ear."""
    if not m.get("ok") or "turned" in m["flags"]:
        return None
    st = heads.side_strips(cell, m)
    if set(st) != {"l", "r"}:
        return None
    return float(np.mean([np.median(v["depth"]) / np.median(v["width"]) for v in st.values()]))


def hair_lab(cell: Image.Image, seg: dict):
    """The hair's median Lab in a 2x cell (the builder's measure), or None."""
    if not seg.get("ok"):
        return None
    m = heads.erode(seg["masks"]["hair"], 2)
    if m.sum() < 200:
        return None
    return np.median(heads.srgb_to_lab(np.array(cell.convert("RGBA")).astype(np.float64)[..., :3])[m], 0)


def clothes(cell: Image.Image) -> dict:
    return {g: heads.garment_lab(cell, m) for g, m in heads.garments(cell).items()}


def head_kinds() -> set[str]:
    """Frames the builder lines up on the hair, not the feet."""
    spec = json.loads(CONTEXT_SPEC.read_text(encoding="utf-8"))
    out = set(OFF_FLOOR)
    for s in spec["sheets"]:
        out |= {slot["id"] for slot in s["slots"] if slot.get("kind") == "head"}
    return out


def main() -> None:
    args = sys.argv[1:]
    ts = MANIFEST.read_text(encoding="utf-8")
    srcs = {m.group(1): (m.group(2), m.group(3))
            for m in re.finditer(r'^  (\w+): \{\s*src: "([^"]+)",\s*src2x: "([^"]+)"', ts, re.M)}
    frames = re.findall(r'^  "([^"]+)": \["(\w+)", (\d+)\]', ts, re.M)
    live = Image.open(next(PUBLIC.glob("amr.*.webp"))).convert("RGBA")
    idle1 = pack_cell(live.crop((0, 0, CELL_W, CELL_H)))
    idle = to_cell2x(live.crop((0, 0, CELL_W, CELL_H)))
    ref_seg = heads.segment(idle)
    ref = {k: v for k, v in ref_seg.items() if k != "masks"}
    ref_sides, ref_cover = sides(idle, ref), ref["hair_area"] / ref["head_area"]
    ref_hair, ref_clothes, ref_detail = hair_lab(idle, ref_seg), clothes(idle), heads.detail(idle1)
    hung = head_kinds()

    def row(cell, cell1, fid):
        seg = heads.segment(cell)
        m = {k: v for k, v in seg.items() if k != "masks"}
        lab = heads.skin_lab(m, ref)
        is_covered = heads.covered(fid)
        size = None if is_covered else heads.size_against(m, ref)
        side = None if is_covered else sides(cell, m)
        hairy = m.get("ok") and not is_covered and not set(m["flags"]) & {"turned", "hands-at-head"}
        hair = None if is_covered else hair_lab(cell, seg)
        worn = clothes(cell)
        d = heads.detail(cell1)
        a = np.array(cell1)[..., 3] > 32
        rows = np.nonzero(a.any(1))[0]
        out = {"id": fid, "dE": None if lab is None else heads.de2000(ref["lab"], lab),
               "lab": None if lab is None else [float(v) for v in lab], "size": size,
               "sides": None if side is None else side / ref_sides,
               "cover": m["hair_area"] / m["head_area"] / ref_cover if hairy else None,
               "hair": None if hair is None else float(np.linalg.norm(ref_hair - hair)),
               "sharp": None if d is None else d / ref_detail,
               "floor": None if fid in hung or not len(rows) else int(rows[-1]) - FLOOR_ROW}
        for g in heads.GARMENTS:
            out[g] = heads.de2000(ref_clothes[g], worn[g]) if g in worn else None
        return out

    yard = []
    for r in range(live.height // CELL_H):
        for c in range(live.width // CELL_W):
            cell = live.crop((c * CELL_W, r * CELL_H, (c + 1) * CELL_W, (r + 1) * CELL_H))
            if (r, c) != (0, 0) and cell.getchannel("A").getbbox():
                yard.append(row(to_cell2x(cell), pack_cell(cell), f"live.{r}.{c}"))
    sheets, out = {}, {}
    for fid, pack, i in frames:
        if pack not in sheets:
            sheets[pack] = tuple(Image.open(PUBLIC / Path(s).name).convert("RGBA") for s in srcs[pack])
        cells = []
        for k, sheet in zip((1, 2), sheets[pack]):
            x, y = (int(i) % 8) * CELL_W * k, (int(i) // 8) * PACK_H * k
            cells.append(sheet.crop((x, y, x + CELL_W * k, y + PACK_H * k)))
        out.setdefault(pack, []).append(row(cells[1], cells[0], fid))

    def med(rs, k):
        xs = [r[k] for r in rs if r[k] is not None]
        return float(np.median(xs)) if xs else None

    def pct(rs, k, q):
        xs = [r[k] for r in rs if r[k] is not None]
        return float(np.percentile(xs, q)) if xs else None

    upright = [r for r in yard if r["id"].split(".")[1] in ("0", "3", "5", "6", "7", "8")]
    print(f"live sheet: skin dE p90 {pct(yard, 'dE', 90):.1f}, shirt p90 {pct(yard, 'shirt', 90):.1f}, "
          f"trousers p90 {pct(yard, 'trousers', 90):.1f}, shoes p90 {pct(yard, 'shoes', 90):.1f}, "
          f"hair p90 {pct(yard, 'hair', 90):.1f}")
    print(f"            head size {pct(yard, 'size', 10):.0%}-{pct(yard, 'size', 90):.0%}, "
          f"sides {pct(yard, 'sides', 10):.0%}-{pct(yard, 'sides', 90):.0%}, "
          f"hair cover {pct(yard, 'cover', 10):.0%}-{pct(yard, 'cover', 90):.0%}, "
          f"detail (standing rows) {pct(upright, 'sharp', 10):.0%}-{pct(upright, 'sharp', 90):.0%}")
    print(f"{'pack':12} {'frames':>6} {'skin':>5} {'shirt':>5} {'trou':>5} {'shoes':>5} {'hair':>5} "
          f"{'head':>5} {'sharp':>5} {'sides':>5} {'cover':>5}")
    failed = []
    pc = lambda v: "-" if v is None else f"{v:.0%}"  # noqa: E731
    de = lambda v: "-" if v is None else f"{v:.1f}"  # noqa: E731
    over = lambda v, top: v is not None and v > top  # noqa: E731
    for pack, rs in out.items():
        m = {k: med(rs, k) for k in ("dE", "shirt", "trousers", "shoes", "hair", "size", "sharp")}
        why = []
        if over(m["dE"], SKIN_MAX):
            why.append("skin")
        why += [g for g in heads.GARMENTS if over(m[g], GARMENT_MAX)]
        if over(m["hair"], HAIR_MAX):
            why.append("hair")
        sized = sum(r["size"] is not None for r in rs)
        if m["size"] is not None and sized >= HEADS_MIN and abs(m["size"] - 1) > SIZE_OFF:
            why.append("head")
        off_floor = [r["id"] for r in rs if r["floor"] is not None and abs(r["floor"]) > 1]
        if off_floor:
            why.append("floor: " + " ".join(off_floor))
        if why:
            failed.append(f"{pack} ({', '.join(why)})")
        print(f"{pack:12} {len(rs):6} {de(m['dE']):>5} {de(m['shirt']):>5} {de(m['trousers']):>5} "
              f"{de(m['shoes']):>5} {de(m['hair']):>5} {pc(m['size']):>5} {pc(m['sharp']):>5} "
              f"{pc(med(rs, 'sides')):>5} {pc(med(rs, 'cover')):>5}{'  < ' + ', '.join(why) if why else ''}")
    allr = [r for rs in out.values() for r in rs]
    print(f"all {len(allr)} frames: skin dE median {med(allr, 'dE'):.1f}, p90 {pct(allr, 'dE', 90):.1f}; "
          f"shirt {med(allr, 'shirt'):.1f}, p90 {pct(allr, 'shirt', 90):.1f}; "
          f"trousers {med(allr, 'trousers'):.1f}, p90 {pct(allr, 'trousers', 90):.1f}; "
          f"shoes {med(allr, 'shoes'):.1f}, p90 {pct(allr, 'shoes', 90):.1f}; "
          f"hair {med(allr, 'hair'):.1f}, p90 {pct(allr, 'hair', 90):.1f}")
    print(f"           head median {med(allr, 'size'):.1%}, {pct(allr, 'size', 10):.0%}-{pct(allr, 'size', 90):.0%}; "
          f"detail median {med(allr, 'sharp'):.0%}, {pct(allr, 'sharp', 10):.0%}-{pct(allr, 'sharp', 90):.0%}; "
          f"sides median {med(allr, 'sides'):.0%}, hair cover median {med(allr, 'cover'):.0%}")
    standing = [r for r in allr if r["floor"] is not None]
    print(f"           {sum(abs(r['floor']) <= 1 for r in standing)} of {len(standing)} standing frames have "
          f"their feet on the floor row")
    if "--json" in args:
        Path(args[args.index("--json") + 1]).write_text(json.dumps({"live": yard, "packs": out}), encoding="utf-8")
    sharp = med(allr, "sharp")
    if sharp is not None and not SHARP_MIN <= sharp <= SHARP_MAX:
        failed.append(f"all frames (detail {sharp:.0%} of live's)")
    if "--check" in args and failed:
        raise SystemExit("off the live sprite: " + "; ".join(failed))


if __name__ == "__main__":
    main()
