"""
Measure Amr's head in a pack cell: its size, its hair and the colour of his skin.

Shared by scripts/build-mascot-packs.py (which sizes every head and matches the
skin to the live sprite) and scripts/audit-mascot-heads.py (which checks the
shipped packs against the live sprite). Works on a cell at 2x: 384 x 448 RGBA,
his feet on the floor row, as the packs are built.

    hair  the biggest near-black patch in his upper body (thin lines dropped)
    face  the skin joined to the hair, cut at the neck
    size  the head's width at the ears times the hair's width, against live idle:
          neither changes when he tilts his head or holds a hand under his chin

Needs Pillow and numpy only.
"""

from __future__ import annotations

import numpy as np
from PIL import Image

# Frames whose head is covered (a hat, headphones, an umbrella over it): their
# size can't be measured, so the builder keeps their sheet's number for them.
COVERED = ("newyear.", "work.", "spooky.ghost", "focus.phones", "focus.groove", "focus.notes",
           "rain.", "downpour.", "storm.")


def covered(fid: str) -> bool:
    return any(fid == p or (p.endswith(".") and fid.startswith(p)) for p in COVERED)


# ---------- masks ----------

def _shift_or(m: np.ndarray, r: int) -> np.ndarray:
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dy or dx:
                out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out


def dilate(m: np.ndarray, r: int) -> np.ndarray:
    return _shift_or(m, r) if r else m


def erode(m: np.ndarray, r: int) -> np.ndarray:
    return ~_shift_or(~m, r) if r else m


def components(m: np.ndarray) -> list[tuple[np.ndarray, np.ndarray]]:
    """(ys, xs) of each 4-connected component of m, biggest first.

    Works on each row's runs, not on single pixels: runs that overlap from one row
    to the next are joined (union-find), which is a few thousand steps for a cell
    where a pixel-by-pixel fill is a few hundred thousand."""
    H = m.shape[0]
    d = np.diff(np.pad(m.astype(np.int8), ((0, 0), (1, 1))), axis=1)
    rs, cs = np.nonzero(d == 1)  # each run's row and first column, row by row
    ce = np.nonzero(d == -1)[1]  # and the column after its last
    n = len(rs)
    if n == 0:
        return []
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    first = np.searchsorted(rs, np.arange(H + 1)).tolist()  # each row's first run
    start, end = cs.tolist(), ce.tolist()
    for r in range(1, H):
        i, i_end, j, j_end = first[r - 1], first[r], first[r], first[r + 1]
        while i < i_end and j < j_end:
            if start[i] < end[j] and start[j] < end[i]:
                a, b = find(i), find(j)
                if a != b:
                    parent[b] = a
            if end[i] < end[j]:
                i += 1
            else:
                j += 1
    roots = np.array([find(i) for i in range(n)])
    lens = ce - cs
    total = int(lens.sum())
    ys = np.repeat(rs, lens)
    xs = np.repeat(cs, lens) + (np.arange(total) - np.repeat(np.cumsum(lens) - lens, lens))
    root = np.repeat(roots, lens)
    order = np.argsort(root, kind="stable")
    ys, xs, root = ys[order], xs[order], root[order]
    cuts = np.nonzero(np.diff(root))[0] + 1
    out = list(zip(np.split(ys, cuts), np.split(xs, cuts)))
    out.sort(key=lambda c: -len(c[0]))
    return out


def fill_holes(m: np.ndarray) -> np.ndarray:
    """m with every hole filled: the clear patches that don't reach the edge."""
    H, W = m.shape
    out = m.copy()
    for ys, xs in components(~m):
        if ys.min() > 0 and xs.min() > 0 and ys.max() < H - 1 and xs.max() < W - 1:
            out[ys, xs] = True
    return out


def _mask(comp, shape) -> np.ndarray:
    m = np.zeros(shape, bool)
    m[comp[0], comp[1]] = True
    return m


# ---------- colour ----------

_M = np.array([[0.4124564, 0.3575761, 0.1804375],
               [0.2126729, 0.7151522, 0.0721750],
               [0.0193339, 0.1191920, 0.9503041]])
_WHITE = np.array([0.95047, 1.0, 1.08883])


def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    c = rgb / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    xyz = c @ _M.T / _WHITE
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def lab_to_srgb(lab: np.ndarray) -> np.ndarray:
    fy = (lab[..., 0] + 16) / 116
    f = np.stack([fy + lab[..., 1] / 500, fy, fy - lab[..., 2] / 200], -1)
    xyz = np.where(f ** 3 > 216 / 24389, f ** 3, (116 * f - 16) / (24389 / 27)) * _WHITE
    c = xyz @ np.linalg.inv(_M).T
    c = np.clip(c, 0, 1)
    c = np.where(c > 0.0031308, 1.055 * c ** (1 / 2.4) - 0.055, 12.92 * c)
    return c * 255


def de2000(lab1, lab2) -> float:
    """CIEDE2000 between two Lab colours: about 1 is just visible side by side."""
    L1, a1, b1 = lab1
    L2, a2, b2 = lab2
    Cb = (np.hypot(a1, b1) + np.hypot(a2, b2)) / 2
    G = 0.5 * (1 - np.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p, h2p = np.degrees(np.arctan2(b1, a1p)) % 360, np.degrees(np.arctan2(b2, a2p)) % 360
    dh = 0.0 if C1p * C2p == 0 else (h2p - h1p + 180) % 360 - 180
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dh / 2))
    Lbp, Cbp = (L1 + L2) / 2, (C1p + C2p) / 2
    if C1p * C2p == 0:
        hbp = h1p + h2p
    elif abs(h1p - h2p) <= 180:
        hbp = (h1p + h2p) / 2
    else:
        hbp = (h1p + h2p + 360) / 2 if h1p + h2p < 360 else (h1p + h2p - 360) / 2
    T = (1 - 0.17 * np.cos(np.radians(hbp - 30)) + 0.24 * np.cos(np.radians(2 * hbp))
         + 0.32 * np.cos(np.radians(3 * hbp + 6)) - 0.20 * np.cos(np.radians(4 * hbp - 63)))
    Rc = 2 * np.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
    Rt = -np.sin(np.radians(60 * np.exp(-(((hbp - 275) / 25) ** 2)))) * Rc
    Sl = 1 + 0.015 * (Lbp - 50) ** 2 / np.sqrt(20 + (Lbp - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cbp, 1 + 0.015 * Cbp * T
    dL, dC = (L2 - L1) / Sl, (C2p - C1p) / Sc
    return float(np.sqrt(dL ** 2 + dC ** 2 + (dHp / Sh) ** 2 + Rt * dC * (dHp / Sh)))


def skin_rule(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Warm pixels: R > G > B, with real blue in them (a yellow hat or a gold lantern
    has almost none) and not too saturated."""
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    Y = rgb @ np.array([0.299, 0.587, 0.114])
    C = rgb.max(-1) - rgb.min(-1)
    sat = C / np.maximum(rgb.max(-1), 1)
    return (alpha > 128) & (R > G + 8) & (G > B - 5) & (C > 22) & (Y > 55) & (B > 0.30 * R) & (sat < 0.72)


# ---------- the head ----------

def measure(cell: Image.Image) -> dict:
    """His head in a 2x cell. `ok` is False when no hair or face was found."""
    m = segment(cell)
    m.pop("masks", None)
    return m


def segment(cell: Image.Image) -> dict:
    """measure(), plus `masks`: his face (to the neck) and the skin joined to it."""
    a = np.array(cell.convert("RGBA")).astype(np.float64)
    rgb, al = a[..., :3], a[..., 3]
    Y = rgb @ np.array([0.299, 0.587, 0.114])
    C = rgb.max(-1) - rgb.min(-1)
    fig = al > 128
    rows = np.nonzero(fig.any(1))[0]
    if not len(rows):
        return {"ok": False, "why": "empty"}
    top, bot = rows[0], rows[-1]
    dark = fig & (Y < 70) & (C < 45)
    dark[int(top + 0.65 * (bot - top)):] = False
    # Bridge the 1 px highlights between strands first: fine-textured hair would
    # otherwise break into pieces and read narrow (live's hair width doesn't move).
    dark = erode(dilate(dark, 1), 1) & fig
    opened = dilate(erode(dark, 2), 2) & dark  # no lanyard, watch strap or brows
    comps = components(opened)
    if not comps or len(comps[0][0]) < 400:
        return {"ok": False, "why": "no hair"}
    hair_raw = _mask(comps[0], dark.shape)
    hair = fill_holes(hair_raw)
    hy, hx = np.nonzero(hair)
    y0, x0, x1 = hy.min(), hx.min(), hx.max()
    hw = x1 - x0 + 1
    skin = skin_rule(rgb, al)
    bx0, bx1 = max(0, int(x0 - 0.3 * hw)), min(fig.shape[1], int(x1 + 0.3 * hw) + 1)
    by0, by1 = max(0, y0 - 2), min(fig.shape[0], int(y0 + 1.6 * hw))
    box = np.zeros_like(fig)
    box[by0:by1, bx0:bx1] = True
    head = None
    for comp in components((hair | skin) & box):
        m = _mask(comp, fig.shape)
        if (m & hair_raw).any():
            head = m
            break
    face = head & skin & ~hair
    if face.sum() < 300:
        return {"ok": False, "why": "no face"}
    w = head.sum(1)
    fy = np.nonzero(face.any(1))[0]
    wide = fy[0] + int(np.argmax(w[fy[0]:fy[-1] + 1]))
    neck = next((r for r in range(wide, by1) if w[r] < 0.62 * w[wide]), fy[-1] + 1)
    neck = min(neck, int(y0 + 1.3 * hw))  # a hand or a plate under the chin joins the face
    band = w[int(y0 + 0.3 * hw):int(y0 + 0.9 * hw)]  # at the ears
    head_w = int(band.max()) if len(band) else int(w[wide])
    joined = np.zeros_like(face)  # the face's skin patches, neck included
    for comp in components(skin):
        cm = _mask(comp, skin.shape)
        if (cm & face).any():
            joined |= cm
    face[neck:] = False
    # Skin colour: the whole face down to the chin, without brows, eyes, nostrils
    # (L < 35), teeth and eye whites (pale, grey).
    lab = srgb_to_lab(rgb)
    tone = face & (al > 230)
    tone[int(y0 + 1.05 * hw):] = False
    tone &= (lab[..., 0] > 35) & (lab[..., 0] < 92) & (np.hypot(lab[..., 1], lab[..., 2]) > 12)
    fcx = float(np.median(np.nonzero(face)[1]))
    flags = []
    if head_w > 1.22 * hw:
        flags.append("hands-at-head")
    if abs(fcx - float(np.median(hx))) >= 0.08 * hw:
        flags.append("turned")
    return {
        "ok": True, "flags": flags, "y0": int(y0), "neck": int(neck), "hc": int(np.median(hx)),
        "hair_w": int(hw), "head_w": head_w, "head_h": int(neck - y0),
        "head_area": int(head[:neck].sum()), "hair_area": int((hair & head)[:neck].sum()),
        "lab": np.median(lab[tone], 0) if tone.sum() > 50 else None,
        "masks": {"face": face, "joined": joined, "hair": hair},
    }


def size_against(m: dict, ref: dict) -> float | None:
    """The head's size against the live idle's (1 = the same), or None when it
    can't be told: no head found, the hair hidden or merged with a prop, a hand at
    the head, or the head cut short by something in front of it."""
    if not m.get("ok") or "hands-at-head" in m["flags"]:
        return None
    if not 0.8 * ref["hair_w"] <= m["hair_w"] <= 1.3 * ref["hair_w"] or m["head_h"] < 0.8 * ref["head_h"]:
        return None
    return float(np.sqrt((m["head_w"] / ref["head_w"]) * (m["hair_w"] / ref["hair_w"])))


def skin_lab(m: dict, ref: dict):
    """The face's median Lab, or None when too little of the face shows."""
    if not m.get("ok") or m["lab"] is None or m["head_h"] < 0.8 * ref["head_h"]:
        return None
    return m["lab"]


# ---------- matching the skin ----------

def skin_weights(cell: Image.Image, face_lab, seg: dict | None = None) -> np.ndarray:
    """How much each pixel of a 2x cell is his skin (0..1), with soft edges: the
    skin joined to his face (ears and neck too), and hand-sized patches coloured
    like it. Bread, a kite, an oud, a toy sheep and khaki trousers stay as drawn."""
    a = np.array(cell.convert("RGBA")).astype(np.float64)
    rgb, al = a[..., :3], a[..., 3]
    skin = skin_rule(rgb, al)
    lab = srgb_to_lab(rgb)
    seg = seg if seg is not None else segment(cell)
    ref = np.asarray(face_lab, float)
    rows = np.nonzero((al > 128).any(1))[0]
    if seg.get("ok"):
        keep = seg["masks"]["joined"].copy()
        keep[int(seg["neck"] + 0.6 * seg["hair_w"]):] = False  # face, ears and neck; hands come below
        hand = 0.5 * int(seg["masks"]["face"].sum())
        top_limit = None
    else:  # no face found (a helmet over his hair): his face is the biggest warm patch up top
        keep = np.zeros_like(skin)
        hand = 3000
        top_limit = rows[0] + 0.5 * (rows[-1] - rows[0]) if len(rows) else 0
    reach = rows[0] + 0.70 * (rows[-1] - rows[0]) if len(rows) else 0  # his hands stay above this
    for comp in components(skin & ~keep):
        n = len(comp[0])
        if n < 150 or comp[0].mean() > reach:  # specks, and the khaki of his trousers
            continue
        face_sized = top_limit is not None and comp[0].min() < top_limit and n <= 9000
        if n > hand and not face_sized:
            continue
        med = np.median(lab[comp[0], comp[1]], 0)
        # Close to his face: lighter or darker is shading, but another hue isn't him.
        if abs(med[1] - ref[1]) < 8 and abs(med[2] - ref[2]) < 10 and abs(med[0] - ref[0]) < 22:
            keep[comp[0], comp[1]] = True
    # Pixel by pixel, the hue must be his too: a toy sheep held to his cheek joins
    # his face's patch but is cream, not skin.
    keep &= (np.abs(lab[..., 1] - ref[1]) < 12) & (np.abs(lab[..., 2] - ref[2]) < 14)
    # Soft edges, but only onto warm pixels, so the shirt and the outline stay put.
    w = keep.astype(np.float64)
    for _ in range(2):
        p = np.pad(w, 1, mode="edge")
        w = sum(p[1 + dy:1 + dy + w.shape[0], 1 + dx:1 + dx + w.shape[1]] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9
    loose = (al > 0) & (rgb[..., 0] > rgb[..., 2])
    return np.where(keep, 1.0, w * loose)


def shift_lab(img: Image.Image, weights: np.ndarray, delta) -> Image.Image:
    """img with its colour moved by `delta` (in Lab), each pixel by its weight: his
    skin, his hair or a garment, whichever the weights pick out."""
    a = np.array(img.convert("RGBA")).astype(np.float64)
    if weights.shape != a.shape[:2]:  # a 1x image takes the 2x weights, averaged
        h, w = a.shape[:2]
        weights = weights[:h * 2, :w * 2].reshape(h, 2, w, 2).mean((1, 3))
    lab = srgb_to_lab(a[..., :3])
    lab += weights[..., None] * np.asarray(delta, float)
    a[..., :3] = np.where(weights[..., None] > 0, lab_to_srgb(lab), a[..., :3])
    return Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8), "RGBA")


# ---------- his clothes ----------
# The generated sheets grade his clothes as they graded his skin: next to the live
# sprite his shirt is about 13 points darker and yellower, his trousers 8 darker
# and pinker, his shoes grey rather than near-black. Each is found by its colour
# and by where it sits on him, so the plant he holds and the box at his feet stay
# as drawn.

GARMENTS = ("shirt", "trousers", "shoes")
# The fewest pixels (at 2x) that count as the garment showing.
GARMENT_MIN = {"shirt": 1500, "trousers": 1500, "shoes": 250}


def _similar(lab: np.ndarray, comps, first: int, least: int, da: float, db: float) -> np.ndarray:
    """The biggest component (`comps[first]`) and every other one coloured like it:
    a sleeve cut off by a prop, the second leg."""
    out = np.zeros(lab.shape[:2], bool)
    if len(comps) <= first:
        return out
    ys, xs = comps[first]
    med = np.median(lab[ys, xs], 0)
    out[ys, xs] = True
    for ys, xs in comps[first + 1:]:
        if len(ys) < least:
            break  # biggest first: the rest are smaller still
        m = np.median(lab[ys, xs], 0)
        if abs(m[1] - med[1]) < da and abs(m[2] - med[2]) < db:
            out[ys, xs] = True
    return out


# His skin's a and b once the builder has matched it to the live sprite: what the
# khaki of his trousers is told apart from.
SKIN_AB = (21.0, 35.6)


def garments(cell: Image.Image, skin: np.ndarray | None = None) -> dict:
    """His shirt, trousers and shoes in a 2x cell: {name: mask}, each left out when
    it doesn't show (too few pixels). `skin` is a mask of what is known to be his
    skin (the builder's skin weights): it is never taken for his trousers."""
    a = np.array(cell.convert("RGBA")).astype(np.float64)
    rgb, al = a[..., :3], a[..., 3]
    fig = al > 128
    if not fig.any():
        return {}
    if skin is not None:
        fig = fig & ~skin
    lab = srgb_to_lab(rgb)
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    out = {}

    # Shirt: yellow-green, lit or in a fold. A bush, a watering can or a leaf held
    # against it is a bluer green (a under -25 where the shirt's is about -14): left
    # in, a bush bigger than the shirt showing round it was taken for the shirt.
    # What's left of a prop joins the shirt's patch as specks, so each pixel must
    # be near the shirt's own colour too.
    green = fig & (A < -5) & (A > -25) & (B > 20) & (L > 25)
    comps = components(erode(green, 1))
    shirt = dilate(_similar(lab, comps, 0, 300, 8, 12), 1) & green
    if shirt.any():
        med = np.median(lab[shirt], 0)
        shirt &= (np.abs(A - med[1]) < 13) & (np.abs(B - med[2]) < 20)
    if shirt.sum() >= GARMENT_MIN["shirt"]:
        out["shirt"] = shirt
    shirt_row = float(np.nonzero(shirt)[0].mean()) if shirt.any() else None

    # Trousers: khaki, below his chest (a loaf or a box held up there is the same
    # colour). Some sheets draw them nearly as pink as his skin, and his hands rest
    # in his pockets, so the khaki is read off his shins first, where no skin
    # shows, and a pixel is trousers when it is nearer that than his skin.
    rows = np.nonzero(fig.any(1))[0]
    top, bot = int(rows[0]), int(rows[-1])
    dark = _dark(a)
    warm = fig & ~dark & (L > 45) & (A > -4) & (A < 24) & (B > 6) & (B < 46)
    shins = warm.copy()
    shins[:int(top + 0.72 * (bot - top))] = False
    centre = np.median(lab[shins], 0) if shins.sum() >= 400 else None
    if centre is None or not (55 < centre[0] < 92 and -2 < centre[1] < 19 and 12 < centre[2] < 42):
        centre = np.array([79.0, 9.0, 28.0])  # the sheets' usual khaki
    to_khaki = np.hypot(A - centre[1], B - centre[2])
    to_skin = np.hypot(A - SKIN_AB[0], B - SKIN_AB[1])
    khaki = warm & (L > 50) & (to_khaki < to_skin) & (to_khaki < 11)
    comps = [c for c in components(erode(khaki, 1))
             if len(c[0]) >= 300 and (shirt_row is None or c[0].mean() > shirt_row)]
    trousers = dilate(_similar(lab, comps, 0, 300, 5, 8), 1) & khaki
    if trousers.any():
        # Its folds are darker and redder than the rule allows and would be left
        # behind as specks: take in what lies in or right beside the patch and is
        # nearer the khaki than his skin.
        med = np.median(lab[trousers], 0)
        to_khaki = np.hypot(A - med[1], B - med[2])
        to_skin = np.hypot(A - SKIN_AB[0], B - SKIN_AB[1])
        fold = fig & (L > 36) & (A > -4) & (A < 20) & (B > 6) & (B < 46) & (to_khaki < to_skin)
        trousers |= fold & (dilate(trousers, 3) | fill_holes(trousers))
    if trousers.sum() >= GARMENT_MIN["trousers"]:
        out["trousers"] = trousers
        # Shoes: the near-black at the end of each leg. His belt touches his
        # trousers too, but from above.
        t_rows = np.nonzero(trousers)[0]
        low = float(np.percentile(t_rows, 70))
        near = dilate(trousers, 4)
        shoes = np.zeros_like(fig)
        for ys, xs in components(dilate(erode(dark, 1), 1) & dark):
            n = len(ys)
            if n < 120:
                break
            if n <= 6000 and ys.mean() > low and near[ys, xs].any():
                shoes[ys, xs] = True
        if shoes.sum() >= GARMENT_MIN["shoes"]:
            out["shoes"] = shoes
    return out


def garment_lab(cell: Image.Image, mask: np.ndarray):
    """A garment's median Lab, away from its outline."""
    lab = srgb_to_lab(np.array(cell.convert("RGBA")).astype(np.float64)[..., :3])
    inner = erode(mask, 1)
    m = inner if inner.sum() >= 150 else mask
    return np.median(lab[m], 0)


def garment_weights(cell: Image.Image, mask: np.ndarray, name: str) -> np.ndarray:
    """How much each pixel of a 2x cell is that garment (0..1): the mask, with a soft
    edge that only reaches pixels of the garment's own colour family, so his hands,
    his lanyard and the outline between them stay put."""
    a = np.array(cell.convert("RGBA")).astype(np.float64)
    rgb, al = a[..., :3], a[..., 3]
    lab = srgb_to_lab(rgb)
    if name == "shirt":
        loose = (lab[..., 1] < 0) & (lab[..., 2] > 12)
    elif name == "trousers":
        loose = (lab[..., 0] > 40) & (lab[..., 1] > -4) & (lab[..., 1] < 17) & (lab[..., 2] > 8)
    else:
        loose = _dark(a) | ((rgb.max(-1) < 110) & (rgb.max(-1) - rgb.min(-1) < 50))
    w = mask.astype(np.float64)
    for _ in range(2):
        p = np.pad(w, 1, mode="edge")
        w = sum(p[1 + dy:1 + dy + w.shape[0], 1 + dx:1 + dx + w.shape[1]] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9
    return np.where(mask, 1.0, w * (loose & (al > 0)))


# ---------- how sharp he is ----------

def detail(cell: Image.Image) -> float | None:
    """How much fine detail a cell carries: the mean |Laplacian| of its lightness,
    well inside the figure (the outline against the page isn't detail). Compare two
    cells drawn at the same size only."""
    a = np.array(cell.convert("RGBA")).astype(np.float64)
    L = srgb_to_lab(a[..., :3])[..., 0]
    inner = erode(a[..., 3] > 200, 3)
    if inner.sum() < 400:
        return None
    lap = np.abs(4 * L[1:-1, 1:-1] - L[:-2, 1:-1] - L[2:, 1:-1] - L[1:-1, :-2] - L[1:-1, 2:])
    return float(lap[inner[1:-1, 1:-1]].mean())


def sharpen(cell: Image.Image, amount: float, radius: float = 1.0) -> Image.Image:
    """cell with an unsharp mask of `amount` on its colour. The figure's colour is
    first carried a few pixels out past its outline, so the blur never mixes in the
    black under the transparent pixels and no halo grows at his edge; alpha is kept."""
    if amount <= 0:
        return cell
    from PIL import ImageFilter

    a = np.array(cell.convert("RGBA")).astype(np.float64)
    rgb, al = a[..., :3].copy(), a[..., 3]
    known = al > 0
    for _ in range(int(np.ceil(radius * 3)) + 1):  # bleed the edge colours outward
        p = np.pad(rgb * known[..., None], ((1, 1), (1, 1), (0, 0)))
        k = np.pad(known.astype(np.float64), 1)
        H, W = known.shape
        s = sum(p[1 + dy:1 + dy + H, 1 + dx:1 + dx + W] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
        n = sum(k[1 + dy:1 + dy + H, 1 + dx:1 + dx + W] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
        grow = ~known & (n > 0)
        rgb[grow] = s[grow] / n[grow][:, None]
        known = known | grow
    flat = Image.fromarray(np.clip(rgb + 0.5, 0, 255).astype(np.uint8), "RGB")
    blur = np.array(flat.filter(ImageFilter.GaussianBlur(radius))).astype(np.float64)
    out = a.copy()
    out[..., :3] = np.clip(rgb + amount * (rgb - blur), 0, 255)
    out[al == 0] = 0
    return Image.fromarray(np.clip(out + 0.5, 0, 255).astype(np.uint8), "RGBA")


# ---------- shaping the hair ----------
# The hair down the sides of the talking head is thinner than the live idle's, and
# the builder thickens it: pixels already there move, row by row, so the soft edge
# travels with the hair and nothing new is painted.

FRINGE = 3  # px at 2x: the soft edge between his hair and whatever is next to it


def _dark(a: np.ndarray) -> np.ndarray:
    """Hair-dark pixels of an RGBA array (a looser test than segment's)."""
    Y = a[..., :3] @ np.array([0.299, 0.587, 0.114])
    C = a[..., :3].max(-1) - a[..., :3].min(-1)
    return (a[..., 3] > 128) & (Y < 85) & (C < 50)


def roughness(hair: np.ndarray) -> float:
    """How bumpy the top of the hair is: the mean |second difference| of its top
    edge across the middle two thirds of its width. Curls make it high."""
    xs = np.nonzero(hair.any(0))[0]
    if not len(xs):
        return float("nan")
    x0, x1 = int(xs[0]), int(xs[-1])
    tops = [int(np.argmax(hair[:, c])) for c in range(x0 + (x1 - x0) // 6, x1 - (x1 - x0) // 6) if hair[:, c].any()]
    if len(tops) < 10:
        return float("nan")
    return float(np.abs(np.diff(np.array(tops, float), 2)).mean())


def side_strips(cell: Image.Image, seg: dict | None = None) -> dict:
    """The hair down each side of his head, from where the top of his hair ends to
    his ears. Per side ("l", "r"): its rows, the head's outline column in each, how
    far in from the outline the hair reaches, and the head's width there."""
    seg = seg if seg is not None else segment(cell)
    if not seg.get("ok"):
        return {}
    a = np.array(cell.convert("RGBA")).astype(np.float64)
    fig, dark = a[..., 3] > 128, _dark(a)
    hc, y0, hw = seg["hc"], seg["y0"], seg["hair_w"]
    lo, hi = max(hc - int(0.9 * hw), 0), min(hc + int(0.9 * hw), a.shape[1] - 1)
    out = {}
    for side, step in (("l", 1), ("r", -1)):
        rows, edge, depth, width = [], [], [], []
        in_top, last = True, None
        for y in range(y0, min(y0 + int(1.1 * hw), a.shape[0])):
            xs = np.nonzero(fig[y, lo:hi + 1])[0]
            if not len(xs):
                break
            o = lo + int(xs[0] if step == 1 else xs[-1])
            sw = int(xs[-1] - xs[0] + 1)
            x = o
            while abs(x - o) < FRINGE and not dark[y, x]:
                x += step
            n = 0
            if dark[y, x]:  # the dark run, across highlights up to 2 px wide
                end, gap = x, 0
                while lo <= x <= hi and gap <= 2:
                    end, gap = (x, 0) if dark[y, x] else (end, gap + 1)
                    x += step
                n = abs(end - o) + 1
            if in_top:
                # The top of his hair has ended, once his head is nearly full width:
                # a strip down the side.
                if sw >= 0.7 * hw and 0 < n < 0.25 * sw:
                    in_top = False
                else:
                    continue
            if n == 0 or (last is not None and (last - o) * step >= 3):  # his ear
                break
            rows.append(y), edge.append(o), depth.append(n), width.append(sw)
            last = o
        if len(rows) >= 6:
            out[side] = {"rows": rows, "edge": edge, "depth": depth, "width": width}
    return out


def _resample(line: np.ndarray, at: np.ndarray) -> np.ndarray:
    """line (n x 4) sampled at fractional positions, linearly."""
    idx = np.arange(line.shape[0])
    return np.stack([np.interp(at, idx, line[:, c]) for c in range(line.shape[1])], -1)


def _to_image(a: np.ndarray) -> Image.Image:
    a = np.ascontiguousarray(np.clip(a + 0.5, 0, 255).astype(np.uint8))
    return Image.frombytes("RGBa", (a.shape[1], a.shape[0]), a.tobytes()).convert("RGBA")


def thicken_sides(cell: Image.Image, ref: dict) -> tuple[Image.Image, float]:
    """cell with the hair down each side of his head at least as thick as in
    `ref` (side_strips of the live idle), scaled to this head. Each row's strip is
    stretched inward from the outline, its soft edge moving with it. A side whose
    strip is about as thick as ref's already (95% of it, for the head's width)
    stays as drawn. Returns the image and the most any edge moved, in px at 2x."""
    mine = side_strips(cell)
    a = np.array(cell.convert("RGBa")).astype(np.float64)
    touched = np.zeros(a.shape[:2], bool)
    most = 0.0
    for side, s in mine.items():
        r = ref.get(side)
        if r is None:
            continue
        if np.median(s["depth"]) / np.median(s["width"]) >= 0.95 * np.median(r["depth"]) / np.median(r["width"]):
            continue
        scale = float(np.median(s["width"]) / np.median(r["width"]))
        want = scale * np.interp(np.linspace(0, 1, len(s["rows"])), np.linspace(0, 1, len(r["rows"])), r["depth"])
        depth = np.array(s["depth"], float)
        steady = np.array([np.median(depth[max(k - 2, 0):k + 3]) for k in range(len(depth))])  # one odd row isn't the strip
        d = np.maximum(want - steady, 0)
        d = np.convolve(np.pad(d, 2, mode="edge"), np.ones(5) / 5, mode="valid")
        i = np.arange(len(d))
        d *= np.minimum(1, np.minimum(i + 1, len(d) - i) / 6)  # no step where the strip starts or ends
        step = 1 if side == "l" else -1
        # The blend from hair to skin is wide (about a tenth of his head). The hair
        # is stretched by the whole amount and the blend moves with it, a little
        # narrower; past the blend nothing moves, so his brows and eyes stay put.
        pad = max(FRINGE + 1, int(round(0.15 * np.median(s["width"]))))
        d = np.minimum(d, 0.5 * pad)
        for y, o, n, dy in zip(s["rows"], s["edge"], s["depth"], d):
            if dy < 0.25:
                continue
            most = max(most, float(dy))
            t = np.arange(n + pad + 1, dtype=float)
            src = np.interp(t, [0, n + dy, n + pad], [0, n, n + pad])
            xs = (o + step * t).astype(int)
            a[y, xs] = _resample(a[y], o + step * src)
            touched[y, xs] = True
    if not touched.any():
        return cell, 0.0
    # Rows were stretched one by one: blend the moved pixels with the rows above and
    # below (1-4-6-4-1), so the new inner edge doesn't step from row to row.
    for _ in range(2):
        p = np.pad(a, ((1, 1), (0, 0), (0, 0)), mode="edge")
        a = np.where(touched[..., None], (p[:-2] + 2 * p[1:-1] + p[2:]) / 4, a)
    out = np.array(cell.convert("RGBA"))
    out[touched] = np.array(_to_image(a))[touched]  # every other pixel exactly as it was
    return Image.fromarray(out, "RGBA"), most

