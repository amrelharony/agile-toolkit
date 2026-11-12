"""The swaps: face patches cut from the face sheet, arm poses pinned at the shoulder,
and the pupils cut from the master.

    grid_order(pieces, rows, cols)       the cells of a face or arms sheet in reading order
    face_patches(cells, states, head)    edit-then-diff patches for the eyes and mouth slots
    pupils_from_master(master, head)     the pupils the master shows where the rig head's
                                         eyes are empty whites
    whites(rgba, eyes)                   a drawing's eye whites
    fill_whites(rgba, box)               a face patch's pupils painted out with the white
    shoulder_ball(rest, pivot, r)        the rest arm's shoulder end, as a template
    pin_arm(pose, ball, rest, ...)       find the ball in a pose and pin it on the pivot

Face patches (C10): every head is registered onto the rig head (scale within
±face_scale_search, turn within ±face_rot_search, after a first scale from the
boxes). What changed (ΔE00 over diff_de00, or alpha) inside a slot's band is that
slot's patch, the union over its states, grown by patch_dilate_px and cut to the
head. The bands come from the cells: the rows the eye states agree they change
and the rows the mouth states do, split between them (face_bands). Each state's crop is moved in Lab so its ring_px border ring
matches the rig head's, and feathered over feather_px. A state that changed more
than face_outside_max of the head outside its band is refused.

Eyes: an eye white is a pixel nearest the character's own eye-white swatches
(read from its private block at run time; `Eyes`), in a patch no bigger than
eye_white_max of the host, so near-white fur, a pale face or a glass body is never
one; a block with no eye white falls back to light and nearly grey. A pupil is
whatever is not eye white inside an eye white and holds a dark or pupil-coloured
seed, so an iris drawn lighter than the dark cut comes whole.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

import mascot_heads as heads

from . import imaging as im
from . import register as rg
from .spec import SOLID_ALPHA, TOL


def grid_order(pieces, rows: int, cols: int, shape) -> list[int | None]:
    """Indices of the pieces in the cells of a rows x cols grid over the canvas, in
    reading order (None for an empty cell; the biggest piece wins a shared one)."""
    H, W = shape[:2]
    cells: list[int | None] = [None] * (rows * cols)
    for i, p in sorted(enumerate(pieces), key=lambda t: -t[1].area):
        k = int(p.centroid[1] * rows // H) * cols + int(p.centroid[0] * cols // W)
        if 0 <= k < len(cells) and cells[k] is None:
            cells[k] = i
    return cells


def _box_of(mask: np.ndarray):
    return im.mask_bbox(mask)


def head_bands(head_box) -> dict:
    """The fixed bands (face_eyes_*, face_mouth_*), as shares of a head box's
    height: the fallback when the face cells don't show where the eyes and the
    mouth are (face_bands)."""
    x0, y0, x1, y1 = head_box
    h = y1 - y0
    return {
        "eyes": (y0 + TOL["face_eyes_top"] * h, y0 + TOL["face_eyes_bottom"] * h),
        "mouth": (y0 + TOL["face_mouth_top"] * h, y0 + TOL["face_mouth_bottom"] * h),
    }


def _core(masks: list[np.ndarray], y0: int, y1: int) -> tuple[int, int] | None:
    """The rows (y0..y1) that more than one of the masks changed, as the run of
    them with the most changed pixels: where a slot's states agree it changes."""
    rows = np.array([m[y0:y1].any(axis=1) for m in masks])
    weight = np.sum([m[y0:y1].sum(axis=1) for m in masks], axis=0)
    agree = rows.sum(axis=0) > 1
    best, run = None, None
    for y in range(len(agree) + 1):
        if y < len(agree) and agree[y]:
            run = y if run is None else run
            continue
        if run is not None:
            w = weight[run:y].sum()
            if best is None or w > best[0]:
                best = (w, run, y)
            run = None
    return None if best is None else (y0 + best[1], y0 + best[2])


def face_bands(changed: dict, face_box, band_box=None) -> tuple[dict, str | None]:
    """(the eyes and mouth bands as (top, bottom) rows, why the fixed ones stand
    in or None), from where the face cells differ once laid on the head.

    `changed` is each state's change mask against its slot's neutral cell. A
    slot's core is the rows its states agree they change (_core): the eyes
    change only the eyes, the mouth row only the mouth. The two slots meet
    halfway between their cores, each reaching face_band_overlap of the gap
    past that; the eyes band runs up to the face's top (raised brows, a crest)
    and the mouth band down to its bottom (an open jaw). With fewer than two
    states to compare in a slot, no core, or cores whose middles don't clear each
    other, the fixed head_bands of `band_box` (the host's own box) stand in."""
    x0, y0, x1, y1 = face_box
    fallback = head_bands(band_box or face_box)
    cores = {}
    for slot in ("eyes", "mouth"):
        masks = [ch for (sl, st), ch in changed.items() if sl == slot and st != REST_STATE[slot]]
        if len(masks) <= 1:
            return fallback, f"{slot}: {len(masks)} state(s) to compare"
        cores[slot] = _core(masks, y0, y1)
        if cores[slot] is None:
            return fallback, f"{slot}: no rows its states agree they change"
    (e0, e1), (m0, m1) = cores["eyes"], cores["mouth"]
    if not ((e0 + e1) / 2 < m0 and (m0 + m1) / 2 > e1):
        return fallback, "the eyes' and the mouth's changes overlap"
    mid = (e1 + m0) / 2
    reach = TOL["face_band_overlap"] * max(m0 - e1, 0)
    return {"eyes": (float(y0), mid + reach), "mouth": (mid - reach, float(y1))}, None


def register_head(cell: np.ndarray, head: np.ndarray, start: rg.Reg | None = None) -> rg.Reg | None:
    """A face-sheet head (cut to its box) onto the rig head (master frame). The
    first head is searched from the boxes' scale; the others start from it."""
    hb = _box_of(head[..., 3] >= SOLID_ALPHA)
    if hb is None:
        return None
    rot = TOL["face_rot_search"]
    if start is not None:
        reg = rg.register(cell, head, rot=rot, start=rg.Reg(start.r, start.theta, start.cx, start.cy, start.ncc))
        if reg is not None and reg.ncc >= TOL["ncc_min"]:
            return reg
    r0 = cell.shape[0] / max(hb[3] - hb[1], 1)
    lo, hi = r0 * (1 - TOL["face_scale_search"]), r0 * (1 + TOL["face_scale_search"])
    cx, cy = (hb[0] + hb[2]) / 2, (hb[1] + hb[3]) / 2
    reach = TOL["face_reach"] * (hb[3] - hb[1])
    return rg.register(cell, head, near=(cx - reach, cy - reach, cx + reach, cy + reach), r_range=(lo, hi), rot=rot)


def changes(variant: np.ndarray, base: np.ndarray) -> np.ndarray:
    """Pixels where a variant differs from the base (both in the master frame)."""
    va, ba = variant[..., 3] >= SOLID_ALPHA, base[..., 3] >= SOLID_ALPHA
    either = va | ba
    out = np.zeros(va.shape, bool)
    ys, xs = np.nonzero(either)
    if len(ys) == 0:
        return out
    # A pixel changed when no base pixel within one step of it matches (so the
    # softening of a resampled outline, or a half-pixel shift, is no change), and
    # the change is more than a line one pixel thin.
    H, W = va.shape
    vl = im.lab(variant[ys, xs, :3].astype(float))
    best = np.full(len(ys), np.inf)
    alpha_same = np.zeros(len(ys), bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            ny, nx = np.clip(ys + dy, 0, H - 1), np.clip(xs + dx, 0, W - 1)
            d = im.de00(vl, im.lab(base[ny, nx, :3].astype(float)))
            same = va[ys, xs] == ba[ny, nx]
            best = np.minimum(best, np.where(same, d, np.inf))
            alpha_same |= same
    out[ys, xs] = (best > TOL["diff_de00"]) | ~alpha_same
    out = im.dilate(im.erode(out, 1), 1)
    out = im.closing(out, TOL["close_px"])
    keep = np.zeros_like(out)
    for cys, cxs in im.components(out):
        if len(cys) >= TOL["speck_area_px"]:
            keep[cys, cxs] = True
    return keep


def ring_match(patch: np.ndarray, base: np.ndarray, box) -> tuple[np.ndarray, float]:
    """patch (master frame) moved in Lab so its border ring inside `box` matches
    the base's there; and the ring's ΔE00 after the move."""
    x0, y0, x1, y1 = box
    ring = np.zeros(patch.shape[:2], bool)
    ring[y0:y1, x0:x1] = True
    ring &= ~im.erode(ring, TOL["ring_px"])
    ring &= (patch[..., 3] >= SOLID_ALPHA) & (base[..., 3] >= SOLID_ALPHA)
    if ring.sum() < 4:
        return patch, 0.0
    pl = im.lab(patch[ring][:, :3].astype(float)).mean(0)
    bl = im.lab(base[ring][:, :3].astype(float)).mean(0)
    w = np.zeros(patch.shape[:2])
    w[y0:y1, x0:x1] = 1
    moved = np.array(heads.shift_lab(im.to_image(patch), w, bl - pl))
    after = im.lab(moved[ring][:, :3].astype(float)).mean(0)
    return moved, float(heads.de2000(after, bl))


def feather(patch: np.ndarray, box) -> np.ndarray:
    """Alpha ramped from 0 at the box edge to full feather_px inside."""
    x0, y0, x1, y1 = box
    f = max(TOL["feather_px"], 1)
    out = patch.copy()
    yy, xx = np.mgrid[y0:y1, x0:x1]
    d = np.minimum.reduce([xx - x0 + 0.5, x1 - xx - 0.5, yy - y0 + 0.5, y1 - yy - 0.5])
    ramp = np.clip(d / f, 0, 1)
    a = out[y0:y1, x0:x1, 3].astype(float) * ramp
    out[y0:y1, x0:x1, 3] = np.clip(a + 0.5, 0, 255).astype(np.uint8)
    out[: y0, :, 3] = 0
    out[y1:, :, 3] = 0
    out[:, :x0, 3] = 0
    out[:, x1:, 3] = 0
    return out


REST_STATE = {"eyes": "open", "mouth": "rest"}


def face_patches(
    cells: list[np.ndarray | None],
    states: tuple,
    head: np.ndarray,
    neutral: dict | None = None,
    *,
    eyes: Eyes | None = None,
    empty_whites: bool = True,
    bands: dict | None = None,
    band_box=None,
) -> dict:
    """{slot: {"box": (x0, y0, x1, y1), "choices": {state: rgba master frame},
    "ring": {...}}, "neutral": {...}, "report": {...}} from the cut face-sheet
    heads in brief order. `head` is the rig head (the face piece, master frame).

    Edit-then-diff: every head is laid on the rig head, then each state is
    compared with its own sheet's neutral head for that slot (eyes.open,
    mouth.rest), both resampled the same way, so only the edit shows. `neutral`
    passes those neutral heads on to a sheet without them (face2). The neutral
    cells themselves are the head's own art: they are measured against the rig
    head (NCC ≥ face_ncc_min), not cut. The wide eyes' drawn pupils are painted
    out (the moving pupils show there) unless `empty_whites` is False: a rig with
    no pupil pieces keeps the eyes its sheet draws.

    The eyes and mouth bands come from the cells themselves (face_bands), or
    from `bands` (face2 takes the face sheet's); out["bands"] passes them on.
    `band_box` is the host's own box, for the fixed bands when the cells can't
    show them."""
    hm = head[..., 3] >= SOLID_ALPHA
    hb = _box_of(hm)
    out: dict = {"report": {"cells": [], "notes": []}, "neutral": dict(neutral or {})}
    if hb is None:
        return out
    area = hm.sum()
    placed: dict = {}
    first = None
    for cell, (slot, state) in zip(cells, states):
        row = {"slot": slot, "state": state}
        out["report"]["cells"].append(row)
        if cell is None:
            row.update(status="fail", notes=["cell empty"])
            continue
        reg = register_head(cell, head, first)
        first = first or reg
        if reg is None:
            row.update(status="fail", notes=["head not found"])
            continue
        row["reg"] = reg.json()
        placed[(slot, state)] = (rg.bake(cell, reg, head.shape), reg, row)
        if state == REST_STATE[slot]:
            out["neutral"][slot] = placed[(slot, state)][0]
    changed = {k: changes(b, out["neutral"].get(k[0], head)) for k, (b, _, _) in placed.items()}
    if bands is None:
        bands, why = face_bands(changed, hb, band_box)
        if why:
            out["report"]["notes"].append(f"face bands from the fixed shares of the head: {why}")
    out["bands"] = bands
    baked: dict = {}
    diffs: dict = {}
    for (slot, state), (b, reg, row) in placed.items():
        ch = changed[(slot, state)]
        top, bottom = bands[slot]
        band = np.zeros_like(ch)
        band[int(top) : int(np.ceil(bottom)), hb[0] : hb[2]] = True
        outside = float((ch & ~band).sum() / max(area, 1))
        row.update(outside=round(outside, 4), changed=int((ch & band).sum()))
        bad = outside > TOL["face_outside_max"]
        row["status"] = "fail" if bad else "pass"
        row["notes"] = [f"changed {outside:.1%} of the head outside the {slot} band"] if bad else []
        if state == REST_STATE[slot] and reg.ncc < TOL["face_ncc_min"]:
            row["status"] = "warn" if row["status"] == "pass" else row["status"]
            row["notes"].append(f"rest cell NCC {reg.ncc:.2f} against the rig head")
        if not bad:
            baked[(slot, state)] = b
            diffs[(slot, state)] = ch & band
    for slot in ("eyes", "mouth"):
        states_here = [s for (sl, s) in baked if sl == slot and s != REST_STATE[slot]]
        if not states_here:
            continue
        union = np.zeros(hm.shape, bool)
        for s in states_here:
            union |= diffs[(slot, s)]
        union = im.dilate(union, TOL["patch_dilate_px"]) & im.dilate(hm, TOL["feather_px"])
        box = _box_of(union)
        if box is None:
            continue
        choices, rings = {}, {}
        for s in states_here:
            p = baked[(slot, s)].copy()
            if slot == "eyes" and s == "wide" and empty_whites:
                p = fill_whites(p, box, eyes, area)
            p, ring = ring_match(p, head, box)
            choices[s] = feather(p, box)
            rings[s] = round(ring, 2)
        out[slot] = {"box": box, "choices": choices, "ring": rings}
    return out


@dataclass(frozen=True)
class Eyes:
    """A character's eye colours in Lab, read from its private block at run time
    (palette.eye_roles), never kept in the repo. `white` is its eye-white swatches
    and `pupil` its pupil and iris swatches, each with every swatch nearer one of
    them than eye_same_de00 (colours no drawing can tell apart); `white_rest` and
    `pupil_rest` are the character's other swatches."""

    white: np.ndarray
    pupil: np.ndarray
    white_rest: np.ndarray
    pupil_rest: np.ndarray

    @staticmethod
    def of(swatches, white_ids, pupil_ids) -> "Eyes | None":
        """From the block's swatches (Lab) and eye_roles' indices; None when the
        block names no eye white (the generic tests stand in)."""
        S = np.asarray(swatches, float).reshape(-1, 3)
        if not list(white_ids):
            return None

        def group(ids):
            if not list(ids):
                return np.zeros((0, 3)), S
            d = np.min([im.de00(S, S[i]) for i in ids], axis=0)
            near = d <= TOL["eye_same_de00"]
            return S[near], S[~near]

        white, white_rest = group(white_ids)
        pupil, pupil_rest = group(pupil_ids)
        return Eyes(white, pupil, white_rest, pupil_rest)


def _nearest(lab: np.ndarray, mine: np.ndarray, rest: np.ndarray) -> np.ndarray:
    """Pixels within eye_de00 of one of `mine` and no nearer any of `rest`."""
    lab = lab.reshape(-1, 3)
    if len(mine) == 0 or len(lab) == 0:
        return np.zeros(len(lab), bool)
    d = np.min([im.de00(lab, c) for c in mine], axis=0)
    ok = d <= TOL["eye_de00"]
    if len(rest) and ok.any():
        idx = np.nonzero(ok)[0]  # only the pixels still in the running meet the rest
        ok[idx] = d[idx] <= np.min([im.de00(lab[idx], c) for c in rest], axis=0)
    return ok


def _light(lab: np.ndarray) -> np.ndarray:
    """The generic eye white, for a character whose block names none: light (L* at
    least white_l_min) and nearly grey (chroma under white_c_max)."""
    return (lab[..., 0] >= TOL["white_l_min"]) & (np.hypot(lab[..., 1], lab[..., 2]) <= TOL["white_c_max"])


def white_px(lab: np.ndarray, eyes: Eyes | None = None) -> np.ndarray:
    """Pixels in an eye-white colour: nearest the character's eye-white swatches
    (within eye_de00, and no nearer any other swatch), or the generic test."""
    if eyes is None:
        return _light(lab)
    return _nearest(lab, eyes.white, eyes.white_rest).reshape(lab.shape[:-1])


def pupil_px(lab: np.ndarray, eyes: Eyes | None = None) -> np.ndarray:
    """Pixels a pupil may be seeded from: dark (L* under dark_l_max), or in one of
    the character's pupil or iris colours (an iris drawn lighter than the dark cut)."""
    dark = lab[..., 0] < TOL["dark_l_max"]
    if eyes is None or len(eyes.pupil) == 0:
        return dark
    return dark | _nearest(lab, eyes.pupil, eyes.pupil_rest).reshape(lab.shape[:-1])


def _filled(m: np.ndarray) -> np.ndarray:
    """m with its holes filled, worked on m's box (a highlight inside an iris)."""
    box = im.mask_bbox(m)
    if box is None:
        return m.copy()
    x0, y0, x1, y1 = box
    out = m.copy()
    out[y0:y1, x0:x1] = heads.fill_holes(np.pad(m[y0:y1, x0:x1], 1))[1:-1, 1:-1]
    return out


def whites(rgba: np.ndarray, eyes: Eyes | None = None, area: float | None = None) -> np.ndarray:
    """The eye whites of a drawing, as a mask: the connected patches in an
    eye-white colour (white_px), each no bigger than eye_white_max of `area` (the
    host piece's drawn area; the drawing's own when not given), so fur, a face or
    a body in a near-white colour is never an eye. Specks of other colour inside a
    white (under speck_area_px) count as white."""
    drawn = rgba[..., 3] >= SOLID_ALPHA
    light = np.zeros(drawn.shape, bool)
    ys, xs = np.nonzero(drawn)
    light[ys, xs] = white_px(im.lab(rgba[ys, xs, :3].astype(float)), eyes)
    cap = TOL["eye_white_max"] * (area if area else drawn.sum())
    out = np.zeros_like(light)
    for cys, cxs in im.components(light):
        if len(cys) <= cap:
            out[cys, cxs] = True
    H, W = out.shape
    for cys, cxs in im.components(~out):
        if len(cys) < TOL["speck_area_px"] and cys.min() > 0 and cxs.min() > 0 and cys.max() < H - 1 and cxs.max() < W - 1:
            out[cys, cxs] = True
    return out


def drawn_pupils(rgba: np.ndarray, box, eyes: Eyes | None = None, area: float | None = None) -> list[np.ndarray]:
    """The pupils drawn into an eye inside `box` (x0, y0, x1, y1): each patch not
    in an eye-white colour that holds a pupil seed (pupil_px), lies inside the box
    and the drawing, and is ringed by the eye whites (whites(), at least
    pupil_ring_light of its ring). So an iris comes with its dark centre, and an
    eye outline, a brow or a whisker on fur or a pale face is never one. Each as a
    mask of the box, its holes (a highlight) filled."""
    x0, y0, x1, y1 = box
    white = whites(rgba, eyes, area)[y0:y1, x0:x1]
    sub = rgba[y0:y1, x0:x1]
    lab = im.lab(sub[..., :3].astype(float))
    drawn = sub[..., 3] >= SOLID_ALPHA
    seed = pupil_px(lab, eyes) & drawn
    other = drawn & ~white_px(lab, eyes)
    h, w = other.shape
    out = []
    for ys, xs in im.components(other):
        if ys.min() == 0 or xs.min() == 0 or ys.max() == h - 1 or xs.max() == w - 1 or not seed[ys, xs].any():
            continue
        m = np.zeros(other.shape, bool)
        m[ys, xs] = True
        if (im.dilate(m, 1) & ~drawn).any():
            continue
        m = _filled(m)
        ring = im.dilate(m, 2) & ~im.dilate(m, 1)
        if ring.sum() and white[ring].mean() >= TOL["pupil_ring_light"]:
            out.append(m)
    return out


def fill_whites(rgba: np.ndarray, box, eyes: Eyes | None = None, area: float | None = None) -> np.ndarray:
    """rgba with every pupil drawn into an eye inside `box` (drawn_pupils, iris and
    highlight included) painted with the eye white around it, so an eye can show
    the moving pupils."""
    x0, y0, x1, y1 = box
    sub = rgba[y0:y1, x0:x1].copy()
    white = whites(rgba, eyes, area)[y0:y1, x0:x1]
    drawn = sub[..., 3] >= SOLID_ALPHA
    for m in drawn_pupils(rgba, box, eyes, area):
        ring = im.dilate(m, 2) & ~im.dilate(m, 1) & white
        fill = np.median(sub[ring][:, :3], axis=0) if ring.any() else (255, 255, 255)
        sub[im.dilate(m, 1) & drawn, :3] = fill
    out = rgba.copy()
    out[y0:y1, x0:x1] = sub
    return out


def pupils_from_master(master: np.ndarray, head: np.ndarray, eyes: Eyes | None = None, area: float | None = None) -> list[dict]:
    """The pupils: whatever the master paints inside the rig head's empty eye
    whites (parts sheet) that is not eye white, in patches that hold a pupil seed
    (pupil_px), so an iris comes whole with its centre and its highlight. Up to
    two, the biggest, viewer's left first (pupil-r then pupil-l), each cut from the
    master solid, with a 1-px soft edge unmixed in Lab against the white around it."""
    hm = head[..., 3] >= SOLID_ALPHA
    if not hm.any():
        return []
    white = whites(head, eyes, area or hm.sum())
    ys, xs = np.nonzero(white & (master[..., 3] >= SOLID_ALPHA))
    ml = im.lab(master[ys, xs, :3].astype(float))
    cand = np.zeros(hm.shape, bool)
    seed = np.zeros(hm.shape, bool)
    cand[ys, xs] = ~white_px(ml, eyes)
    seed[ys, xs] = pupil_px(ml, eyes) & cand[ys, xs]
    blobs = [c for c in im.components(cand) if len(c[0]) >= TOL["speck_area_px"] and seed[c].any()][:2]
    out = []
    for bys, bxs in sorted(blobs, key=lambda c: c[1].mean()):
        m = np.zeros(hm.shape, bool)
        m[bys, bxs] = True
        m = _filled(m)
        edge = im.dilate(m, 1) & ~m
        ey, ex = np.nonzero(edge)
        ref = np.median(im.lab(head[ey, ex, :3].astype(float)), axis=0)  # the eye white around it
        rim = m & im.dilate(edge, 1)
        ry, rx = np.nonzero(rim)
        own = np.median(im.lab(master[ry, rx, :3].astype(float)), axis=0)  # the pupil at its edge
        span = own - ref
        px = im.lab(master[ey, ex, :3].astype(float))
        alpha = np.clip(((px - ref) @ span) / max(float(span @ span), 1e-6), 0, 1)
        sprite = np.zeros_like(master)
        my, mx = np.nonzero(m)
        sprite[my, mx, :3] = master[my, mx, :3]
        sprite[my, mx, 3] = 255
        sprite[ey, ex, :3] = master[ey, ex, :3]
        sprite[ey, ex, 3] = np.clip(alpha * 255 + 0.5, 0, 255).astype(np.uint8)
        box = im.bbox(*np.nonzero(m | edge))
        out.append({"sprite": sprite, "box": box, "diameter": max(box[2] - box[0], box[3] - box[1]), "mask": m})
    return out


def pupil_travel(pupil_mask: np.ndarray, white: np.ndarray) -> tuple[int, int]:
    """How far (px) a pupil can move each way along x and along y and stay
    inside its white (the white plus the pupil's own place)."""
    room = white | pupil_mask
    ys, xs = np.nonzero(pupil_mask)

    def reach(dx, dy):
        k = 0
        H, W = room.shape
        while k < TOL["pupil_travel_max_px"]:
            ny, nx = ys + dy * (k + 1), xs + dx * (k + 1)
            if (ny < 0).any() or (nx < 0).any() or (ny >= H).any() or (nx >= W).any() or not room[ny, nx].all():
                break
            k += 1
        return k

    return min(reach(1, 0), reach(-1, 0)), min(reach(0, 1), reach(0, -1))


# ---------- arms ----------


def shoulder_ball(rest: np.ndarray, pivot_xy, r: float) -> tuple[np.ndarray, tuple[float, float]]:
    """(the rest arm's pixels within ball_template_reach r of its pivot, cut to a box; the
    pivot inside that box). `rest` is the piece in its own sheet frame."""
    R = TOL["ball_template_reach"] * r
    px, py = pivot_xy
    H, W = rest.shape[:2]
    x0, y0 = int(max(0, np.floor(px - R))), int(max(0, np.floor(py - R)))
    x1, y1 = int(min(W, np.ceil(px + R))), int(min(H, np.ceil(py + R)))
    sub = rest[y0:y1, x0:x1].copy()
    yy, xx = np.mgrid[y0:y1, x0:x1]
    sub[np.hypot(xx + 0.5 - px, yy + 0.5 - py) > R] = 0
    return sub, (px - x0, py - y0)


def find_ball(pose: np.ndarray, ball: np.ndarray, ball_pivot) -> dict | None:
    """Where the shoulder ball sits in a pose drawing: the ball template matched
    over a full turn in arm_rot_step steps and scale 1 ± arm_scale_search."""
    tgt = rg.Target(pose)
    best = None
    k = TOL["arm_scale_search"]
    for s in (1 - k, 1.0, 1 + k):
        for th in np.arange(0, 360, TOL["arm_rot_step"]):
            t = rg.template(ball, s, th)
            mask = rg.template_mask(t)
            sc = rg.masked_ncc(tgt, t, mask)
            if sc.size == 0:
                continue
            v, x, y = rg._peak(sc)
            if best is None or v > best[0]:
                th_, tw_ = t.shape[:2]
                # The ball's pivot, posed: from the ball's centre, scaled and turned.
                bh, bw = ball.shape[:2]
                dx, dy = ball_pivot[0] - bw / 2, ball_pivot[1] - bh / 2
                c, sn = np.cos(np.radians(th)), np.sin(np.radians(th))
                pxp = x + tw_ / 2 + s * (c * dx + sn * dy)
                pyp = y + th_ / 2 + s * (-sn * dx + c * dy)
                best = (v, s, th, pxp, pyp)
    if best is None:
        return None
    v, s, th, px, py = best
    return {"ncc": float(v), "scale": float(s), "turn": float(th), "x": float(px), "y": float(py)}


def fit_ball(pose: np.ndarray, at, r: float) -> tuple | None:
    """A Kasa circle on the pose's outline between ball_fit_inner r and
    ball_fit_outer r of a found ball centre."""
    m = pose[..., 3] >= SOLID_ALPHA
    edge = m & ~im.erode(m, 1)
    ys, xs = np.nonzero(edge)
    d = np.hypot(xs + 0.5 - at[0], ys + 0.5 - at[1])
    near = (d > TOL["ball_fit_inner"] * r) & (d < TOL["ball_fit_outer"] * r)
    if near.sum() < TOL["fit_points_min"]:
        return None
    return rg.kasa(xs[near] + 0.5, ys[near] + 0.5)


def arm_length(mask: np.ndarray, at) -> float:
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        return 0.0
    return float(np.hypot(xs + 0.5 - at[0], ys + 0.5 - at[1]).max())
