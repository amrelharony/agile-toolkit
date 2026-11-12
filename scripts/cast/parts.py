"""Slicing a cut sheet into its drawings, sorting loose returns, naming the pieces.

    islands(rgba)                 the drawings after a `close_px` closing, specks apart
    sort_image(c, rgba)           which image a loose PNG is, from what it holds
    assign(pieces, ids, ...)      Hungarian matching of pieces to part ids, then
                                  each pair drawn alike and its right piece on your left
    LAYOUT, SIDES, ANYWHERE       where the parts brief lays each piece out
    SHAPES                        what any puppet's pieces can look like

The layout prior follows scripts/cast/brief-blocks.mjs imageParts word for word
(test_cast_spec.py reads the brief to hold the two together): "the head at the
top in the middle, with any ears beside it and the pupils just below it; the body
in the middle, with the tie and the lanyard just to your right of it; the
character's right arm on your left of the body and its left arm on your right;
the legs below the body, the right leg on your left; a tail and anything else at
the sides wherever there is room." parts2 is "in tidy rows from left to right in
the order of the list".

Every id a parts sheet holds has its place there: a point (LAYOUT), "at the
sides" (SIDES), which costs a piece only as far as it sits in the middle column,
or none, for a piece the brief lets lie at the sides or by its own place. Every
id has a generic shape: bands of area against the biggest piece and of long side
over short side, free inside, so a long ear and a round one, or a thin tail and a
ball of one, are all named by where they lie; an arm, a leg and a tie hang
straight down, so they stand taller than wide, and a collar is a band, wider than
tall. The two pieces of a pair (ears, pupils, arms, legs) are one piece drawn for
each side, so they are alike, and the right one is on your left whatever the
sheet's box does to the points.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import imaging as im
from . import key
from .spec import ARM_CELLS, SOLID_ALPHA, TOL, cell_count

# Where imageParts lays each piece out, in the box around all the pieces (x, y in
# 0..1, x from the viewer's left). A pair of middle legs (limb-mid) are legs too
# ("the legs below the body, the right leg on your left"); that they lie outside
# the hind pair is this builder's guess, as imageParts doesn't say. Either way each
# leg keeps its side, and a side's two legs register in that side's window.
LAYOUT = {
    "head": (0.5, 0.1),
    "ear-r": (0.3, 0.08),
    "ear-l": (0.7, 0.08),
    "pupil-r": (0.45, 0.3),
    "pupil-l": (0.55, 0.3),
    "torso": (0.5, 0.5),
    "tie": (0.68, 0.42),
    "cord": (0.68, 0.58),
    "arm-r": (0.18, 0.5),
    "arm-l": (0.86, 0.5),
    "limb-mid-r": (0.2, 0.88),
    "leg-r": (0.4, 0.88),
    "leg-l": (0.6, 0.88),
    "limb-mid-l": (0.8, 0.88),
}
# "A tail and anything else at the sides wherever there is room": a tail lies
# anywhere from top to bottom outside the middle column, and so does a coat behind
# the whole figure, which has no room where it belongs; a piece nearer the middle
# than SIDE pays for how far in it is. Anything else may lie at the sides or by its
# own place, so the brief fixes it no place (ANYWHERE: no place cost).
SIDES = ("tail", "quills")
SIDE = 0.3
ANYWHERE = ("neck", "load", "abdomen", "flap", "collar")
# Generic piece shapes, matched on the start of the id (no canon: what any cut-out
# puppet's pieces can look like): (typical area against a torso's, (fewest, most)
# area against the biggest piece, (fewest, most) long side over short side, and
# "tall" or "wide" for a piece that stands one way). The typical areas weigh a
# piece's expected share of its sheet (fused); naming costs nothing inside the
# bands. Most bands sit close round the typical piece, as a piece with no place of
# its own has only its shape to be told by. The wide ones vary in any puppet: a
# torso smaller than a big head or a coat, ears small and round to long, a tail
# from a small ball to a bushy plume in any curve, thin tube limbs to full sleeves,
# a coat of quills behind the whole figure outsizing the body. Arms, legs and a tie
# hang straight down, so they stand tall; a collar is a band, wide.
SHAPES = {
    "torso": (1.0, (0.2, 1.0), (1.0, 2.0), None),
    "head": (0.6, (0.2, 1.0), (1.0, 1.8), None),
    "neck": (0.15, (0.1, 0.25), (1.8, 3.5), None),
    "abdomen": (0.6, (0.4, 1.0), (1.0, 1.5), None),
    "arm": (0.22, (0.03, 0.4), (1.4, 8.0), "tall"),
    "leg": (0.25, (0.03, 0.4), (1.4, 8.0), "tall"),
    "pupil": (0.004, (0.0005, 0.03), (1.0, 1.4), None),
    "tie": (0.05, (0.02, 0.08), (2.0, 5.0), "tall"),
    "cord": (0.04, (0.015, 0.1), (1.5, 5.0), None),
    "tail": (0.2, (0.005, 0.7), (1.0, 6.0), None),
    "ear": (0.04, (0.005, 0.35), (1.0, 4.0), None),
    "quills": (2.0, (0.5, 1.0), (1.0, 3.0), None),
    "flap": (0.1, (0.03, 0.2), (1.0, 2.5), None),
    "load": (0.3, (0.2, 0.5), (1.2, 2.0), None),
    "collar": (0.1, (0.05, 0.2), (2.0, 5.0), "wide"),
    "tentacle": (0.15, (0.1, 0.25), (2.5, 6.0), None),
    "limb-mid": (0.25, (0.03, 0.4), (1.4, 8.0), "tall"),
    "limb": (0.12, (0.07, 0.2), (2.5, 6.0), None),
    "fan": (1.2, (0.1, 1.0), (1.0, 6.0), None),
}
# cost = 3·place + area + 0.5·(long over short, and how far it stands the wrong
# way) + 2·(1 − NCC), and 1·how unlike the two pieces named as a pair are.
W_POS, W_AREA, W_ASPECT, W_NCC, W_PAIR = 3.0, 1.0, 0.5, 2.0, 1.0


@dataclass(eq=False)
class Island:
    ys: np.ndarray
    xs: np.ndarray
    box: tuple = field(init=False)
    area: int = field(init=False)
    centroid: tuple = field(init=False)

    def __post_init__(self):
        self.box = im.bbox(self.ys, self.xs)
        self.area = int(len(self.ys))
        self.centroid = (float(self.xs.mean()), float(self.ys.mean()))

    @property
    def size(self) -> tuple[int, int]:
        x0, y0, x1, y1 = self.box
        return x1 - x0, y1 - y0

    @property
    def long_side(self) -> int:
        return max(self.size)

    @property
    def aspect(self) -> float:
        w, h = self.size
        return max(w, h) / max(min(w, h), 1)

    def mask(self, shape) -> np.ndarray:
        m = np.zeros(shape[:2], bool)
        m[self.ys, self.xs] = True
        return m

    def crop(self, rgba: np.ndarray, pad: int = 0) -> tuple[np.ndarray, tuple[int, int]]:
        """This island alone (other drawings cleared), cut to its box plus `pad`;
        and the crop's top-left in the sheet."""
        x0, y0, x1, y1 = self.box
        out = np.zeros((y1 - y0 + 2 * pad, x1 - x0 + 2 * pad, 4), np.uint8)
        out[self.ys - y0 + pad, self.xs - x0 + pad] = rgba[self.ys, self.xs]
        return out, (x0 - pad, y0 - pad)

    def json(self) -> dict:
        return {"box": list(self.box), "area": self.area, "centroid": [round(v, 1) for v in self.centroid]}


def islands(rgba: np.ndarray) -> tuple[list[Island], list[Island]]:
    """(pieces biggest first, specks): the drawings of a cut sheet after a
    `close_px` closing, a speck being one whose long side is under `speck_px`.
    Each island keeps only its own drawn pixels (the closing only joins them)."""
    drawn = rgba[..., 3] > 0
    closed = im.closing(drawn, TOL["close_px"])
    pieces, specks = [], []
    for ys, xs in im.components(closed):
        keep = drawn[ys, xs]
        if not keep.any():
            continue
        isl = Island(ys[keep], xs[keep])
        (specks if isl.long_side < TOL["speck_px"] else pieces).append(isl)
    return pieces, specks


def drop(rgba: np.ndarray, gone: list[Island]) -> np.ndarray:
    out = rgba.copy()
    for s in gone:
        out[s.ys, s.xs] = 0
    return out


def min_gap(pieces: list[Island], shape) -> tuple[int, list[tuple[int, int]]]:
    """(gap_fail_px, the pairs of piece indices with fewer than that many clear
    pixels between them), measured as chessboard distance."""
    r = TOL["gap_fail_px"]
    label = np.full(shape[:2], -1, np.int32)
    for i, p in enumerate(pieces):
        label[p.ys, p.xs] = i
    close = []
    H, W = shape[:2]
    for i, p in enumerate(pieces):
        x0, y0, x1, y1 = p.box
        X0, Y0, X1, Y1 = max(0, x0 - r), max(0, y0 - r), min(W, x1 + r), min(H, y1 + r)
        sub = label[Y0:Y1, X0:X1]
        grown = im.dilate(sub == i, r)
        for j in np.unique(sub[grown & (sub >= 0) & (sub != i)]):
            if (int(j), i) not in close:
                close.append((i, int(j)))
    return r, close


# ---------- sorting loose PNGs by content ----------


def _norm_mask(rgba: np.ndarray, isl: Island, n: int = 64) -> np.ndarray:
    from PIL import Image

    crop, _ = isl.crop(rgba)
    m = Image.fromarray((crop[..., 3] > 0).astype(np.uint8) * 255).resize((n, n), Image.BILINEAR)
    return np.array(m) >= SOLID_ALPHA


def similar_silhouettes(rgba: np.ndarray, pieces: list[Island]) -> float:
    """Mean pairwise IoU of the pieces' silhouettes, each scaled to one box: near 1
    for the same head drawn again, low for arms in different poses."""
    ms = [_norm_mask(rgba, p) for p in pieces]
    ious = []
    for i in range(len(ms)):
        for j in range(i + 1, len(ms)):
            u = (ms[i] | ms[j]).sum()
            ious.append((ms[i] & ms[j]).sum() / u if u else 0.0)
    return float(np.mean(ious)) if ious else 1.0


def on_grid(pieces: list[Island], shape, rows: int, cols: int) -> bool:
    """One piece in each cell of a rows x cols grid over the canvas."""
    H, W = shape[:2]
    cells = {(int(p.centroid[1] * rows // H), int(p.centroid[0] * cols // W)) for p in pieces}
    return len(pieces) == rows * cols and len(cells) == rows * cols


def sort_image(c: dict, rgba: np.ndarray, key_rgb) -> tuple[str | None, str, int]:
    """(image, reason, drawings) for a loose PNG of character c: one figure is the
    master, the face sheet's heads are one silhouette repeated, the arms one per
    cell of their grid, and anything else the parts (or parts2) by count."""
    cutout, _ = key.cut(rgba, key_rgb)
    pieces, _ = islands(cutout)
    n = len(pieces)
    images = c["images"]
    if n == 1:
        return "master", "1 figure", n
    same = similar_silhouettes(cutout, pieces) >= TOL["sort_head_iou"] if n > 1 else False
    if "face" in images and n == cell_count(c, "face") and same:
        return "face", f"{n} heads", n
    if "face2" in images and n == cell_count(c, "face2") and same:
        return "face2", f"{n} heads", n
    if "arms" in images:
        k = cell_count(c, "arms")
        rows = 2 if k == ARM_CELLS else 1
        if n == k and not same and on_grid(pieces, rgba.shape, rows, k // rows):
            return "arms", f"{n} arms", n
    counts = [(img, cell_count(c, img)) for img in ("parts", "parts2") if img in images]
    exact = [img for img, k in counts if k == n]
    if exact:
        return exact[0], f"{n} pieces", n
    if counts and n > 1:
        img = min(counts, key=lambda t: abs(t[1] - n))[0]
        return img, f"{n} pieces (expected {cell_count(c, img)})", n
    return None, f"{n} drawings: no image of {c['id']} holds that many", n


# ---------- naming the pieces ----------


def shape_of(part_id: str) -> tuple | None:
    """(typical area, area band, long-over-short band, "tall" / "wide" / None)
    for the id, or None."""
    for k, v in SHAPES.items():
        if part_id.startswith(k):
            return v
    return None


def fused(pieces: list[Island], named: dict, ids: list[str], short: int = 1) -> list[tuple[str, float]]:
    """For a sheet `short` drawings short of its pieces: the named pieces ({part
    id: piece index}) most likely to be two drawn as one, as (id, times its
    expected area). A piece's expected area is its share of all the sheet's
    drawing by the typical areas (SHAPES) of every id the sheet should hold, so a fusion
    with the biggest piece (a torso with an arm) shows too. Every piece over
    fused_area_max times is named, and at least the `short` biggest by that ratio.
    The pupils are left out: their size follows the eyes, not the body, so their
    share says nothing (the synthetic ones read 2.4x)."""
    total = sum(p.area for p in pieces)
    weight = sum(shape_of(i)[0] for i in ids if shape_of(i))
    if not total or not weight:
        return []
    ratios = []
    for pid, i in named.items():
        shp = shape_of(pid)
        if shp and not pid.startswith("pupil-"):
            ratios.append((pid, pieces[i].area / (total * shp[0] / weight)))
    ratios.sort(key=lambda t: -t[1])
    return [t for n, t in enumerate(ratios) if t[1] > TOL["fused_area_max"] or n < short]


def reading_order(pieces: list[Island]) -> list[int]:
    """Each piece's rank in reading order: rows by centre height (a new row when a
    piece's centre is below the current row's lowest top), then left to right."""
    order = sorted(range(len(pieces)), key=lambda i: pieces[i].centroid[1])
    rows: list[list[int]] = []
    bottom = -1.0
    for i in order:
        if rows and pieces[i].box[1] < bottom:
            rows[-1].append(i)
            bottom = max(bottom, pieces[i].box[3])
        else:
            rows.append([i])
            bottom = pieces[i].box[3]
    rank = [0] * len(pieces)
    k = 0
    for row in rows:
        for i in sorted(row, key=lambda j: pieces[j].centroid[0]):
            rank[i] = k
            k += 1
    return rank


def _outside(v: float, band: tuple[float, float]) -> float:
    """How far v lies outside the band, in log units (0 inside it)."""
    lo, hi = band
    return max(0.0, float(np.log(lo / v)), float(np.log(v / hi)))


def _tall(p: Island) -> float:
    w, h = p.size
    return max(h, 1) / max(w, 1)


def unlike(a: Island, b: Island) -> float:
    """How differently two pieces are drawn, by area and height over width (a
    mirror image is drawn the same)."""
    return abs(float(np.log(a.area / b.area))) + W_ASPECT * abs(float(np.log(_tall(a) / _tall(b))))


def cost_matrix(
    pieces: list[Island], ids: list[str], image: str = "parts", ncc: np.ndarray | None = None
) -> np.ndarray:
    """Rows are pieces, columns part ids."""
    xs0 = min(p.box[0] for p in pieces)
    ys0 = min(p.box[1] for p in pieces)
    xs1 = max(p.box[2] for p in pieces)
    ys1 = max(p.box[3] for p in pieces)
    w, h = max(xs1 - xs0, 1), max(ys1 - ys0, 1)
    biggest = max(p.area for p in pieces)
    rank = reading_order(pieces)
    n = len(pieces)
    C = np.zeros((n, len(ids)))
    for i, p in enumerate(pieces):
        cx, cy = (p.centroid[0] - xs0) / w, (p.centroid[1] - ys0) / h
        for j, pid in enumerate(ids):
            cost = 0.0
            if image == "parts2":
                cost += W_POS * abs(rank[i] - j) / max(len(ids) - 1, 1)
            elif pid in LAYOUT:
                px, py = LAYOUT[pid]
                cost += W_POS * float(np.hypot(cx - px, cy - py))
            elif pid in SIDES:
                cost += W_POS * max(0.0, SIDE - abs(cx - 0.5))
            shp = shape_of(pid)
            if shp:
                _, areas, aspects, stands = shp
                cost += W_AREA * _outside(p.area / biggest, areas)
                cost += W_ASPECT * _outside(p.aspect, aspects)
                pw, ph = p.size
                if (stands == "tall" and pw > ph) or (stands == "wide" and ph > pw):
                    cost += W_ASPECT * float(np.log(p.aspect))  # standing the other way
            if ncc is not None:
                cost += W_NCC * (1 - float(ncc[i, j]))
            C[i, j] = cost
    return C


def hungarian(C: np.ndarray) -> list[tuple[int, int]]:
    """Kuhn–Munkres: the (row, column) pairs of least total cost. A rectangular
    matrix is padded, so the spare rows or columns stay unmatched."""
    n0, m0 = C.shape
    n = max(n0, m0)
    big = (np.abs(C).max() if C.size else 0) + 1
    A = np.full((n, n), big, float)
    A[:n0, :m0] = C
    u, v = np.zeros(n + 1), np.zeros(n + 1)
    p, way = np.zeros(n + 1, int), np.zeros(n + 1, int)
    for i in range(1, n + 1):
        p[0] = i
        j0 = 0
        minv = np.full(n + 1, np.inf)
        used = np.zeros(n + 1, bool)
        while True:
            used[j0] = True
            i0 = p[j0]
            cur = A[i0 - 1, :] - u[i0] - v[1:]
            free = ~used[1:]
            better = free & (cur < minv[1:])
            minv[1:][better] = cur[better]
            way[1:][better] = j0
            cand = np.where(free, minv[1:], np.inf)
            j1 = int(np.argmin(cand)) + 1
            delta = cand[j1 - 1]
            u[p[used]] += delta
            v[used] -= delta
            minv[1:][free] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while True:
            j1 = way[j0]
            p[j0] = p[j1]
            j0 = j1
            if j0 == 0:
                break
    pairs = [(int(p[j]) - 1, j - 1) for j in range(1, n + 1) if p[j]]
    return sorted((r, c) for r, c in pairs if r < n0 and c < m0)


def assign(pieces, ids, image="parts", ncc=None) -> tuple[dict, list[int], float]:
    """({part id: piece index}, spare piece indices, total cost). An empty sheet
    names nothing.

    The Hungarian match of the cost matrix; then, on a parts sheet, each pair's
    two pieces are kept alike: a piece of a pair trades names with any other piece
    (or a spare) while that lowers the cost plus W_PAIR times how unlike each
    pair's pieces are, so a ball of a tail laid where an ear or an arm would go
    doesn't take its name. Last, each pair's right piece is the one on your left.
    parts2, in the order of its list, has no pairs to keep."""
    if not pieces or not ids:
        return {}, list(range(len(pieces))), 0.0
    C = cost_matrix(pieces, ids, image, ncc)
    n, m = C.shape
    at: list = [None] * m  # the piece each id column holds
    for r, c in hungarian(C):
        at[c] = r
    col = {pid: j for j, pid in enumerate(ids)}
    pairs = [] if image == "parts2" else [(col[p], col[p[:-2] + "-l"]) for p in ids if p.endswith("-r") and p[:-2] + "-l" in col]

    def total(at):
        s = sum(C[r, c] for c, r in enumerate(at) if r is not None)
        for a, b in pairs:
            if at[a] is not None and at[b] is not None:
                s += W_PAIR * unlike(pieces[at[a]], pieces[at[b]])
        return float(s)

    def moves(at, a):
        """Column a's piece traded with another column's, or for a spare."""
        for b in range(m):
            if b != a:
                trial = list(at)
                trial[a], trial[b] = at[b], at[a]
                yield trial
        for i in range(n):
            if i not in at:
                trial = list(at)
                trial[a] = i
                yield trial

    best = total(at)
    moved = bool(pairs)
    while moved:  # every move lowers the total, so this ends
        moved = False
        for a in [c for ab in pairs for c in ab]:
            for trial in moves(at, a):
                v = total(trial)
                if v < best - 1e-9:
                    at, best, moved = trial, v, True
                    break
    for a, b in pairs:
        if at[a] is not None and at[b] is not None and pieces[at[a]].centroid[0] > pieces[at[b]].centroid[0]:
            at[a], at[b] = at[b], at[a]
    got = {ids[c]: r for c, r in enumerate(at) if r is not None}
    return got, [i for i in range(n) if i not in at], total(at)
