"""
Build Amr's lazy sprite packs from the generated art sheets.

    python -I scripts/build-mascot-packs.py <sheets folder> [--preview <folder>]

The sheets folder holds S01-faces.png … S10-stroll.png: 1536 x 1024, eight
384 x 512 slots each, slot 1 the standard stance (docs/mascot/AMR-ART-BRIEF.md).
It may also hold any of the context sheets S11-sun.png … S64-lights.png
(docs/mascot/context-sheets.json); each one present becomes a pack, and the
ones not drawn yet are left out, so they can come back a few at a time.
Each slot is cleaned, registered to the live sheet (public/mascot/amr.*.webp) —
same height, same floor row, centred on its anchor — and packed into small WebP
sheets under public/mascot, named after their bytes. A pack's cells are the live
sheet's 192 x 208 with 16 more rows on top, for the hats and balloons that reach
above his hair (384 x 448 for sharp screens). The pack manifest is written to
src/components/agent/mascot/mascot-packs.ts. With --preview, contact sheets for
review land in that folder too.

Needs Pillow and numpy. The source PNGs never ship; only the packs do.
"""

import hashlib
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public" / "mascot"
CONTEXT_SPEC = ROOT / "docs" / "mascot" / "context-sheets.json"
MANIFEST = ROOT / "src" / "components" / "agent" / "mascot" / "mascot-packs.ts"

SLOT_W, SLOT_H = 384, 512
CELL_W, CELL_H = 192, 208  # the live sheet's cells
HEADROOM = 16  # a pack's cells have this many more rows on top
PACK_H = CELL_H + HEADROOM
COLUMNS = 8
# The live idle frame, measured on alpha > 32: rows 25..201, feet centred on x 96.9.
LIVE_TOP, LIVE_FLOOR = 25, 202  # floor is the bottom edge of the lowest row
LIVE_FEET_X = 96.9 + 0.5  # pixel centre, in continuous coordinates
STANCE_H = LIVE_FLOOR - LIVE_TOP
PACK_FLOOR = LIVE_FLOOR + HEADROOM  # the floor row in a pack's cell
SCALES = (1, 2)

# Every pose, by sheet and slot: its frame id and how it lines up.
#   feet  — the mean of the lowest band (planted feet stay planted)
#   shins — the legs between the ankles and the knees (walking)
#   hip   — the thighs (one foot lifted)
#   head  — the top of the hair (held up by the collar; the code lifts him)
#   sheet — slot 1's own placement (S01, where only the face changes)
SHEETS = {
    "S01-faces": ("faces", "sheet", [
        "face.default", "face.talk-closed", "face.talk-small", "face.talk-wide",
        "face.happy", "face.surprised", "face.sleepy", "face.concerned",
    ]),
    "S02-explaining": ("explain", "feet", [
        None, "explain.1", "explain.2", "explain.3",
        "explain.4", "explain.5", "explain.6", "explain.shrug",
    ]),
    "S03-pointing": ("point", "feet", [
        None, "point.l", "point.ul", "point.u", "point.ur", "point.r", "point.dl", "point.dr",
    ]),
    "S04-touch": ("touch", "feet", [
        None, "touch.poke", "touch.giggle", "touch.tickle-l", "touch.tickle-r",
        "touch.pat-l", "touch.pat-r", "touch.bashful",
    ]),
    "S05-lifted": ("lifted", "feet", [
        None, ("lifted.hang", "head"), ("lifted.swing-l", "head"), ("lifted.swing-r", "head"),
        ("lifted.flail", "head"), "lifted.land", "lifted.recover", "lifted.tidy",
    ]),
    "S06-balance": ("balance", "feet", [
        None, "balance.tip-l", "balance.tip-r", ("balance.whoa", "hip"), "balance.steady",
        "dizzy.a", "dizzy.b", "dizzy.shake-off",
    ]),
    "S07-rest": ("rest", "feet", [
        None, "rest.yawn", "rest.stretch", "rest.sit-down", "rest.sitting",
        "rest.doze-a", "rest.doze-b", "rest.startled",
    ]),
    "S08-page": ("page", "feet", [
        None, "page.wind-a", "page.wind-b", "page.watching", "page.yes",
        "page.clap-a", "page.clap-b", "page.downcast",
    ]),
    "S09-social": ("social", "feet", [
        None, "social.hi5-offer", "social.hi5", "social.hi5-after", "social.peek-hide",
        "social.peek-found", "social.you", "social.bow",
    ]),
    "S10-stroll": ("stroll", "shins", [
        None, "stroll.r-1", "stroll.r-2", "stroll.r-3",
        "stroll.l-1", "stroll.l-2", "stroll.l-3", ("stroll.turn", "feet"),
    ]),
}


def context_sheets() -> dict:
    """The context sheets (S11 on), from their spec, in SHEETS' shape, with their group."""
    spec = json.loads(CONTEXT_SPEC.read_text(encoding="utf-8"))
    out = {}
    for s in spec["sheets"]:
        ids = [None] + [(slot["id"], slot.get("kind", "feet")) for slot in s["slots"]]
        out[f"{s['sheet']}-{s['pack']}"] = (s["pack"], "feet", ids, s["group"])
    return out


def add_context_sheets(src: Path) -> list[str]:
    """Add every context sheet present in `src` to SHEETS and PACKS; returns their names."""
    found = []
    for stem, (pack, kind, ids, _group) in context_sheets().items():
        if not (src / f"{stem}.png").exists():
            continue
        SHEETS[stem] = (pack, kind, ids)
        PACKS[pack] = [e[0] if isinstance(e, tuple) else e for e in ids if e]
        found.append(stem)
    return found


def clean(rgba: np.ndarray) -> np.ndarray:
    """Drop the faint alpha the generator leaves around the figure, and the RGB under it."""
    out = rgba.copy()
    a = out[..., 3]
    a[a <= 8] = 0
    out[a == 0] = 0
    return out


def bounds(a: np.ndarray):
    ys, xs = np.nonzero(a > 32)
    return ys.min(), ys.max() + 1, xs.min(), xs.max() + 1


def anchor_x(a: np.ndarray, kind: str, stance_h: int) -> float:
    """The x (continuous) a slot lines up on."""
    top, floor, _, _ = bounds(a)
    solid = a > 128

    def band(r0: float, r1: float) -> float:
        _, xs = np.nonzero(solid[int(r0):int(r1)])
        return float(xs.mean()) + 0.5

    if kind == "feet":
        return band(floor - 0.12 * stance_h, floor)
    if kind == "shins":
        return band(floor - 0.30 * stance_h, floor - 0.12 * stance_h)
    if kind == "hip":
        return band(floor - 0.45 * stance_h, floor - 0.30 * stance_h)
    if kind == "head":
        return band(top, top + 0.12 * stance_h)
    raise ValueError(kind)


def register(slot: Image.Image, scale: float, ax: float, floor_y: float, k: int) -> Image.Image:
    """Resample a slot into one pack cell at k x: anchor x to the live feet, floor_y to the floor."""
    s = scale * k
    w, h = CELL_W * k, PACK_H * k
    x0 = ax - LIVE_FEET_X * k / s
    y0 = floor_y - PACK_FLOOR * k / s
    box = (x0, y0, x0 + w / s, y0 + h / s)
    # Pad so the box never leaves the image, and resample premultiplied (no dark fringes).
    pad = 400
    padded = Image.new("RGBA", (slot.width + 2 * pad, slot.height + 2 * pad), (0, 0, 0, 0))
    padded.paste(slot, (pad, pad))
    box = tuple(v + pad for v in box)
    cell = padded.convert("RGBa").resize((w, h), Image.LANCZOS, box=box).convert("RGBA")
    arr = np.array(cell)
    arr[arr[..., 3] < 3] = 0
    return Image.fromarray(arr)


def overflow(cell: Image.Image) -> list[str]:
    """Which cell edges the figure touches (it shouldn't touch any)."""
    a = np.array(cell)[..., 3] > 32
    edges = []
    if a[:, 0].any():
        edges.append("left")
    if a[:, -1].any():
        edges.append("right")
    if a[0].any():
        edges.append("top")
    if a[-1].any():
        edges.append("bottom")
    return edges


def load_frames(src: Path):
    """Every registered frame: {frame id: {k: cell image}}, plus the stances."""
    frames, stances, notes = {}, {}, []
    for stem, (pack, default_kind, ids) in SHEETS.items():
        sheet = np.array(Image.open(src / f"{stem}.png").convert("RGBA"))
        if sheet.shape[:2] != (1024, 1536):
            raise SystemExit(f"{stem}: expected 1536 x 1024, got {sheet.shape[1]} x {sheet.shape[0]}")
        sheet = clean(sheet)
        slots = [sheet[(i // 4) * SLOT_H:(i // 4 + 1) * SLOT_H, (i % 4) * SLOT_W:(i % 4 + 1) * SLOT_W]
                 for i in range(8)]
        top, floor, _, _ = bounds(slots[0][..., 3])
        stance_h = floor - top
        scale = STANCE_H / stance_h
        stance_ax = anchor_x(slots[0][..., 3], "feet", stance_h)
        stances[pack] = {k: register(Image.fromarray(slots[0]), scale, stance_ax, floor, k) for k in SCALES}
        for i, entry in enumerate(ids):
            if entry is None:
                continue
            fid, kind = entry if isinstance(entry, tuple) else (entry, default_kind)
            a = slots[i][..., 3]
            s_top, s_floor, _, _ = bounds(a)
            if kind == "sheet":
                ax, fy = stance_ax, floor
            elif kind == "head":
                # Held up: the hair stays where the stance's hair is.
                ax, fy = anchor_x(a, "head", stance_h), s_top + stance_h
            else:
                ax, fy = anchor_x(a, kind, stance_h), s_floor
            img = Image.fromarray(slots[i])
            frames[fid] = {k: register(img, scale, ax, fy, k) for k in SCALES}
            edges = overflow(frames[fid][1])
            if edges:
                notes.append(f"{fid} touches the cell's {', '.join(edges)} edge")
    return frames, stances, notes


# Talking: the S01 heads (default smile and three mouths) go onto each S02 gesture,
# so the face moves while the hands explain. Done at 2x, then reduced for 1x.
MOUTHS = {
    "default": "face.default",
    "closed": "face.talk-closed",
    "small": "face.talk-small",
    "wide": "face.talk-wide",
}
GESTURES = [f"explain.{i}" for i in range(1, 7)]


def neck_row(a: np.ndarray) -> int:
    """The narrowest row between the head and the shoulders."""
    top, floor, _, _ = bounds(a)
    h = floor - top
    rows = range(int(top + 0.25 * h), int(top + 0.45 * h))
    return min(rows, key=lambda r: ((a[r] > 128).sum(), r))


def head_offset(body: np.ndarray, head: np.ndarray, rows: slice, reach: int = 8) -> tuple[int, int]:
    """Shift (dx, dy) of `head` that best matches the head already on `body`."""
    best = None
    for dy in range(-reach, reach + 1):
        for dx in range(-reach, reach + 1):
            sh = np.roll(np.roll(head, dy, 0), dx, 1)
            m = (sh[rows, :, 3] > 200) & (body[rows, :, 3] > 200)
            if m.sum() < 1000:
                continue
            err = np.abs(body[rows][m][:, :3] - sh[rows][m][:, :3]).mean()
            if best is None or err < best[0]:
                best = (err, dx, dy)
    return best[1], best[2]


def flood(mask: np.ndarray, seeds: np.ndarray) -> np.ndarray:
    """The pixels of `mask` connected (4-way) to any of `seeds`."""
    out = seeds & mask
    while True:
        grown = out.copy()
        grown[1:] |= out[:-1]
        grown[:-1] |= out[1:]
        grown[:, 1:] |= out[:, :-1]
        grown[:, :-1] |= out[:, 1:]
        grown &= mask
        if (grown == out).all():
            return out
        out = grown


def dilate(mask: np.ndarray, r: int) -> np.ndarray:
    out = mask.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= r * r:
                out |= np.roll(np.roll(mask, dy, 0), dx, 1)
    return out


def swap_head(body_img: Image.Image, head_img: Image.Image, dx: int, dy: int, neck: int,
              whole: bool = False) -> Image.Image:
    """`body_img` with the head of `head_img` (shifted by dx, dy), feathered in at the neck.
    With `whole`, nothing of the body above the seam survives (no hands up there)."""
    body = np.array(body_img.convert("RGBa")).astype(np.float32)
    head = np.roll(np.roll(np.array(head_img.convert("RGBa")).astype(np.float32), dy, 0), dx, 1)
    seam = neck + dy  # in body coordinates
    lo, hi = seam - 8, seam + 2  # feather band at 2x
    h = body.shape[0]
    w_head = np.zeros(h, np.float32)
    w_head[:lo] = 1
    w_head[lo:hi] = np.linspace(1, 0, hi - lo)
    if whole:
        w = w_head[:, None, None]
        out = np.ascontiguousarray(np.clip(head * w + body * (1 - w), 0, 255).astype(np.uint8))
        return Image.frombytes("RGBa", (out.shape[1], out.shape[0]), out.tobytes()).convert("RGBA")
    head_mask = head[..., 3] > 0
    head_mask[hi:] = False
    # The body's own head, where it would show past the new one (its ears, when the two
    # are the same size): the part of the body above the seam that touches the new head.
    # A raised hand beside the head doesn't touch it, so it stays.
    above = body[..., 3] > 0
    above[lo:] = False
    old_head = flood(above, above & head_mask)
    body[old_head & ~dilate(head_mask, 1)] = 0
    # Remove the body's own head where the new one will sit (and a hair around it),
    # but keep hands raised beside the head.
    near = dilate(head_mask, 3)
    keep = np.where(near[..., None] & (np.arange(h)[:, None, None] < lo), 0.0, 1.0)
    base = body * keep
    wh = w_head[:, None, None] * head_mask[..., None]
    a = head[..., 3:4] / 255.0
    # Premultiplied "head over body", weighted by the feather.
    over = head + base * (1 - a)
    out = over * wh + body * (1 - wh)
    out = np.ascontiguousarray(np.clip(out, 0, 255).astype(np.uint8))
    return Image.frombytes("RGBa", (out.shape[1], out.shape[0]), out.tobytes()).convert("RGBA")


def align_faces(frames) -> list[str]:
    """S01 promises one body with only the face changing, but an edit can move a head
    (the hair edits moved six of them up to 11 px at 2x), and lip-sync flips between
    these faces many times a second. So each face goes onto face.default's body with
    its own head lined up on the default head: switching faces never moves him."""
    ref = frames["face.default"][2]
    ref_a = np.array(ref).astype(int)
    neck = neck_row(ref_a[..., 3])
    rows = slice(max(neck - 130, 0), neck)
    notes = []
    for fid in SHEETS["S01-faces"][2][1:]:
        dx, dy = head_offset(ref_a, np.array(frames[fid][2]).astype(int), rows, reach=16)
        if max(abs(dx), abs(dy)) > 2:
            notes.append(f"{fid}: head moved {-dx:+d}, {-dy:+d} px at 2x; lined up on face.default")
        out2 = swap_head(ref, frames[fid][2], dx, dy, neck, whole=True)
        out1 = out2.convert("RGBa").resize((CELL_W, PACK_H), Image.LANCZOS).convert("RGBA")
        frames[fid] = {1: out1, 2: out2}
    return notes


def build_talk(frames) -> None:
    ref = np.array(frames["face.default"][2]).astype(int)
    neck = neck_row(ref[..., 3])
    rows = slice(max(neck - 130, 0), neck)
    for g, gid in enumerate(GESTURES, start=1):
        body2 = frames[gid][2]
        dx, dy = head_offset(np.array(body2).astype(int), ref, rows)
        for mouth, fid in MOUTHS.items():
            out2 = swap_head(body2, frames[fid][2], dx, dy, neck)
            out1 = out2.convert("RGBa").resize((CELL_W, PACK_H), Image.LANCZOS).convert("RGBA")
            frames[f"talk.{g}-{mouth}"] = {1: out1, 2: out2}


# Head size. Each sheet is scaled so his stance is as tall as the live one, but the
# generator draws his head 2-9% bigger and his shoulders that much lower, so he looks
# bigger than the live sheet in every pose. From the waist down the two match. So each
# frame's head alone is shrunk to the live size, around the head's centre, easing back
# to no change across the neck and shoulders: no seams, and a hand on his head shrinks
# with it but stays on its arm.

def head_box(img: Image.Image) -> tuple[int, int, int, int]:
    """(top, neck, height, width) of the head of a standing figure, at its own scale."""
    m = np.array(img.getchannel("A")) > 128
    ys = np.nonzero(m.any(1))[0]
    top, bot = int(ys[0]), int(ys[-1])
    h = bot - top
    w = m.sum(1)
    neck = min(range(int(top + 0.3 * h), int(top + 0.55 * h)), key=lambda r: (w[r], r))
    return top, neck, neck - top, int(w[top:neck].max())


def live_cell(live: Image.Image, row: int = 0, col: int = 0) -> Image.Image:
    """A live-sheet cell where a pack's cell puts him: with the headroom above."""
    out = Image.new("RGBA", (CELL_W, PACK_H), (0, 0, 0, 0))
    out.paste(live.crop((col * CELL_W, row * CELL_H, (col + 1) * CELL_W, (row + 1) * CELL_H)), (0, HEADROOM))
    return out


def live_head() -> tuple[int, int, int, int]:
    """head_box of the live idle, in a pack cell's rows at 2x."""
    idle = live_cell(Image.open(next(PUBLIC.glob("amr.*.webp"))).convert("RGBA"))
    return head_box(idle.convert("RGBa").resize((CELL_W * 2, PACK_H * 2), Image.LANCZOS).convert("RGBA"))


def head_scales(stances) -> dict[str, float]:
    """Per sheet: how much to shrink its heads to the live head (1 = leave them)."""
    _, _, lh, lw = live_head()
    out = {}
    for pack, st in stances.items():
        _, _, h, w = head_box(st[2])
        s = float(np.sqrt((lh / h) * (lw / w)))
        out[pack] = 1.0 if s > 0.985 else max(s, 0.85)
    return out


def hair_blob(img: Image.Image) -> tuple[float, int] | None:
    """(centre x, top row) of his hair: the biggest near-black patch in the upper body."""
    px = np.array(img).astype(int)
    rgb = px[..., :3]
    dark = (px[..., 3] > 200) & (rgb @ [299, 587, 114] < 70_000) & (rgb.max(-1) - rgb.min(-1) < 45)
    rows = np.nonzero((px[..., 3] > 128).any(1))[0]
    if not len(rows):
        return None
    top, bot = rows[0], rows[-1]
    dark[int(top + 0.6 * (bot - top)):] = False  # belt, shoes
    seen = np.zeros(dark.shape, bool)
    best = None
    H, W = dark.shape
    for y0, x0 in zip(*np.nonzero(dark)):
        if seen[y0, x0]:
            continue
        seen[y0, x0] = True
        stack, pts = [(y0, x0)], []
        while stack:
            y, x = stack.pop()
            pts.append((y, x))
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < H and 0 <= xx < W and dark[yy, xx] and not seen[yy, xx]:
                    seen[yy, xx] = True
                    stack.append((yy, xx))
        if best is None or len(pts) > len(best):
            best = pts
    if best is None or len(best) < 200:
        return None
    ys, xs = np.array(best).T
    return float(np.median(xs)), int(ys.min())


def shrink_head(img: Image.Image, cx: float, cy: float, radius: float, s: float,
                to_y: float | None = None) -> Image.Image:
    """`img` (2x) with everything within `radius` of (cx, cy) shrunk by s toward it (and
    moved so its centre lands on row `to_y`, if given), easing back to no change over
    the next 0.7 radius."""
    a = np.array(img.convert("RGBa")).astype(np.float32)
    H, W = a.shape[:2]
    ty = cy if to_y is None else to_y
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    dx, dy = xx - cx, yy - ty
    d = np.hypot(dx, dy)
    r1, r2 = radius * s, radius * 1.7
    t = np.clip((d - r1) / (r2 - r1), 0, 1)
    w = 1 - t * t * (3 - 2 * t)  # 1 on the head, 0 past the shoulders
    sx = xx + dx * (1 / s - 1) * w
    sy = yy + ((cy - ty) + dy * (1 / s - 1)) * w
    # Bilinear, premultiplied; outside the cell is clear.
    x0, y0 = np.floor(sx).astype(int), np.floor(sy).astype(int)
    fx, fy = (sx - x0)[..., None], (sy - y0)[..., None]
    pad = np.zeros((H + 2, W + 2, 4), np.float32)
    pad[1:-1, 1:-1] = a

    def at(yi, xi):
        return pad[np.clip(yi + 1, 0, H + 1), np.clip(xi + 1, 0, W + 1)]

    out = (at(y0, x0) * (1 - fx) * (1 - fy) + at(y0, x0 + 1) * fx * (1 - fy)
           + at(y0 + 1, x0) * (1 - fx) * fy + at(y0 + 1, x0 + 1) * fx * fy)
    out = np.ascontiguousarray(np.clip(out + 0.5, 0, 255).astype(np.uint8))
    return Image.frombytes("RGBa", (W, H), out.tobytes()).convert("RGBA")


def shrunk(img2: Image.Image, cx: float, cy: float, radius: float, s: float,
           to_y: float | None = None) -> dict:
    out2 = shrink_head(img2, cx, cy, radius, s, to_y)
    return {1: out2.convert("RGBa").resize((CELL_W, PACK_H), Image.LANCZOS).convert("RGBA"), 2: out2}


def shrink_faces(frames, scales) -> None:
    """The S01 faces share one body and one head position, so one centre for all of
    them, taken from face.default. Their heads also go where the live idle's head is:
    talking flips between these faces and the S02 gestures, whose shoulders are higher
    (as the live sheet's are), and the head mustn't bob between the two."""
    s = scales["faces"]
    if s == 1.0:
        return
    top, neck, h, w = head_box(frames["face.default"][2])
    m = np.array(frames["face.default"][2].getchannel("A"))[top:neck] > 128
    cols = np.nonzero(m.any(0))[0]
    cx, cy = (cols[0] + cols[-1] + 1) / 2, (top + neck) / 2
    live_top, live_neck, _, _ = live_head()
    for fid in SHEETS["S01-faces"][2]:
        frames[fid] = shrunk(frames[fid][2], cx, cy, max(h, w) / 2, s, (live_top + live_neck) / 2)


def shrink_heads(frames, stances, scales) -> list[str]:
    """Every other shipped frame, its head found by its hair."""
    pack_of = {}
    for stem, (pack, _, ids) in SHEETS.items():
        for e in ids:
            if e:
                pack_of[e[0] if isinstance(e, tuple) else e] = pack
    notes = []
    for pack, fids in PACKS.items():
        if pack in ("faces", "talk"):
            continue
        for fid in fids:
            sheet = pack_of[fid]
            s = scales[sheet]
            if s == 1.0:
                continue
            top, _, h, w = head_box(stances[sheet][2])
            hair = hair_blob(frames[fid][2])
            if hair is None:
                notes.append(f"{fid}: no hair found, head left as drawn")
                continue
            cx, hair_top = hair
            frames[fid] = shrunk(frames[fid][2], cx, hair_top + h / 2, max(h, w) / 2, s)
    return notes


# What ships, pack by pack. Each pack loads only when he first needs it.
PACKS = {
    "faces": [f for f in SHEETS["S01-faces"][2]],
    "talk": [f"talk.{g}-{m}" for g in range(1, 7) for m in MOUTHS],
    "point": [e for e in SHEETS["S03-pointing"][2] if e],
    "touch": [e for e in SHEETS["S04-touch"][2] if e],
    "lifted": [e[0] if isinstance(e, tuple) else e for e in SHEETS["S05-lifted"][2] if e],
    "balance": [e[0] if isinstance(e, tuple) else e for e in SHEETS["S06-balance"][2] if e],
    "rest": [e for e in SHEETS["S07-rest"][2] if e],
    "page": [e for e in SHEETS["S08-page"][2] if e] + ["explain.shrug"],
    "social": [e for e in SHEETS["S09-social"][2] if e],
    "stroll": [e[0] if isinstance(e, tuple) else e for e in SHEETS["S10-stroll"][2] if e],
}


def webp_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=86, method=6, alpha_quality=90, exact=False)
    return buf.getvalue()


def write_packs(frames) -> dict:
    """Write each pack's 1x and 2x WebP into public/mascot; returns the manifest."""
    for old in PUBLIC.glob("amr-*.webp"):
        old.unlink()
    manifest = {}
    for pack, fids in PACKS.items():
        entry = {"frames": len(fids)}
        for k in SCALES:
            data = webp_bytes(pack_sheet([frames[f][k] for f in fids], k))
            digest = hashlib.sha256(data).hexdigest()[:8]
            name = f"amr-{pack}{'' if k == 1 else '@2x'}.{digest}.webp"
            (PUBLIC / name).write_bytes(data)
            entry["src" if k == 1 else "src2x"] = f"/mascot/{name}"
            entry["bytes" if k == 1 else "bytes2x"] = len(data)
        manifest[pack] = entry
    return manifest


def write_manifest(manifest: dict) -> None:
    lines = [
        "/**",
        " * Amr's lazy sprite packs. GENERATED by scripts/build-mascot-packs.py from the",
        " * art sheets (docs/mascot/AMR-ART-BRIEF.md); don't edit by hand, run the script.",
        " *",
        " * Each pack is a WebP of cells 8 to a row, registered to the live sheet (same",
        " * height, same floor row), with a twin at twice the size for sharp screens. A",
        " * cell is the live sheet's 192 x 208 with `headroom` more rows on top, for the",
        " * hats and balloons that reach above his hair.",
        " * File names carry a hash of their bytes, so /mascot/* can be cached for a year.",
        " * No imports, so scripts can load it with Node's type stripping.",
        " */",
        "",
        f"export const PACK_COLUMNS = {COLUMNS};",
        "",
        "/** A pack's cell at 1x: the live sheet's, plus `headroom` rows on top. */",
        f"export const PACK_CELL = {{ w: {CELL_W}, h: {PACK_H}, headroom: {HEADROOM} }} as const;",
        "",
        "export const PACKS = {",
    ]
    for pack, e in manifest.items():
        lines += [
            f"  {pack}: {{",
            f'    src: "{e["src"]}",',
            f'    src2x: "{e["src2x"]}",',
            f"    frames: {e['frames']},",
            f"    bytes: {e['bytes']},",
            f"    bytes2x: {e['bytes2x']},",
            "  },",
        ]
    lines += ["} as const;", "", "export type PackId = keyof typeof PACKS;", "",
              "/** Every frame: its pack and its cell (row-major, 8 to a row). */",
              "export const FRAMES = {"]
    for pack, fids in PACKS.items():
        for i, f in enumerate(fids):
            lines.append(f'  "{f}": ["{pack}", {i}],')
    lines += ["} as const satisfies Record<string, readonly [PackId, number]>;", "",
              "export type FrameId = keyof typeof FRAMES;", ""]
    MANIFEST.write_text("\n".join(lines), encoding="utf-8", newline="\n")


def pack_sheet(cells: list[Image.Image], k: int) -> Image.Image:
    rows = (len(cells) + COLUMNS - 1) // COLUMNS
    out = Image.new("RGBA", (COLUMNS * CELL_W * k, rows * PACK_H * k), (0, 0, 0, 0))
    for i, c in enumerate(cells):
        out.paste(c, ((i % COLUMNS) * CELL_W * k, (i // COLUMNS) * PACK_H * k))
    return out


def main() -> None:
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    src = Path(args[0])
    preview = Path(args[args.index("--preview") + 1]) if "--preview" in args else None
    found = add_context_sheets(src)
    total = len(context_sheets())
    print(f"context sheets: {len(found)} of {total}" + (f" ({', '.join(found)})" if found else ""))
    frames, stances, notes = load_frames(src)
    notes += align_faces(frames)
    scales = head_scales(stances)
    print("heads shrunk to the live size:", ", ".join(f"{p} {s:.3f}" for p, s in scales.items()))
    shrink_faces(frames, scales)
    build_talk(frames)
    notes += shrink_heads(frames, stances, scales)
    for pack, st in stances.items():  # for the previews, like the frames
        if scales[pack] != 1.0:
            top, neck, h, w = head_box(st[2])
            m = np.array(st[2].getchannel("A"))[top:neck] > 128
            cols = np.nonzero(m.any(0))[0]
            stances[pack] = shrunk(st[2], (cols[0] + cols[-1] + 1) / 2, (top + neck) / 2, max(h, w) / 2, scales[pack])
    for n in notes:
        print("note:", n)
    manifest = write_packs(frames)
    write_manifest(manifest)
    for pack, e in manifest.items():
        print(f"{pack:8} {e['frames']:2} frames  {e['bytes'] // 1024:4} KB  2x {e['bytes2x'] // 1024:4} KB")
    total = sum(e["bytes"] for e in manifest.values())
    total2 = sum(e["bytes2x"] for e in manifest.values())
    print(f"total    {total // 1024} KB, 2x {total2 // 1024} KB")
    if preview:
        preview.mkdir(parents=True, exist_ok=True)
        write_previews(frames, stances, preview)
        print("previews in", preview)


def write_previews(frames, stances, out: Path) -> None:
    """Contact sheets and hair checks: the ten core sheets as `contact-*` and `hair@2x`,
    each group of context sheets as `contact-<group>-*` and `hair-<group>@2x`."""
    live = Image.open(next(PUBLIC.glob("amr.*.webp"))).convert("RGBA")
    groups: dict[str, dict[str, list[str]]] = {"": {}}
    ctx = context_sheets()
    for stem, (pack, _, ids) in SHEETS.items():
        group = ctx[stem][3] if stem in ctx else ""
        fids = [e[0] if isinstance(e, tuple) else e for e in ids if e is not None]
        groups.setdefault(group, {})[pack] = fids
    for group, by_pack in groups.items():
        if by_pack:
            write_contacts(frames, stances, by_pack, live, out, f"{group}-" if group else "")
            write_hair_check(frames, stances, by_pack, live, out, f"-{group}" if group else "")
    # The talking composites, at 2x, on both backgrounds.
    talk = PACKS["talk"]
    for bg, name in (((255, 255, 255, 255), "light"), ((30, 30, 34, 255), "dark")):
        img = Image.new("RGBA", (4 * CELL_W * 2, 6 * PACK_H * 2), bg)
        for i, f in enumerate(talk):
            img.alpha_composite(frames[f][2], ((i % 4) * CELL_W * 2, (i // 4) * PACK_H * 2))
        img.convert("RGB").save(out / f"talk-{name}@2x.png")


def write_contacts(frames, stances, by_pack, live: Image.Image, out: Path, prefix: str) -> None:
    idle = live_cell(live)
    for k in SCALES:
        rows = []
        for pack, fids in by_pack.items():
            row = [idle.resize((CELL_W * k, PACK_H * k), Image.LANCZOS), stances[pack][k]]
            row += [frames[f][k] for f in fids]
            rows.append(row)
        w = max(len(r) for r in rows) * CELL_W * k
        for bg, name in (((255, 255, 255, 255), "light"), ((30, 30, 34, 255), "dark")):
            img = Image.new("RGBA", (w, len(rows) * PACK_H * k), bg)
            for y, row in enumerate(rows):
                for x, c in enumerate(row):
                    img.alpha_composite(c, (x * CELL_W * k, y * PACK_H * k))
            # Guides: the live figure's top and floor rows.
            arr = np.array(img)
            for y in range(len(rows)):
                for r in ((LIVE_TOP + HEADROOM) * k, PACK_FLOOR * k):
                    yy = y * PACK_H * k + r
                    arr[yy, ::4] = (255, 0, 0, 255)
            Image.fromarray(arr).convert("RGB").save(out / f"contact-{prefix}{name}@{k}x.png")


# The live sheet's head (row, column) from the angles in docs/mascot/reference/ref-hair.png:
# facing us, turned both ways, looking up, looking down, and three in between.
HAIR_ANGLES = [(0, 0), (2, 3), (1, 3), (9, 0), (10, 0), (9, 6), (10, 2), (10, 6)]


def head_crop(cell: Image.Image, k: int) -> Image.Image:
    """His head (hair to chin) at scale k, centred on his hair, so a pointing arm or
    raised hands don't pull the crop away. The review page's hair check does the same."""
    px = np.array(cell).astype(int)
    w, h = 112 * k, 96 * k
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    rows = np.nonzero((px[..., 3] > 32).any(1))[0]
    if not len(rows):
        return out
    top = int(rows[0])
    rgb = px[..., :3]
    dark = (px[..., 3] > 200) & (rgb @ [299, 587, 114] < 70_000) & (rgb.max(-1) - rgb.min(-1) < 45)
    ys, xs = np.nonzero(dark[top:top + 80 * k])
    cx, hair_top = CELL_W * k // 2, top
    if len(xs) >= 20 * k * k:
        cx = int(np.median(xs))
        hits = np.nonzero(dark[:, max(0, cx - 20 * k):cx + 20 * k].sum(1) >= 5 * k)[0]
        hair_top = int(hits[0]) if len(hits) else top
    y0 = hair_top - 6 * k
    out.paste(cell.crop((cx - w // 2, y0, cx + w // 2, y0 + h)), (0, 0))
    return out


def write_hair_check(frames, stances, by_pack, live: Image.Image, out: Path, suffix: str = "") -> None:
    """hair@2x.png: the live sheet's head from eight angles, then every sheet's heads."""
    k = 2
    live_heads = [head_crop(live.crop((c * CELL_W, r * CELL_H, (c + 1) * CELL_W, (r + 1) * CELL_H))
                            .resize((CELL_W * k, CELL_H * k), Image.LANCZOS), k) for r, c in HAIR_ANGLES]
    rows = [live_heads] + [[head_crop(stances[p][k], k)] + [head_crop(frames[f][k], k) for f in fids]
                           for p, fids in by_pack.items()]
    tw, th = 112 * k, 96 * k
    img = Image.new("RGBA", (max(len(r) for r in rows) * tw, len(rows) * th), (244, 241, 234, 255))
    for y, row in enumerate(rows):
        for x, c in enumerate(row):
            img.alpha_composite(c, (x * tw, y * th))
    arr = np.array(img)
    arr[th - 2:th, :] = (200, 40, 40, 255)  # under the live row
    Image.fromarray(arr).convert("RGB").save(out / f"hair{suffix}@{k}x.png")


if __name__ == "__main__":
    main()
