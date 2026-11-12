"""The swaps: face patches cut from the face sheet, arm poses pinned at the shoulder,
and the pupils cut from the master.

    grid_order(pieces, rows, cols)       the cells of a face or arms sheet in reading order
    face_patches(cells, states, head)    edit-then-diff patches for the eyes and mouth slots
    pupils_from_master(master, head)     the pupils the master shows where the rig head's
                                         eyes are empty whites
    fill_whites(rgba, box)               a face patch's pupils painted out with the white
    shoulder_ball(rest, pivot, r)        the rest arm's shoulder end, as a template
    pin_arm(pose, ball, rest, ...)       find the ball in a pose and pin it on the pivot

Face patches (C10): every head is registered onto the rig head (scale within
±face_scale_search, turn within ±face_rot_search, after a first scale from the
boxes). What changed (ΔE00 over diff_de00, or alpha) inside a slot's band of head
height is that slot's patch, the union over its states, grown by patch_dilate_px
and cut to the head. Each state's crop is moved in Lab so its ring_px border ring
matches the rig head's, and feathered over feather_px. A state that changed more
than face_outside_max of the head outside its band is refused.
"""

from __future__ import annotations

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
    x0, y0, x1, y1 = head_box
    h = y1 - y0
    return {
        "eyes": (y0 + TOL["face_eyes_top"] * h, y0 + TOL["face_eyes_bottom"] * h),
        "mouth": (y0 + TOL["face_mouth_top"] * h, y0 + TOL["face_mouth_bottom"] * h),
    }


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


def face_patches(cells: list[np.ndarray | None], states: tuple, head: np.ndarray, neutral: dict | None = None) -> dict:
    """{slot: {"box": (x0, y0, x1, y1), "choices": {state: rgba master frame},
    "ring": {...}}, "neutral": {...}, "report": {...}} from the cut face-sheet
    heads in brief order. `head` is the rig head (the face piece, master frame).

    Edit-then-diff: every head is laid on the rig head, then each state is
    compared with its own sheet's neutral head for that slot (eyes.open,
    mouth.rest), both resampled the same way, so only the edit shows. `neutral`
    passes those neutral heads on to a sheet without them (face2). The neutral
    cells themselves are the head's own art: they are measured against the rig
    head (NCC ≥ face_ncc_min), not cut."""
    hm = head[..., 3] >= SOLID_ALPHA
    hb = _box_of(hm)
    out: dict = {"report": {"cells": []}, "neutral": dict(neutral or {})}
    if hb is None:
        return out
    bands = head_bands(hb)
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
    baked: dict = {}
    diffs: dict = {}
    for (slot, state), (b, reg, row) in placed.items():
        base = out["neutral"].get(slot, head)
        ch = changes(b, base)
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
            if slot == "eyes" and s == "wide":
                p = fill_whites(p, box)
            p, ring = ring_match(p, head, box)
            choices[s] = feather(p, box)
            rings[s] = round(ring, 2)
        out[slot] = {"box": box, "choices": choices, "ring": rings}
    return out


def _light(lab: np.ndarray) -> np.ndarray:
    """An eye's white: light (L* at least white_l_min) and nearly grey
    (chroma under white_c_max), so a pale yellow body is not one."""
    return (lab[..., 0] >= TOL["white_l_min"]) & (np.hypot(lab[..., 1], lab[..., 2]) <= TOL["white_c_max"])


def whites(rgba: np.ndarray) -> np.ndarray:
    """The eye whites of a drawing (see _light), as a mask."""
    out = np.zeros(rgba.shape[:2], bool)
    ys, xs = np.nonzero(rgba[..., 3] >= SOLID_ALPHA)
    out[ys, xs] = _light(im.lab(rgba[ys, xs, :3].astype(float)))
    return out


def drawn_pupils(rgba: np.ndarray, box) -> list[np.ndarray]:
    """The dark blobs enclosed by white inside `box` (x0, y0, x1, y1): pupils drawn
    into an eye. Each as a mask of the box, with its 1-px ring's light pixels."""
    x0, y0, x1, y1 = box
    sub = rgba[y0:y1, x0:x1]
    lab = im.lab(sub[..., :3].astype(float))
    drawn = sub[..., 3] >= SOLID_ALPHA
    dark = (lab[..., 0] < TOL["dark_l_max"]) & drawn
    light = _light(lab) & drawn
    out = []
    for ys, xs in im.components(dark):
        m = np.zeros(dark.shape, bool)
        m[ys, xs] = True
        ring = im.dilate(m, 2) & ~im.dilate(m, 1)
        if ring.sum() and light[ring].mean() >= TOL["pupil_ring_light"]:
            out.append(m)
    return out


def fill_whites(rgba: np.ndarray, box) -> np.ndarray:
    """rgba with every dark blob enclosed by white inside `box` (a drawn pupil)
    painted with the white around it, so an eye can show the moving pupils."""
    x0, y0, x1, y1 = box
    sub = rgba[y0:y1, x0:x1].copy()
    lab = im.lab(sub[..., :3].astype(float))
    drawn = sub[..., 3] >= SOLID_ALPHA
    light = _light(lab) & drawn
    for m in drawn_pupils(rgba, box):
        ring = im.dilate(m, 2) & ~im.dilate(m, 1)
        fill = np.median(sub[ring & light][:, :3], axis=0) if (ring & light).any() else (255, 255, 255)
        sub[im.dilate(m, 1) & drawn, :3] = fill
    out = rgba.copy()
    out[y0:y1, x0:x1] = sub
    return out


def pupils_from_master(master: np.ndarray, head: np.ndarray) -> list[dict]:
    """The pupils: where the rig head (parts sheet, empty whites) is light and the
    master is dark. Up to two blobs, viewer's left first (pupil-r then pupil-l),
    each cut from the master with its soft edge unmixed against the white."""
    hm = head[..., 3] >= SOLID_ALPHA
    if not hm.any():
        return []
    ys, xs = np.nonzero(hm)
    hl = im.lab(head[ys, xs, :3].astype(float))
    ml = im.lab(master[ys, xs, :3].astype(float))
    cand = np.zeros(hm.shape, bool)
    cand[ys, xs] = _light(hl) & (ml[:, 0] < TOL["dark_l_max"]) & (master[ys, xs, 3] >= SOLID_ALPHA)
    blobs = [c for c in im.components(cand) if len(c[0]) >= TOL["speck_area_px"]][:2]
    out = []
    for bys, bxs in sorted(blobs, key=lambda c: c[1].mean()):
        m = np.zeros(hm.shape, bool)
        m[bys, bxs] = True
        grow = im.dilate(m, 1)
        gy, gx = np.nonzero(grow)
        L = im.lab(master[gy, gx, :3].astype(float))[:, 0]
        white = float(np.median(im.lab(head[gy, gx, :3].astype(float))[:, 0]))
        core = float(np.percentile(L, 10))
        alpha = np.clip((white - L) / max(white - core, 1e-6), 0, 1)
        sprite = np.zeros_like(master)
        sprite[gy, gx, :3] = master[gy, gx, :3]
        sprite[gy, gx, 3] = np.clip(alpha * 255 + 0.5, 0, 255).astype(np.uint8)
        sprite[bys, bxs, 3] = 255
        box = im.bbox(gy, gx)
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
