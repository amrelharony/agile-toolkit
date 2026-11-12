"""Colour against the private swatches: the master check (C9) and the palette lock.

The swatches are read at run time from the private sources folder
(sources/blocks/<id>.txt, its COLOURS section) and never written into the repo:
reports with them go only to the private review folder.

    block_colours(sources, id)        [(label, hex)] from the character's block
    clusters(rgba, seeds)             deterministic k-means in Lab over the opaque drawing
    master_colours(rgba, colours)     per swatch: the nearest cluster, its ΔE00, a status
    lock(rgba, targets)               shift each cluster onto its target, keeping the shading
"""

from __future__ import annotations

import re
from pathlib import Path

import mascot_heads as heads
import numpy as np

from . import imaging as im
from .spec import TOL

HEX = re.compile(r"#[0-9A-Fa-f]{6}\b")
HEADING = re.compile(r"^[A-Z][A-Z0-9 ()/,'-]{2,}(:|$)")
ITERATIONS = 12  # k-means rounds (the engine design)
MOST_PIXELS = 60_000  # sampled from the drawing, evenly, so the result is the same each run


def block_path(sources: Path, cid: str) -> Path:
    return Path(sources) / "sources" / "blocks" / f"{cid}.txt"


def block_colours(sources: Path, cid: str) -> list[tuple[str, str]]:
    """The (label, #RRGGBB) pairs of the character's COLOURS section, in order. A
    short lower-case label ("shade") takes the last capitalised one before it.
    Falls back to every colour in the block when there's no section."""
    lines = block_path(sources, cid).read_text(encoding="utf-8").splitlines()
    section, inside = [], False
    for line in lines:
        if line.startswith("COLOURS"):
            inside = True
            continue
        if inside and HEADING.match(line):
            break
        if inside:
            section.append(line)
    text = "\n".join(section) if section else "\n".join(lines)
    out, main = [], ""
    for line in text.splitlines():
        last = 0
        for m in HEX.finditer(line):
            raw = line[last : m.start()]
            last = m.end()
            label = re.split(r"[.;:]|, |- ", raw)[-1].strip(" ,.-()")
            label = re.sub(r"\s+", " ", label)
            if not label:
                label = main
            elif label[0].islower() and main and len(label.split()) <= 2:
                label = f"{main} {label}"  # "Fur #…, shade #…" → "Fur shade"
            else:
                main = label
            out.append((label or "colour", m.group(0).upper()))
    return out


def _pixels(rgba: np.ndarray) -> tuple[np.ndarray, int]:
    """(Lab of the opaque drawing away from its edge, sampled; how many pixels
    that sample stands for in all)."""
    solid = im.erode(rgba[..., 3] >= 255 - TOL["alpha_clean"], 1)
    ys, xs = np.nonzero(solid)
    total = len(ys)
    if total == 0:
        return np.zeros((0, 3)), 0
    step = max(1, total // MOST_PIXELS)
    rgb = rgba[ys[::step], xs[::step], :3].astype(np.float64)
    return im.lab(rgb), total


def _farthest(lab: np.ndarray, centres: np.ndarray, k: int) -> np.ndarray:
    out = list(centres)
    for _ in range(k):
        d = np.min(((lab[:, None, :] - np.array(out)[None]) ** 2).sum(-1), axis=1)
        out.append(lab[int(np.argmax(d))])
    return np.array(out)


def clusters(lab: np.ndarray, seeds: np.ndarray, extra: int = 2) -> tuple[np.ndarray, np.ndarray]:
    """(centres, share of pixels per centre): k-means in Lab (ΔE76 assignment),
    started at the seeds plus `extra` far-off pixels, deterministic."""
    if len(lab) == 0:
        return seeds.copy(), np.zeros(len(seeds))
    C = _farthest(lab, np.asarray(seeds, float), extra)
    for _ in range(ITERATIONS):
        lab_idx = np.argmin(((lab[:, None, :] - C[None]) ** 2).sum(-1), axis=1)
        for k in range(len(C)):
            sel = lab_idx == k
            if sel.any():
                C[k] = lab[sel].mean(axis=0)
    lab_idx = np.argmin(((lab[:, None, :] - C[None]) ** 2).sum(-1), axis=1)
    share = np.bincount(lab_idx, minlength=len(C)) / len(lab)
    return C, share


def medians(lab: np.ndarray, C: np.ndarray) -> np.ndarray:
    """Each cluster's median member (a flat colour's own value, where the mean
    leans toward the soft edges around it)."""
    if len(lab) == 0:
        return C
    idx = np.argmin(((lab[:, None, :] - C[None]) ** 2).sum(-1), axis=1)
    out = C.copy()
    for k in range(len(C)):
        sel = idx == k
        if sel.any():
            out[k] = np.median(lab[sel], axis=0)
    return out


def master_colours(rgba: np.ndarray, colours: list[tuple[str, str]]) -> dict:
    """C9 on a cut master. For each swatch: how far away the nearest speck's worth
    of the master's pixels lies (speck_px² of them, the smallest patch that counts
    as drawn), the median colour of that patch, and ok (≤ de00_fix) / shift
    (≤ de00_regen) / far. Each swatch is judged on its own, so a big colour next
    to a small one can't pull the small one's answer away, as a shared clustering
    would."""
    lab, total = _pixels(rgba)
    per = total / max(len(lab), 1)  # how many pixels each sampled one stands for
    k = max(1, int(np.ceil(TOL["speck_px"] ** 2 / max(per, 1e-9))))
    rows = []
    for label, hexv in colours:
        t = im.hex_lab(hexv)
        row = {"label": label, "hex": hexv}
        if len(lab) < k:
            row.update(de00=None, status="far")
            rows.append(row)
            continue
        d = im.de00(lab, t)
        nearest = np.argpartition(d, k - 1)[:k]
        de = float(d[nearest].max())
        rgb = heads.lab_to_srgb(np.median(lab[nearest], axis=0))
        row.update(
            cluster="#%02X%02X%02X" % tuple(int(round(v)) for v in rgb),
            de00=round(de, 2),
            near_share=round(float((d <= TOL["de00_fix"]).mean()), 4),
            status="ok" if de <= TOL["de00_fix"] else "shift" if de <= TOL["de00_regen"] else "far",
        )
        rows.append(row)
    worst = "pass"
    if any(r["status"] == "far" for r in rows):
        worst = "fail"
    elif any(r["status"] == "shift" for r in rows):
        worst = "warn"
    return {"status": worst if rows else "skip", "colours": rows, "pixels": total}


def lock(rgba: np.ndarray, targets: np.ndarray) -> tuple[np.ndarray, list[dict]]:
    """rgba with each colour cluster moved onto its target (Lab), gated at
    `lock_gate_de00`, the move clamped to `lock_clamp_de76`, every pixel moved by a
    soft weight exp(-d²/2σ²) of its distance to the cluster (σ = `lock_sigma`)
    through heads.shift_lab, so the shading inside a colour is kept. Returns the
    locked image and, per target, the ΔE00 before and after, and why a target
    moved nothing (`why`: far, taken, clamped)."""
    lab, _ = _pixels(rgba)
    targets = np.asarray(targets, float)
    C, share = clusters(lab, targets)
    C = medians(lab, C)
    D = np.array([[heads.de2000(t, c) for c in C] for t in targets]) if len(targets) else np.zeros((0, len(C)))
    ys, xs = np.nonzero(rgba[..., 3] > 0)
    lab_px = im.lab(rgba[ys, xs, :3].astype(np.float64))
    shift = np.zeros_like(lab_px)
    weight = np.zeros(len(ys))
    report: list = [None] * len(targets)
    # Each cluster belongs to the target it is nearest; a target takes the nearest
    # of its own clusters. So a colour the sheet doesn't hold (no legs on a face
    # sheet) never takes the ink from the ink, and a colour drawn off (the body,
    # lighter) still comes to its own target, not to a neighbour's cluster.
    owner = np.argmin(D, axis=0) if len(targets) else np.zeros(len(C), int)
    for j in range(len(targets)):
        mine = [k for k in range(len(C)) if owner[k] == j]
        k = min(mine, key=lambda k: D[j, k]) if mine else int(np.argmin(D[j]))
        before = float(D[j, k])
        row = {"target": j, "before": round(before, 2), "after": round(before, 2), "moved": False, "share": round(float(share[k]), 4)}
        delta = targets[j] - C[k]
        if not mine:
            row["why"] = "taken"  # every cluster near it is nearer another target
        elif before > TOL["lock_gate_de00"]:
            row["why"] = "far"  # the sheet doesn't hold this colour
        elif float(np.linalg.norm(delta)) > TOL["lock_clamp_de76"]:
            row["why"] = "clamped"  # nearer than the gate, but further than a lock may move
        else:
            w = np.exp(-((lab_px - C[k]) ** 2).sum(-1) / (2 * TOL["lock_sigma"] ** 2))
            shift += w[:, None] * delta
            weight += w
            row["moved"] = True
        report[j] = row
    # heads.shift_lab's move, for every cluster at once (a pixel between two
    # clusters takes their weighted mean, never both in full).
    out = rgba.copy()
    lab_px += shift / np.maximum(weight, 1)[:, None]
    out[ys, xs, :3] = np.clip(heads.lab_to_srgb(lab_px) + 0.5, 0, 255).astype(np.uint8)
    lab2, _ = _pixels(out)
    C2 = medians(lab2, clusters(lab2, targets)[0])
    for row, t in zip(report, targets):
        row["after"] = round(min(heads.de2000(t, c) for c in C2), 2)
    return out, report


def sheet_targets(master: np.ndarray, seeds: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(the colours every later sheet is locked onto, which of them are named):
    the cut master's own clusters, seeded at the swatches (or at sampled pixels
    when there is no private block) plus two far-off ones, keeping each that holds
    at least a speck's worth of the drawing. A named one grew from a seed, so it
    is a colour the character is drawn in; the far-off ones may be edge blends."""
    lab, total = _pixels(master)
    C, share = clusters(lab, seeds)
    keep = share >= TOL["speck_px"] ** 2 / max(total, 1)
    named = np.arange(len(C)) < len(seeds)
    return C[keep], named[keep]
