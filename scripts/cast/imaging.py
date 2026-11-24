"""Shared image helpers: loading, masks without wrap-around, components, colour.

The generic helpers come from scripts/mascot_heads.py as they are (srgb_to_lab,
lab_to_srgb, de2000, components, dilate, erode, fill_holes, shift_lab, detail,
sharpen). Its dilate/erode roll the array, which wraps at the edges, so the
versions here pad first. `de00` is heads.de2000 over whole arrays (the tests hold
the two equal).
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import mascot_heads as heads
import numpy as np
from PIL import Image

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def is_png_bytes(data: bytes) -> bool:
    return data[:8] == PNG_MAGIC


def load_rgba(path: Path) -> tuple[np.ndarray, dict]:
    """(H x W x 4 uint8, info) for an image file. info: format, mode, size, alpha
    (whether the file itself carries an alpha channel)."""
    with Image.open(path) as im:
        info = {
            "format": im.format,
            "mode": im.mode,
            "size": list(im.size),
            "alpha": im.mode in ("RGBA", "LA", "PA") or "transparency" in im.info,
        }
        arr = np.array(im.convert("RGBA"))
    return arr, info


def to_image(a: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(np.asarray(a, float) + 0.5, 0, 255).astype(np.uint8), "RGBA")


# ---------- masks ----------


def _grow(m: np.ndarray, r: int) -> np.ndarray:
    """m grown over a (2r+1) square, rows then columns: heads.dilate's own
    neighbourhood without its wrap-around, in 4r shifts instead of (2r+1)^2."""
    out = m.copy()
    for axis in (0, 1):
        src = out.copy()
        for k in range(1, r + 1):
            if axis == 0:
                out[k:] |= src[:-k]
                out[:-k] |= src[k:]
            else:
                out[:, k:] |= src[:, :-k]
                out[:, :-k] |= src[:, k:]
    return out


def dilate(m: np.ndarray, r: int) -> np.ndarray:
    if r <= 0:
        return m.copy()
    if r <= 2:
        return heads.dilate(np.pad(m, r), r)[r:-r, r:-r]
    return _grow(m, r)


def erode(m: np.ndarray, r: int) -> np.ndarray:
    if r <= 0:
        return m.copy()
    if r <= 2:
        return heads.erode(np.pad(m, r, constant_values=True), r)[r:-r, r:-r]
    return ~_grow(~m, r)


def closing(m: np.ndarray, r: int) -> np.ndarray:
    """m with gaps and dents narrower than about 2r closed."""
    if r <= 0:
        return m.copy()
    p = np.pad(m, 2 * r)
    return heads.erode(heads.dilate(p, r), r)[2 * r : -2 * r, 2 * r : -2 * r]


def distance_in(m: np.ndarray, most: int) -> np.ndarray:
    """For each pixel of m, how many erosions it survives (1 = on m's edge), up to
    `most`; 0 outside m."""
    d = np.zeros(m.shape, np.int32)
    cur = m.copy()
    for k in range(1, most + 1):
        d[cur] = k
        cur = erode(cur, 1)
        if not cur.any():
            break
    return d


def components(m: np.ndarray) -> list[tuple[np.ndarray, np.ndarray]]:
    return heads.components(m)


def bbox(ys: np.ndarray, xs: np.ndarray) -> tuple[int, int, int, int]:
    """(x0, y0, x1, y1), x1/y1 exclusive."""
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def mask_bbox(m: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.nonzero(m)
    return bbox(ys, xs) if len(ys) else None


# ---------- colour ----------


def lab(rgb: np.ndarray) -> np.ndarray:
    return heads.srgb_to_lab(np.asarray(rgb, np.float64))


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def hex_lab(h: str) -> np.ndarray:
    return lab(np.array(hex_rgb(h), np.float64))


def de00(lab1: np.ndarray, lab2: np.ndarray) -> np.ndarray:
    """CIEDE2000 between Lab arrays (broadcasting): heads.de2000, vectorised."""
    lab1 = np.asarray(lab1, np.float64)
    lab2 = np.asarray(lab2, np.float64)
    L1, a1, b1 = lab1[..., 0], lab1[..., 1], lab1[..., 2]
    L2, a2, b2 = lab2[..., 0], lab2[..., 1], lab2[..., 2]
    Cb = (np.hypot(a1, b1) + np.hypot(a2, b2)) / 2
    G = 0.5 * (1 - np.sqrt(Cb**7 / (Cb**7 + 25**7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = np.hypot(a1p, b1), np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360
    zero = C1p * C2p == 0
    dh = np.where(zero, 0.0, (h2p - h1p + 180) % 360 - 180)
    dHp = 2 * np.sqrt(C1p * C2p) * np.sin(np.radians(dh / 2))
    Lbp, Cbp = (L1 + L2) / 2, (C1p + C2p) / 2
    near = np.abs(h1p - h2p) <= 180
    wrap = np.where(h1p + h2p < 360, (h1p + h2p + 360) / 2, (h1p + h2p - 360) / 2)
    hbp = np.where(zero, h1p + h2p, np.where(near, (h1p + h2p) / 2, wrap))
    T = (
        1
        - 0.17 * np.cos(np.radians(hbp - 30))
        + 0.24 * np.cos(np.radians(2 * hbp))
        + 0.32 * np.cos(np.radians(3 * hbp + 6))
        - 0.20 * np.cos(np.radians(4 * hbp - 63))
    )
    Rc = 2 * np.sqrt(Cbp**7 / (Cbp**7 + 25**7))
    Rt = -np.sin(np.radians(60 * np.exp(-(((hbp - 275) / 25) ** 2)))) * Rc
    Sl = 1 + 0.015 * (Lbp - 50) ** 2 / np.sqrt(20 + (Lbp - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cbp, 1 + 0.015 * Cbp * T
    dL, dC = (L2 - L1) / Sl, (C2p - C1p) / Sc
    return np.sqrt(np.maximum(dL**2 + dC**2 + (dHp / Sh) ** 2 + Rt * dC * (dHp / Sh), 0))


def smoothstep(lo: float, hi: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - lo) / max(hi - lo, 1e-9), 0, 1)
    return t * t * (3 - 2 * t)


def bleed(rgb: np.ndarray, known: np.ndarray, steps: int) -> tuple[np.ndarray, np.ndarray]:
    """rgb with the known pixels' colours carried outward `steps` pixels (each new
    pixel the mean of its known 3x3 neighbours), and the grown known mask."""
    rgb = rgb.astype(np.float64).copy()
    known = known.copy()
    H, W = known.shape
    for _ in range(steps):
        p = np.pad(rgb * known[..., None], ((1, 1), (1, 1), (0, 0)))
        k = np.pad(known.astype(np.float64), 1)
        s = sum(p[1 + dy : 1 + dy + H, 1 + dx : 1 + dx + W] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
        n = sum(k[1 + dy : 1 + dy + H, 1 + dx : 1 + dx + W] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
        grow = ~known & (n > 0)
        if not grow.any():
            break
        rgb[grow] = s[grow] / n[grow][:, None]
        known = known | grow
    return rgb, known


def resample(rgba: np.ndarray, scale: float, angle: float = 0.0) -> np.ndarray:
    """rgba scaled by `scale` and turned by `angle` degrees (counter-clockwise, as
    the eye sees it), premultiplied so no dark fringe creeps in; the canvas grows
    to hold the whole result."""
    im = Image.fromarray(np.asarray(rgba, np.uint8), "RGBA").convert("RGBa")
    w, h = im.size
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    if (nw, nh) != (w, h):
        im = im.resize((nw, nh), Image.LANCZOS if scale < 1 else Image.BICUBIC)
    if angle:
        im = im.rotate(angle, resample=Image.BICUBIC, expand=True)
    return np.array(im.convert("RGBA"))
