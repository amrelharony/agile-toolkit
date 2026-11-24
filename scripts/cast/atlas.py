"""Packing a rig's sprites into one atlas per character, and writing the WebPs.

    maxrects(sizes, gutter, w)    MaxRects placements (lowest first, then best short side)
    compose_atlas(sprites, ...)   the 2x atlas (and the rects at 1x)
    one_x(atlas2x)                the 1x atlas: halved, then sharpened back by bisection
    webp(img, budget_kb)          WebP bytes at the first quality in pack.webp_quality that fits
    atlas_names(cid, b1, b2)      aaw-NN.<sha8>.webp and aaw-NN@2x.<sha8>.webp

Packing is at 1x with pack.gutter_1x_px between rects; the 2x atlas doubles every
coordinate, so 2x is exactly twice 1x. 1x is a premultiplied Lanczos halving of
2x, then heads.sharpen bisected until heads.detail reaches pack.detail_1x of the
2x atlas's.
"""

from __future__ import annotations

import io

import mascot_heads as heads
import numpy as np
from PIL import Image

from . import imaging as im
from .spec import PACK

WIDTHS = (256, 384, 512, 768, 1024)  # 1x atlas widths tried in turn


def maxrects(sizes: list[tuple[int, int]], gutter: int, width: int) -> list[tuple[int, int]] | None:
    """Top-left (x, y) for each (w, h), in a strip `width` wide, tallest first,
    each where it sits lowest (then best short side fit); None if one is wider than the strip. Each rect is grown by
    the gutter on its right and bottom (and the strip by one on its left and top),
    so neighbours never touch."""
    order = sorted(range(len(sizes)), key=lambda i: (-sizes[i][1], -sizes[i][0], i))
    tall = sum(h + gutter for _, h in sizes) + gutter
    free = [(gutter, gutter, width - gutter, tall)]  # x, y, w, h
    out: list = [None] * len(sizes)
    for i in order:
        w, h = sizes[i][0] + gutter, sizes[i][1] + gutter
        best = None
        for fx, fy, fw, fh in free:
            if w <= fw and h <= fh:
                short = min(fw - w, fh - h)
                key = (fy + h, short, fx)
                if best is None or key < best[0]:
                    best = (key, fx, fy)
        if best is None:
            return None
        _, x, y = best
        out[i] = (x, y)
        placed = (x, y, w, h)
        nxt = []
        for f in free:
            nxt.extend(_split(f, placed))
        free = _prune(nxt)
    return out


def _split(f, r):
    fx, fy, fw, fh = f
    rx, ry, rw, rh = r
    if rx >= fx + fw or rx + rw <= fx or ry >= fy + fh or ry + rh <= fy:
        return [f]
    out = []
    if rx > fx:
        out.append((fx, fy, rx - fx, fh))
    if rx + rw < fx + fw:
        out.append((rx + rw, fy, fx + fw - rx - rw, fh))
    if ry > fy:
        out.append((fx, fy, fw, ry - fy))
    if ry + rh < fy + fh:
        out.append((fx, ry + rh, fw, fy + fh - ry - rh))
    return out


def _prune(free):
    keep = []
    for i, a in enumerate(free):
        inside = False
        for j, b in enumerate(free):
            if i != j and a[0] >= b[0] and a[1] >= b[1] and a[0] + a[2] <= b[0] + b[2] and a[1] + a[3] <= b[1] + b[3]:
                if a != b or i > j:
                    inside = True
                    break
        if not inside:
            keep.append(a)
    return keep


def pack(sizes1x: list[tuple[int, int]]) -> tuple[list[tuple[int, int]], tuple[int, int]]:
    """(positions at 1x, atlas size at 1x): the narrowest width in WIDTHS that
    keeps the atlas no taller than it is wide (or the widest)."""
    g = PACK["gutter_1x_px"]
    last = None
    for W in WIDTHS:
        pos = maxrects(sizes1x, g, W)
        if pos is None:
            continue
        H = max(y + h for (x, y), (w, h) in zip(pos, sizes1x)) + g
        last = (pos, (W, H))
        if H <= W:
            return last
    if last is None:
        raise ValueError("a sprite is wider than the widest atlas")
    return last


def compose_atlas(sprites2x: list[np.ndarray]) -> tuple[Image.Image, list[tuple[int, int, int, int]]]:
    """(the 2x atlas, each sprite's rect at 1x (x, y, w, h)). Each 2x sprite is
    padded to even size so its 1x rect is exactly half."""
    padded = []
    for s in sprites2x:
        h, w = s.shape[:2]
        p = np.zeros((h + h % 2, w + w % 2, 4), np.uint8)
        p[:h, :w] = s
        padded.append(p)
    sizes1 = [(p.shape[1] // 2, p.shape[0] // 2) for p in padded]
    pos, (W, H) = pack(sizes1)
    atlas = np.zeros((2 * H, 2 * W, 4), np.uint8)
    rects = []
    for p, (x, y), (w, h) in zip(padded, pos, sizes1):
        atlas[2 * y : 2 * y + 2 * h, 2 * x : 2 * x + 2 * w] = p
        rects.append((x, y, w, h))
    return Image.fromarray(atlas, "RGBA"), rects


def one_x(atlas2x: Image.Image) -> tuple[Image.Image, float]:
    """(the 1x atlas, the sharpen amount used)."""
    W, H = atlas2x.size
    small = atlas2x.convert("RGBa").resize((W // 2, H // 2), Image.LANCZOS).convert("RGBA")
    d2 = heads.detail(atlas2x)
    if d2 is None:
        return small, 0.0
    goal = PACK["detail_1x"] * d2
    radius, top = PACK["sharpen_radius"], PACK["sharpen_max"]
    d1 = heads.detail(small)
    if d1 is None or d1 >= goal:
        return small, 0.0
    if heads.detail(heads.sharpen(small, top, radius)) < goal:
        return heads.sharpen(small, top, radius), float(top)
    lo, hi = 0.0, float(top)
    for _ in range(7):
        mid = (lo + hi) / 2
        if heads.detail(heads.sharpen(small, mid, radius)) < goal:
            lo = mid
        else:
            hi = mid
    amount = round((lo + hi) / 2, 2)
    return heads.sharpen(small, amount, radius), amount


def webp(img: Image.Image, budget_kb: float | None = None) -> tuple[bytes, int, bool]:
    """(bytes, quality, within budget): the first quality in pack.webp_quality whose
    file fits the budget, else the last one tried."""
    data, q = b"", 0
    for q in PACK["webp_quality"]:
        buf = io.BytesIO()
        img.save(
            buf,
            "WEBP",
            quality=q,
            method=PACK["webp_method"],
            alpha_quality=PACK["webp_alpha_quality"],
            exact=False,
        )
        data = buf.getvalue()
        if budget_kb is None or len(data) <= budget_kb * 1024:
            return data, q, True
    return data, q, False


def atlas_names(cid: str, b1: bytes, b2: bytes) -> tuple[str, str]:
    nn = cid.split("-")[1]
    return (
        f"aaw-{nn}.{im.sha256_bytes(b1)[:8]}.webp",
        f"aaw-{nn}@2x.{im.sha256_bytes(b2)[:8]}.webp",
    )


def rects_ok(rects: list[tuple[int, int, int, int]], size: tuple[int, int]) -> bool:
    """Every rect inside the atlas, no two overlapping."""
    W, H = size
    for i, (x, y, w, h) in enumerate(rects):
        if x < 0 or y < 0 or x + w > W or y + h > H:
            return False
        for X, Y, Wd, Hd in rects[i + 1 :]:
            if x < X + Wd and X < x + w and y < Y + Hd and Y < y + h:
                return False
    return True
