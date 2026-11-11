"""Background removal: real alpha or the flat key colour, never a drawn checkerboard.

    alpha_info(rgba)          how much is clear, how much is a soft edge
    drawn_checker(rgba)       a checkerboard painted where transparency should be
    key_info(rgba, key_rgb)   how flat the border is, and how much of it is the key
    cut(rgba, key_rgb)        the drawing on clear, and what the cut saw (KeyInfo)

The cut, for a keyed image: the key K is the border's median. A pixel at least
`key_de00_min` from K (CIEDE2000) and not touching the background is solid
drawing; one within `key_flat_de00` is background. Every pixel between is
unmixed: its own colour F is carried out from the solid drawing next to it, alpha
is its position on the line from K to F, and its colour is (P - (1 - a) K) / a.
Then, only along a `despill_band_px` band at the drawing's edge, any chroma
pulled toward the key's (beyond F's) is taken back out in Lab, so a drawing that
is itself near the key's hue keeps it. What stays pulled there is the residue C2
measures.
"""

from __future__ import annotations

import mascot_heads as heads
import numpy as np

from . import imaging as im
from .spec import TOL


def _border(shape, band: int) -> np.ndarray:
    m = np.zeros(shape[:2], bool)
    m[:band], m[-band:], m[:, :band], m[:, -band:] = True, True, True, True
    return m


def alpha_info(rgba: np.ndarray) -> dict:
    """Clear is alpha at or under alpha_clean, solid at or over 255 - alpha_clean
    (ChatGPT's transparent PNGs fill their drawings at 250-254, not 255), soft
    between."""
    a = rgba[..., 3]
    k = TOL["alpha_clean"]
    opaque = int((a >= 255 - k).sum())
    soft = int(((a > k) & (a < 255 - k)).sum())
    clear = float((a <= k).mean())
    return {
        "clear": round(clear, 4),
        "soft_share": round(soft / max(opaque, 1), 5),
        "has_alpha": clear >= TOL["bg_transparent_min"],
        "soft_edge": soft >= TOL["antialias_min"] * max(opaque, 1),
    }


def solid_level(a: np.ndarray) -> float:
    """The alpha a drawing's inside is filled at (the median over the upper half)."""
    inner = a[a > 127]
    return float(np.median(inner)) if inner.size else 255.0


def _autocorr(lines: np.ndarray) -> np.ndarray | None:
    """The mean normalised autocorrelation of the rows of `lines` (lags 0..N-1)."""
    x = lines - lines.mean(axis=1, keepdims=True)
    n = x.shape[1]
    f = np.fft.rfft(x, n=2 * n, axis=1)
    r = np.fft.irfft(f * np.conj(f), axis=1)[:, :n]
    e = r[:, 0]
    ok = e > 1e-6 * n
    if not ok.any():
        return None
    return (r[ok] / e[ok, None]).mean(axis=0)


def drawn_checker(rgba: np.ndarray) -> dict:
    """A checkerboard drawn into the background: along the edge bands the
    (premultiplied) lightness flips at one square size and repeats at twice it."""
    band = TOL["margin_fail_px"]
    smin, smax = TOL["checker_square_min"], TOL["checker_square_max"]
    rgb = rgba[..., :3].astype(np.float64)
    a = rgba[..., 3:4].astype(np.float64) / 255
    lum = (rgb * a) @ np.array([0.2126, 0.7152, 0.0722])
    best, at = -1.0, None
    for s in (lum[:band], lum[-band:], lum[:, :band].T, lum[:, -band:].T):
        r = _autocorr(s)
        if r is None or len(r) <= 2 * smax:
            continue
        q = np.arange(smin, smax + 1)
        score = np.minimum(-r[q], r[2 * q])
        i = int(np.argmax(score))
        if score[i] > best:
            best, at = float(score[i]), int(q[i])
    return {"score": round(best, 3), "square_px": at, "checker": best >= TOL["checker_corr_min"]}


def key_info(rgba: np.ndarray, key_rgb) -> dict:
    """How the background reads against the spec's key colour."""
    rgb = rgba[..., :3].astype(np.float64)
    border = _border(rgba.shape, TOL["margin_fail_px"])
    klab = im.lab(np.array(key_rgb, np.float64))
    measured = np.median(rgb[border], axis=0)
    d_border = im.de00(im.lab(rgb[border]), klab)
    step = max(1, int(np.sqrt(rgb.shape[0] * rgb.shape[1] / 250_000)))
    sample = rgb[::step, ::step].reshape(-1, 3)
    share = float((im.de00(im.lab(sample), klab) <= TOL["key_flat_de00"]).mean())
    p95 = float(np.percentile(d_border, 95))
    return {
        "measured": "#%02X%02X%02X" % tuple(int(round(v)) for v in measured),
        "measured_de00": round(float(im.de00(im.lab(measured), klab)), 2),
        "border_p95": round(p95, 2),
        "share": round(share, 4),
        "flat": p95 <= TOL["key_flat_de00"],
        "enough": share >= TOL["bg_transparent_min"],
    }


def cut(rgba: np.ndarray, key_rgb) -> tuple[np.ndarray, dict]:
    """(the drawing on clear, as uint8 RGBA, KeyInfo). KeyInfo: mode ("alpha" or
    "key"), residue (share of edge pixels still pulled toward the key) and the
    measurements behind them. `key_rgb` is unused for real alpha."""
    ainfo = alpha_info(rgba)
    clean = TOL["alpha_clean"]
    if ainfo["has_alpha"]:
        out = rgba.copy()
        level = solid_level(rgba[..., 3])
        a = np.clip(rgba[..., 3].astype(np.float64) * 255 / max(level, 1), 0, 255)
        out[..., 3] = np.clip(a + 0.5, 0, 255).astype(np.uint8)
        out[rgba[..., 3] <= clean] = 0
        return out, {"mode": "alpha", "alpha": ainfo, "solid": level, "residue": 0.0, "edge_px": 0}

    band = TOL["despill_band_px"]
    rgb = rgba[..., :3].astype(np.float64)
    K = np.median(rgb[_border(rgba.shape, TOL["margin_fail_px"])], axis=0)
    Klab = im.lab(K)
    # Pixels that are the key exactly (most of a keyed sheet) need no colour maths.
    d = np.zeros(rgb.shape[:2])
    ys, xs = np.nonzero(np.any(rgba[..., :3] != np.round(K).astype(np.uint8), axis=-1))
    d[ys, xs] = im.de00(im.lab(rgb[ys, xs]), Klab)
    lo, hi = TOL["key_flat_de00"], TOL["key_de00_min"]
    bg = d <= lo
    solid = (d >= hi) & ~im.dilate(bg, 2)
    F, known = im.bleed(rgb, solid, band + 2)
    FK = F - K
    den = (FK**2).sum(-1)
    num = ((rgb - K) * FK).sum(-1)
    lin = np.clip(num / np.where(den > 1e-6, den, 1.0), 0, 1)
    soft = im.smoothstep(lo, hi, d)
    # Next to the drawing every pixel is unmixed (a faint edge reads close to the
    # key but is still part drawing); away from it the thresholds decide.
    unmix = known & (den > 1e-6)
    alpha = np.where(solid, 1.0, np.where(unmix, lin, np.where(bg, 0.0, soft)))
    a3 = np.maximum(alpha[..., None], 1e-6)
    col = np.where(solid[..., None], rgb, np.clip((rgb - (1 - alpha[..., None]) * K) / a3, 0, 255))
    alpha[alpha * 255 <= clean] = 0

    # Despill along the edge band, against the colour carried out from the solid drawing.
    depth = im.distance_in(alpha > 0, band + 1)
    edge = (depth >= 1) & (depth <= band)
    u = Klab[1:] / max(float(np.hypot(*Klab[1:])), 1e-6)
    ey, ex = np.nonzero(edge)
    col_lab = im.lab(col[ey, ex])
    ref_ab = im.lab(F[ey, ex])[:, 1:]
    spill = np.maximum(0, ((col_lab[:, 1:] - ref_ab) * u).sum(-1))
    w = np.clip((band + 1 - depth[ey, ex]) / 2, 0, 1) * known[ey, ex]
    col_lab[:, 1:] -= (w * spill)[:, None] * u
    left = np.maximum(0, ((col_lab[:, 1:] - ref_ab) * u).sum(-1))
    col[ey, ex] = heads.lab_to_srgb(col_lab)
    residue = float((left > TOL["residue_ab"]).mean()) if len(ey) else 0.0

    out = np.zeros_like(rgba)
    out[..., :3] = np.clip(col + 0.5, 0, 255).astype(np.uint8)
    out[..., 3] = np.clip(alpha * 255 + 0.5, 0, 255).astype(np.uint8)
    out[out[..., 3] <= clean] = 0
    return out, {
        "mode": "key",
        "alpha": ainfo,
        "key": "#%02X%02X%02X" % tuple(int(round(v)) for v in K),
        "residue": round(residue, 5),
        "edge_px": int(edge.sum()),
    }
