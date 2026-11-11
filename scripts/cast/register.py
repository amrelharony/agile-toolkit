"""Placing a drawn piece onto the approved master, and finding its joint.

    warp(rgba, m, theta, size, centre)   the piece scaled by m, turned by theta,
                                         its centre at `centre` on a `size` canvas
    masked_ncc(target, tmpl, mask)       Padfield's masked NCC (2012) by FFT
    register(piece, master, ...)         the pose that lays the piece on the master
    kasa(xs, ys, trim)                   least-squares circle through points
    pivot(under, over)                   the joint from the tucked piece's cap circle

A pose is (r, theta, cx, cy): the piece is drawn at r times its size in the
master and tilted by theta degrees (counter-clockwise as the eye sees it); laid on
the master it is scaled by 1/r, turned back by -theta and centred on (cx, cy).
Matching reads lightness over a mid grey (clear is neither ink nor white) and its
gradient, under the piece plus a thin ring of clear. The search runs r over
geomspace(search_scale_min, search_scale_max) and theta over ±search_rot_deg at a
quarter of the size, then refines at half and at full size, stepping to the top
of a parabola in scale and in turn. A second pass leaves out the piece's pixels
that the master shows differently (the cap under its parent and the hidden areas
drawn in) and re-scores what is left.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image

from . import imaging as im
from .spec import TOL

GREY = 0.5  # what clear reads as when matching
BAND = 2  # px of clear around a piece that its match includes
COARSE = 0.25  # working size of the coarse search
FINE = 0.5  # and of the first refinement; the last runs at full size
COARSE_SCALES = 9
COARSE_ROT_STEP = 4.0
# Each refinement: (size, first scale step, first turn step in degrees, rounds, how
# far in px the centre may move). A round tries five scales, then five turns, each
# time stepping to the top of the parabola; a round that stays inside halves the steps.
REFINE = ((FINE, 0.02, 1.5, 2, 8), (1.0, 0.006, 0.6, 3, 3))


def warp(rgba: np.ndarray, m: float, theta: float, size: tuple[int, int], centre: tuple[float, float]) -> np.ndarray:
    """rgba (h x w) scaled by m and turned by theta degrees, so its own centre
    lands on `centre` (x, y) of a `size` (w, h) canvas; premultiplied bicubic."""
    h, w = rgba.shape[:2]
    c, s = np.cos(np.radians(theta)), np.sin(np.radians(theta))
    cx, cy = centre
    a, b = c / m, -s / m
    d, e = s / m, c / m
    x0 = w / 2 - (a * cx + b * cy)
    y0 = h / 2 - (d * cx + e * cy)
    img = Image.fromarray(np.asarray(rgba, np.uint8), "RGBA").convert("RGBa")
    out = img.transform(tuple(size), Image.AFFINE, (a, b, x0, d, e, y0), resample=Image.BICUBIC)
    return np.array(out.convert("RGBA"))


def template(rgba: np.ndarray, m: float, theta: float) -> np.ndarray:
    """The piece posed on a canvas just big enough, centred."""
    h, w = rgba.shape[:2]
    c, s = abs(np.cos(np.radians(theta))), abs(np.sin(np.radians(theta)))
    W = int(np.ceil((w * c + h * s) * m)) + 2 + 2 * BAND
    H = int(np.ceil((w * s + h * c) * m)) + 2 + 2 * BAND
    return warp(rgba, m, theta, (W, H), (W / 2, H / 2))


def template_mask(t: np.ndarray) -> np.ndarray:
    """The piece and a BAND-pixel ring of clear around it, so its silhouette
    counts too (a dark sleeve on clear has little else to match on)."""
    return im.dilate(t[..., 3] > 127, BAND)


def features(rgba: np.ndarray) -> np.ndarray:
    """Two channels: lightness over a mid grey (so clear reads apart from both
    ink and white), and the size of its gradient (the ink lines and the outline)."""
    a = rgba[..., 3].astype(np.float64) / 255
    rgb = rgba[..., :3].astype(np.float64) / 255
    lum = (rgb @ np.array([0.2126, 0.7152, 0.0722])) * a + GREY * (1 - a)
    p = np.pad(lum, 1, mode="edge")
    gx = p[1:-1, 2:] - p[1:-1, :-2]
    gy = p[2:, 1:-1] - p[:-2, 1:-1]
    return np.stack([lum, np.hypot(gx, gy)])


def shrink(rgba: np.ndarray, f: float) -> np.ndarray:
    if f == 1:
        return rgba
    h, w = rgba.shape[:2]
    img = Image.fromarray(rgba, "RGBA").convert("RGBa")
    return np.array(img.resize((max(1, round(w * f)), max(1, round(h * f))), Image.LANCZOS).convert("RGBA"))


def fast_len(n: int) -> int:
    """The smallest 2^a 3^b 5^c at least n (sizes the FFT handles fastest)."""
    best = 1 << max(0, int(n - 1).bit_length())
    f5 = 1
    while f5 < best:
        f35 = f5
        while f35 < best:
            f = f35
            while f < n:
                f *= 2
            best = min(best, f)
            f35 *= 3
        f5 *= 5
    return best


class Target:
    """A target image's FFTs, kept for many templates. The image is zero-padded
    to a fast FFT size; `shape` stays the image's own."""

    def __init__(self, rgba: np.ndarray):
        self.rgba = rgba
        self.shape = rgba.shape[:2]
        self.fft_shape = (fast_len(self.shape[0]), fast_len(self.shape[1]))
        F = features(rgba)
        P = np.zeros((F.shape[0], *self.fft_shape))
        P[:, : self.shape[0], : self.shape[1]] = F
        self.F = P
        self.fI = [np.fft.rfft2(ch) for ch in P]
        self.fI2 = [np.fft.rfft2(ch * ch) for ch in P]


def masked_ncc(target: Target, tmpl: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """The mean over both feature channels of the masked NCC of `tmpl` (its own
    features, under `mask`) at every top-left offset where it fits inside the
    target. Returns an (H - h + 1) x (W - w + 1) map (empty if it doesn't fit)."""
    H, W = target.shape
    FH, FW = target.fft_shape
    h, w = tmpl.shape[:2]
    if h > H or w > W:
        return np.zeros((0, 0))
    T = features(tmpl)
    M = mask.astype(np.float64)
    n = M.sum()
    if n < 4:
        return np.zeros((H - h + 1, W - w + 1))
    Mp = np.zeros((FH, FW))
    Mp[:h, :w] = M
    fM = np.conj(np.fft.rfft2(Mp))
    out = np.zeros((H - h + 1, W - w + 1))
    used = 0
    valid = (slice(0, H - h + 1), slice(0, W - w + 1))
    for k in range(T.shape[0]):
        sT = (T[k] * M).sum()
        vt = (T[k] ** 2 * M).sum() - sT * sT / n
        if vt <= 1e-9 * n:
            continue  # a flat channel says nothing about where the piece goes
        used += 1
        TM = np.zeros((FH, FW))
        TM[:h, :w] = T[k] * M
        fTM = np.conj(np.fft.rfft2(TM))
        sIM = np.fft.irfft2(target.fI[k] * fM, s=(FH, FW))[valid]
        sI2M = np.fft.irfft2(target.fI2[k] * fM, s=(FH, FW))[valid]
        sITM = np.fft.irfft2(target.fI[k] * fTM, s=(FH, FW))[valid]
        num = sITM - sIM * sT / n
        vi = np.maximum(sI2M - sIM * sIM / n, 0)
        den = np.sqrt(vt * vi)
        ok = vi > 1e-6 * n  # a flat patch of the target matches nothing
        out += np.where(ok, np.clip(num / np.maximum(den, 1e-12), -1, 1), 0)
    return out / max(used, 1)


def _peak(score: np.ndarray, window: tuple | None = None) -> tuple[float, float, float]:
    """(best value, x, y) with a parabolic sub-pixel step; `window` (x0, y0, x1, y1)
    limits where the peak may be."""
    s = score
    if window is not None:
        x0, y0, x1, y1 = window
        s = np.full_like(score, -np.inf)
        s[max(0, y0) : max(0, y1), max(0, x0) : max(0, x1)] = score[max(0, y0) : max(0, y1), max(0, x0) : max(0, x1)]
    iy, ix = np.unravel_index(int(np.argmax(s)), s.shape)
    v = float(s[iy, ix])

    def sub(a, b, c):
        d = a - 2 * b + c
        return 0.0 if abs(d) < 1e-12 else float(np.clip(0.5 * (a - c) / d, -0.5, 0.5))

    dx = sub(score[iy, ix - 1], score[iy, ix], score[iy, ix + 1]) if 0 < ix < score.shape[1] - 1 else 0.0
    dy = sub(score[iy - 1, ix], score[iy, ix], score[iy + 1, ix]) if 0 < iy < score.shape[0] - 1 else 0.0
    return v, ix + dx, iy + dy


@dataclass
class Reg:
    r: float  # the piece is drawn at r times its master size
    theta: float  # and tilted by theta degrees
    cx: float  # its centre lands here on the master
    cy: float
    ncc: float
    coverage: float = 0.0
    excluded: float = 0.0  # share of the piece left out in the second pass
    ncc_first: float | None = None  # the search's own score, before the second pass

    @property
    def m(self) -> float:
        return 1 / self.r

    def json(self) -> dict:
        return {
            "r": round(self.r, 4),
            "tilt": round(self.theta, 2),
            "centre": [round(self.cx, 2), round(self.cy, 2)],
            "ncc": round(self.ncc, 4),
            "coverage": round(self.coverage, 4),
            "excluded": round(self.excluded, 4),
            **({"ncc_first": round(self.ncc_first, 4)} if self.ncc_first is not None else {}),
        }


def _grid(target: Target, piece: np.ndarray, f: float, rs, thetas, window=None) -> list[tuple]:
    """(score, r, theta, cx, cy) for every pose, cx/cy in target pixels / f."""
    out = []
    for r in rs:
        for th in thetas:
            t = template(piece, f / r, -th)
            sc = masked_ncc(target, t, template_mask(t))
            if sc.size == 0:
                continue
            th_, tw_ = t.shape[:2]
            win = None
            if window is not None:
                x0, y0, x1, y1 = window
                win = (int(x0 - tw_ / 2), int(y0 - th_ / 2), int(x1 - tw_ / 2) + 1, int(y1 - th_ / 2) + 1)
            v, x, y = _peak(sc, win)
            if np.isfinite(v):
                out.append((v, float(r), float(th), (x + tw_ / 2) / f, (y + th_ / 2) / f))
    return out


def _vertex(xs, vs) -> float:
    """The x of the parabola's top through three (x, v), clamped to their span."""
    (x0, x1, x2), (a, b, c) = xs, vs
    d = a - 2 * b + c
    if abs(d) < 1e-12:
        return x1
    return float(np.clip(x1 + 0.5 * (a - c) / d * (x2 - x1), x0, x2))


def register(
    piece: np.ndarray,
    master: np.ndarray,
    near: tuple[float, float, float, float] | None = None,
    r_range: tuple[float, float] | None = None,
    rot: float | None = None,
    coarse_target: Target | None = None,
    start: "Reg | None" = None,
) -> Reg | None:
    """The pose that lays `piece` (RGBA, cut to its box) on `master` (the cut
    master, full canvas). `near` (x0, y0, x1, y1) in master pixels limits where its
    centre may land; r_range and rot narrow the search. Coarse at a quarter size,
    then refined twice on a crop around the landing (half size, then full size,
    with a parabolic step in scale and turn), then re-scored by the second pass.
    With `start` (a pose already close, such as another head of the same face
    sheet), only the full-size refinement runs."""
    rot = TOL["search_rot_deg"] if rot is None else rot
    stages = REFINE
    if start is not None:
        v, r0, th0, cx0, cy0 = start.ncc, start.r, start.theta, start.cx, start.cy
        stages = REFINE[-1:]
    else:
        lo, hi = r_range or (TOL["search_scale_min"], TOL["search_scale_max"])
        tgt = coarse_target or Target(shrink(master, COARSE))
        rs = np.geomspace(lo, hi, COARSE_SCALES) if hi > lo else [lo]
        thetas = np.linspace(-rot, rot, 2 * int(np.ceil(rot / COARSE_ROT_STEP)) + 1) if rot > 0 else [0.0]
        win = None if near is None else tuple(q * COARSE for q in near)
        grid = _grid(tgt, piece, COARSE, rs, thetas, win)
        if not grid:
            return None
        v, r0, th0, cx0, cy0 = max(grid)
    ph, pw = piece.shape[:2]
    for f, rstep, tstep, rounds, slack in stages:
        th_, tw_ = template(piece, 1.03 / r0, -th0).shape[:2]
        rx, ry = tw_ / 2 + 2 * rounds * slack + 4, th_ / 2 + 2 * rounds * slack + 4
        x0, y0 = int(max(0, cx0 - rx)), int(max(0, cy0 - ry))
        x1, y1 = int(min(master.shape[1], cx0 + rx)), int(min(master.shape[0], cy0 + ry))
        fine = Target(shrink(master[y0:y1, x0:x1], f))
        best = (v, r0, th0, cx0 - x0, cy0 - y0)
        for _ in range(rounds):
            moved = False
            for axis, step in ((1, rstep), (2, tstep)):
                if axis == 2 and rot <= 0:
                    continue
                _, r_, t_, cx_, cy_ = best
                w2 = tuple(q * f for q in (cx_ - slack, cy_ - slack, cx_ + slack, cy_ + slack))
                if axis == 1:
                    vals = [r_ * (1 + k * step) for k in (-2, -1, 0, 1, 2)]
                    g = _grid(fine, piece, f, vals, [t_], w2)
                else:
                    vals = [t_ + k * step for k in (-2, -1, 0, 1, 2)]
                    g = _grid(fine, piece, f, [r_], vals, w2)
                if len(g) < 5:
                    continue
                scores = [q[0] for q in g]
                i = int(np.argmax(scores))
                if i in (0, 4):
                    best = g[i]
                    moved = True
                    continue
                x = _vertex(vals[i - 1 : i + 2], scores[i - 1 : i + 2])
                pick = _grid(fine, piece, f, [x] if axis == 1 else [r_], [t_] if axis == 1 else [x], w2)
                best = max([g[i], *pick])
            if not moved:
                rstep, tstep = rstep / 2, tstep / 2
        v, r0, th0, cx0, cy0 = best
        cx0, cy0 = cx0 + x0, cy0 + y0
    reg = Reg(r=float(r0), theta=float(th0), cx=float(cx0), cy=float(cy0), ncc=float(v))
    return second_pass(piece, master, reg)


def bake(piece: np.ndarray, reg: Reg, shape) -> np.ndarray:
    """The piece in master coordinates (a full canvas), at its registered pose."""
    return warp(piece, reg.m, -reg.theta, (shape[1], shape[0]), (reg.cx, reg.cy))


def second_pass(piece: np.ndarray, master: np.ndarray, reg: Reg) -> Reg:
    """Re-score with the pixels the master shows differently left out (the cap
    under the parent and areas the master hides), and measure coverage."""
    baked = bake(piece, reg, master.shape)
    a = baked[..., 3] > 127
    if not a.any():
        return reg
    ys, xs = np.nonzero(a)
    pl = im.lab(baked[ys, xs, :3].astype(np.float64))
    ml = im.lab(master[ys, xs, :3].astype(np.float64))
    differs = (im.de00(pl, ml) > TOL["diff_de00"]) | (master[ys, xs, 3] < 128)
    reg.coverage = float((master[ys, xs, 3] > 127).mean())
    reg.ncc_first = reg.ncc
    reg.excluded = float(differs.mean())
    keep = ~differs
    if keep.sum() >= 16:
        x0, y0, x1, y1 = im.bbox(ys, xs)
        sub_m = master[y0:y1, x0:x1]
        sub_b = baked[y0:y1, x0:x1]
        mask = np.zeros(sub_b.shape[:2], bool)
        mask[ys[keep] - y0, xs[keep] - x0] = True
        Fm, Fb = features(sub_m), features(sub_b)
        vals = []
        for k in range(2):
            p, q = Fb[k][mask], Fm[k][mask]
            p, q = p - p.mean(), q - q.mean()
            den = np.sqrt((p * p).sum() * (q * q).sum())
            if den > 1e-9:
                vals.append(float((p * q).sum() / den))
        if vals:
            reg.ncc = float(np.mean(vals))
    return reg


def unexplained(baked: np.ndarray, master: np.ndarray, others: np.ndarray) -> float:
    """The share of a placed piece (baked, master frame) that the master doesn't
    show as it is: off the figure, or in another colour where no other placed
    piece lies (`others`, their union).

    The second pass leaves out what the master shows differently, which a cap
    under its parent or a hidden area drawn in explains: another piece is there.
    Where no piece is there, a different colour (or no figure at all) means the
    piece itself is drawn or placed wrong, and its NCC over what is left would
    hide it."""
    a = baked[..., 3] > 127
    if not a.any():
        return 1.0
    on = master[..., 3] >= 128
    ys, xs = np.nonzero(a & on & ~others)
    d = im.de00(im.lab(baked[ys, xs, :3].astype(np.float64)), im.lab(master[ys, xs, :3].astype(np.float64)))
    return float(((d > TOL["diff_de00"]).sum() + (a & ~on).sum()) / a.sum())


# ---------- joints ----------


def kasa(xs: np.ndarray, ys: np.ndarray, trim: int = 0) -> tuple[float, float, float, float] | None:
    """(cx, cy, r, residual / r) of the least-squares circle through the points.
    With trim, refits up to that many times on the points within twice the RMS
    residual of the last circle (so a cap's straight sides don't bend its arc)."""
    xs, ys = np.asarray(xs, np.float64), np.asarray(ys, np.float64)
    out = None
    for _ in range(trim + 1):
        if len(xs) < 3:
            return out
        A = np.stack([xs, ys, np.ones_like(xs)], 1)
        sol, *_ = np.linalg.lstsq(A, -(xs**2 + ys**2), rcond=None)
        D, E, F = sol
        cx, cy = -D / 2, -E / 2
        r2 = cx * cx + cy * cy - F
        if r2 <= 0:
            return out
        r = float(np.sqrt(r2))
        d = np.hypot(xs - cx, ys - cy) - r
        rms = float(np.sqrt(np.mean(d**2)))
        out = (float(cx), float(cy), r, rms / r)
        keep = np.abs(d) <= max(2 * rms, 1.0)
        if keep.all():
            break
        xs, ys = xs[keep], ys[keep]
    return out


def half_width(mask: np.ndarray, where: np.ndarray | None = None, most: int = 96) -> float:
    """The radius of the biggest disc inside the mask (how thick the piece is),
    centred in `where` when given (how thick it is there)."""
    box = im.mask_bbox(mask)
    if box is None:
        return 0.0
    x0, y0, x1, y1 = box
    d = im.distance_in(mask[y0:y1, x0:x1], most)
    if where is not None:
        d = d * where[y0:y1, x0:x1]
    return float(d.max())


def pivot(under: np.ndarray, over: np.ndarray, short: float | None = None) -> dict:
    """The joint between two pieces (baked masks, master frame): a Kasa circle
    fitted to the round end of the piece that tucks under, inside the one on top
    (its cap); else the overlap's centroid; else the point of `under` nearest
    `over` (no cap). The cap's outline is taken near its tip, the point of `under`
    deepest past the overlap, within 1.4 half-widths of where its centre should
    be. `short` is the moving piece's thickness (twice its half-width when not
    given), which the cap's radius is measured against (cap_r_min..cap_r_max)."""
    overlap = under & im.dilate(over, 2)
    w = half_width(under, overlap)
    if short is None:
        short = 2 * w
    if overlap.sum() >= 40 and w > 0:
        ys, xs = np.nonzero(under)
        oy, ox = np.nonzero(overlap)
        c = np.array([xs.mean(), ys.mean()])
        u = np.array([ox.mean(), oy.mean()]) - c
        u = u / max(float(np.hypot(*u)), 1e-9)
        along = (ox - c[0]) * u[0] + (oy - c[1]) * u[1]
        i = int(np.argmax(along))
        tip = np.array([ox[i] + 0.5, oy[i] + 0.5])
        guess = tip - w * u
        edge = under & ~im.erode(under, 1) & overlap
        ey, ex = np.nonzero(edge)
        # The round end only: the outline past the cap's centre, toward its tip.
        ahead = (ex + 0.5 - guess[0]) * u[0] + (ey + 0.5 - guess[1]) * u[1] >= -0.1 * w
        near = (np.hypot(ex + 0.5 - guess[0], ey + 0.5 - guess[1]) <= 1.4 * w) & ahead
        fit = kasa(ex[near] + 0.5, ey[near] + 0.5, trim=2) if near.sum() >= 8 else None
        if fit:
            cx, cy, r, resid = fit
            inside = float(np.min(np.hypot(ox + 0.5 - cx, oy + 0.5 - cy))) <= r
            if TOL["cap_r_min"] * short <= r <= TOL["cap_r_max"] * short and inside:
                return {"kind": "cap", "x": cx, "y": cy, "r": r, "residual": resid}
        return {"kind": "overlap", "x": float(ox.mean() + 0.5), "y": float(oy.mean() + 0.5), "r": None, "residual": None}
    ys, xs = np.nonzero(under)
    pys, pxs = np.nonzero(over)
    if len(ys) == 0 or len(pys) == 0:
        return {"kind": "none", "x": None, "y": None, "r": None, "residual": None}
    pc = np.array([pxs.mean(), pys.mean()])
    d = np.hypot(xs - pc[0], ys - pc[1])
    i = int(np.argmin(d))
    return {"kind": "no_cap", "x": float(xs[i] + 0.5), "y": float(ys[i] + 0.5), "r": None, "residual": None}
