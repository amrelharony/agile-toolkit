"""The C-checks of docs/cast/CAST-BUILD.md, with every threshold from the spec.

`TOL` is docs/cast/cast-rig.json → tolerances, unchanged (test_cast_checks.py
compares the two). Each check returns a dict with a `status`: pass, warn, fail or
skip, and the numbers behind it.

    c1_file(path, c, image)     name, PNG, canvas size
    c2_background(rgba, c)      real alpha or the flat key, no drawn checker, residue
    c3_margins(rgba)            nothing within margin_fail_px of an edge
    c4_master(rgba)             one figure after the closing; specks listed and dropped
    master_height(island)       the figure's height against master_height_px
    c9_master(rgba, colours)    every private swatch near a cluster of the master
    check_master(path, c, ...)  all of the above for one returned master
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from . import imaging as im
from . import key, palette, parts
from .spec import NAME_RE, TOL, key_rgb, parse_image_name

RANK = {"skip": 0, "pass": 1, "warn": 2, "fail": 3}


def worst(*statuses: str) -> str:
    return max(statuses, key=lambda s: RANK[s]) if statuses else "skip"


def c1_file(path: Path, c: dict, image: str, info: dict | None = None) -> dict:
    path = Path(path)
    notes = []
    named = parse_image_name(path.name)
    name_ok = bool(NAME_RE.match(path.name)) and named is not None and named[:2] == (c["id"], image)
    if not name_ok:
        notes.append(f"name {path.name} is not {c['id']}_{image}[-vN].png")
    with open(path, "rb") as f:
        magic = im.is_png_bytes(f.read(8))
    if info is None:
        _, info = im.load_rgba(path)
    png = magic and info["format"] == "PNG"
    if not png:
        notes.append(f"not a PNG ({info['format']})")
    size_ok = tuple(info["size"]) == (TOL["canvas_w"], TOL["canvas_h"])
    if not size_ok:
        notes.append(f"canvas {info['size'][0]}x{info['size'][1]}, not {TOL['canvas_w']}x{TOL['canvas_h']}")
    return {
        "status": "pass" if name_ok and png and size_ok else "fail",
        "name": name_ok,
        "png": png,
        "size": info["size"],
        "notes": notes,
    }


def border_fill(cutout: np.ndarray) -> float:
    """Share of the canvas held by drawings that touch its border: a second
    background, a frame or a panel rather than the character."""
    drawn = cutout[..., 3] > 0
    H, W = drawn.shape
    total = 0
    for ys, xs in im.components(drawn):
        if ys.min() == 0 or xs.min() == 0 or ys.max() == H - 1 or xs.max() == W - 1:
            total += len(ys)
    return total / drawn.size


def c2_background(rgba: np.ndarray, c: dict) -> tuple[dict, np.ndarray]:
    """(the C2 result, the cut-out drawing)."""
    krgb = key_rgb(c)
    checker = key.drawn_checker(rgba)
    cutout, info = key.cut(rgba, krgb)
    notes = []
    if checker["checker"]:
        notes.append(f"drawn checkerboard ({checker['square_px']} px squares): ask for the flat key colour")
    res = {"mode": info["mode"], "checker": checker, "alpha": info["alpha"], "residue": info["residue"]}
    ok = not checker["checker"]
    if info["mode"] == "alpha":
        if not info["alpha"]["soft_edge"]:
            ok = False
            notes.append("real alpha with a hard edge (no antialiasing)")
    else:
        kinfo = key.key_info(rgba, krgb)
        res["key"] = kinfo
        if not kinfo["enough"]:
            ok = False
            notes.append(
                f"only {kinfo['share']:.0%} of the image is the key colour (border reads {kinfo['measured']})"
            )
        if not kinfo["flat"]:
            ok = False
            notes.append(f"background not flat: border p95 dE00 {kinfo['border_p95']}")
    if info["residue"] > TOL["despill_residue_max"]:
        ok = False
        notes.append(f"key residue on {info['residue']:.2%} of edge pixels")
    fill = border_fill(cutout)
    res["border_fill"] = round(fill, 4)
    if fill >= TOL["flat_fill_max"]:
        ok = False
        notes.append(f"a fill touching the border covers {fill:.1%} of the image")
    res["status"] = "pass" if ok else "fail"
    res["notes"] = notes
    return res, cutout


def c3_margins(cutout: np.ndarray) -> dict:
    drawn = cutout[..., 3] > TOL["margin_alpha"]
    H, W = drawn.shape
    if not drawn.any():
        return {"status": "fail", "notes": ["nothing drawn"], "margins": None}
    ys, xs = np.nonzero(drawn)
    m = {"top": int(ys.min()), "bottom": int(H - 1 - ys.max()), "left": int(xs.min()), "right": int(W - 1 - xs.max())}
    low = min(m.values())
    notes = [f"{k} margin {v} px" for k, v in m.items() if v < TOL["margin_ask_px"]]
    status = "fail" if low < TOL["margin_fail_px"] else "warn" if low < TOL["margin_ask_px"] else "pass"
    return {"status": status, "margins": m, "notes": notes}


def c4_master(cutout: np.ndarray) -> tuple[dict, np.ndarray, "parts.Island | None"]:
    """(C4 for a master, the drawing with its specks dropped, the figure)."""
    pieces, specks = parts.islands(cutout)
    cleaned = parts.drop(cutout, specks)
    res = {
        "specks": [s.json() for s in specks],
        "figures": len(pieces),
        "extra": [p.json() for p in pieces[1:]],
        "notes": [],
    }
    if specks:
        res["notes"].append(f"{len(specks)} speck(s) under {TOL['speck_px']} px dropped")
    if not pieces:
        res["status"] = "fail"
        res["notes"].append("no figure")
        return res, cleaned, None
    if len(pieces) > 1:
        res["notes"].append(f"{len(pieces)} separate drawings, expected one figure")
    res["status"] = "pass" if len(pieces) == 1 else "fail"
    res["figure"] = pieces[0].json()
    return res, cleaned, pieces[0]


def master_height(fig: "parts.Island | None") -> dict:
    if fig is None:
        return {"status": "skip"}
    x0, y0, x1, y1 = fig.box
    h = y1 - y0
    ratio = h / TOL["master_height_px"]
    out = {
        "height_px": h,
        "width_px": x1 - x0,
        "ratio": round(ratio, 3),
        "floor_gap_px": TOL["canvas_h"] - y1,
        "notes": [],
    }
    if ratio < TOL["scale_min"] or ratio > TOL["scale_max"]:
        out["status"] = "warn"
        out["notes"].append(
            f"{h} px tall against about {TOL['master_height_px']} (fine for a wide character drawn to the margins)"
        )
    else:
        out["status"] = "pass"
    return out


def c9_master(cutout: np.ndarray, colours: list[tuple[str, str]] | None) -> dict:
    if colours is None:
        return {"status": "skip", "notes": ["no private block to compare with"], "colours": []}
    res = palette.master_colours(cutout, colours)
    far = [r["label"] for r in res["colours"] if r["status"] == "far"]
    shift = [r["label"] for r in res["colours"] if r["status"] == "shift"]
    res["notes"] = []
    if far:
        res["notes"].append(
            f"{len(far)} swatch(es) over dE00 {TOL['de00_regen']} from every cluster "
            "(not drawn, drawn wrong, or hidden at rest)"
        )
    if shift:
        res["notes"].append(f"{len(shift)} swatch(es) between dE00 {TOL['de00_fix']} and {TOL['de00_regen']}")
    return res


def c9_sheet(img: str, rows: list[dict], named) -> dict:
    """C9 on a later sheet from its palette lock's rows (palette.lock): how far
    each colour was drawn from the master's, and how close the lock brought it.

    A named colour (grown from a swatch) that the lock moved, or was too far from
    to move, counts by its distance before the lock: past de00_regen the sheet is
    regenerated, past de00_fix it takes an edit line. (The far-off clusters may be
    edge blends, so only their agreement after the lock counts.) After the lock
    the moved colours must agree: median at most lock_median_max, each at most
    lock_swatch_max. A colour the sheet doesn't hold (far, or its cluster taken by
    a closer one) stays out of the score."""
    st, notes = "pass", []
    for r in rows:
        if not named[r["target"]] or not (r["moved"] or r.get("why") == "clamped"):
            continue
        if r["before"] > TOL["de00_regen"]:
            st = "fail"
            notes.append(f"{img}: a colour drawn {r['before']:.1f} dE00 off the master's: regenerate")
        elif r["before"] > TOL["de00_fix"]:
            st = worst(st, "warn")
            notes.append(f"{img}: a colour drawn {r['before']:.1f} dE00 off the master's: an edit line")
    after = [r["after"] for r in rows if r["moved"]]
    med = float(np.median(after)) if after else 0.0
    top = max(after) if after else 0.0
    if med > TOL["lock_median_max"] or top > TOL["lock_swatch_max"]:
        st = "fail"
        notes.append(f"{img}: after the lock, median dE00 {med:.1f}, worst {top:.1f}")
    return {"median_after": round(med, 2), "max_after": round(top, 2), "status": st, "notes": notes}


def check_master(path: Path, c: dict, colours: list[tuple[str, str]] | None) -> tuple[dict, dict]:
    """(report, review images) for one returned master. The images are the cut
    figure (specks dropped) and the speck and extra boxes, for the contact sheet."""
    rgba, info = im.load_rgba(path)
    r1 = c1_file(path, c, "master", info)
    r2, cutout = c2_background(rgba, c)
    r4, cleaned, fig = c4_master(cutout)
    r3 = c3_margins(cleaned)
    rh = master_height(fig)
    r9 = c9_master(cleaned, colours)
    checks = {"C1": r1, "C2": r2, "C3": r3, "C4": r4, "height": rh, "C9": r9}
    report = {
        "id": c["id"],
        "image": "master",
        "file": Path(path).name,
        "sha256": im.sha256_file(path),
        "status": worst(*(v["status"] for v in checks.values())),
        "checks": checks,
    }
    return report, {"cutout": cleaned, "figure": fig, "specks": r4["specks"], "extra": r4["extra"]}
