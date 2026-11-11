"""Assembling a candidate rig from the accepted images, and the rig manifest.

    candidate(cid, sources)    key-out (each sheet then locked to the master's
                               colours) → slice → assign → register → z and pivots
                               → pupils → face patches → arm swaps → compose →
                               checks C1-C11, into review/<batch>/<id>/ only
    compose(parts, order)      the rest pose painted in draw order (local z)
    manifest(...)              the RigManifest of the design (E.1), sprites in %
    rig_sha(candidate)         what an owner's rig approval is bound to
    ts_file(rigs) / read_ts    src/lib/cast/rigs.generated.ts, written and read back

The palette lock moves colour only, never a pixel's place, so it runs right
after each sheet's key-out and every later step sees the locked colours. The
candidate keeps its 2x atlas lossless (atlas@2x.png) and its manifest in
candidate.json; `build` encodes exactly those, so what the owner approved on the
review page is what ships. The manifest's `signature` stays empty: the clips
(src/lib/cast/clips.ts) are the runtime PR's.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

from . import atlas, checks, ledger, palette, parts, swaps
from . import imaging as im
from . import register as rg
from .spec import (
    BUDGETS,
    BUILDER_VERSION,
    FACE2_STATES,
    FACE_STATES,
    TOL,
    arm_poses,
    batch_of,
    character,
    cell_count,
    is_complex,
    range_for,
)

# What a face piece keeps with its head or body (the brief: ears, a flap, the tie).
FACE_EXTRAS = ("ear-", "flap", "tie", "cord", "collar", "quills")
SOCKETS = {"torso": "body", "head": "head", "tail": "tail", "tie": "tie", "cord": "cord", "neck": "neck"}


def socket_of(pid: str) -> str | None:
    if pid in SOCKETS:
        return SOCKETS[pid]
    for k in ("arm-r", "arm-l", "leg-r", "leg-l", "ear-r", "ear-l"):
        if pid == k:
            return k
    if pid.startswith(("limb-", "tentacle-")):
        return "limb-" + pid.split("-")[-1] if pid.split("-")[-1].isdigit() else None
    for k in ("fan", "flap", "quills", "load", "collar"):
        if pid.startswith(k):
            return k
    return None


def side_window(pid: str, box) -> tuple | None:
    """Where on the master a sided piece may land: the character's own right is on
    the viewer's left (the brief never mirrors)."""
    x0, y0, x1, y1 = box
    mid, pad = (x0 + x1) / 2, TOL["margin_ask_px"]
    if pid.endswith("-r"):
        return (x0 - pad, y0 - pad, mid, y1 + pad)
    if pid.endswith("-l"):
        return (mid, y0 - pad, x1 + pad, y1 + pad)
    return None


def parent_of(pid: str, ids: list[str]) -> str | None:
    if pid == "torso":
        return None
    if pid == "head":
        return "neck" if "neck" in ids else "torso"
    if pid.startswith(("pupil-", "ear-")):
        return "head" if "head" in ids else "torso"
    return "torso"


# ---------- loading the sheets ----------


def load_sheet(path: Path, c: dict, image: str) -> dict:
    rgba, info = im.load_rgba(path)
    r1 = checks.c1_file(path, c, image, info)
    r2, cutout = checks.c2_background(rgba, c)
    pieces, specks = parts.islands(cutout)
    cleaned = parts.drop(cutout, specks)
    r3 = checks.c3_margins(cleaned)
    want = cell_count(c, image)
    r4 = {
        "status": "pass" if len(pieces) == want else "fail",
        "count": len(pieces),
        "expected": want,
        "specks": [s.json() for s in specks],
        "notes": [] if len(pieces) == want else [f"{len(pieces)} drawings, expected {want}"],
    }
    return {
        "path": path,
        "sha256": im.sha256_file(path),
        "cut": cleaned,
        "pieces": pieces,
        "checks": {"C1": r1, "C2": r2, "C3": r3, "C4": r4},
    }


def lock_to(sheet: np.ndarray, targets: np.ndarray) -> tuple[np.ndarray, list[dict]]:
    if targets is None or len(targets) == 0:
        return sheet, []
    return palette.lock(sheet, targets)


# ---------- composing ----------


def draw_order(tree: dict, z: dict, root: str) -> list[str]:
    """Part ids back to front: for each part, its children with z < 0 (most
    negative first), its own art, then its children with z > 0."""
    out = []

    def walk(p):
        kids = sorted(tree.get(p, []), key=lambda k: z[k])
        for k in kids:
            if z[k] < 0:
                walk(k)
        out.append(p)
        for k in kids:
            if z[k] > 0:
                walk(k)

    walk(root)
    return out


def compose(baked: dict, order: list[str]) -> np.ndarray:
    """The baked parts (master frame RGBA) painted back to front."""
    first = next(iter(baked.values()))
    canvas = Image.new("RGBA", (first.shape[1], first.shape[0]), (0, 0, 0, 0))
    for pid in order:
        if pid in baked:
            canvas.alpha_composite(Image.fromarray(baked[pid], "RGBA"))
    return np.array(canvas)


def iou(a: np.ndarray, b: np.ndarray) -> float:
    u = (a | b).sum()
    return float((a & b).sum() / u) if u else 1.0


def rotate_about(mask: np.ndarray, x: float, y: float, deg: float) -> np.ndarray:
    img = Image.fromarray(mask.astype(np.uint8) * 255)
    out = img.rotate(deg, resample=Image.BILINEAR, center=(x, y))
    return np.array(out) > 127


# ---------- the candidate ----------


def candidate(cid: str, sources: Path, review_root: Path | None = None, out=print) -> dict:
    c = character(cid)
    sources = Path(sources)
    batch = batch_of(cid)
    folder = (Path(review_root) if review_root else sources / "review") / batch / cid
    folder.mkdir(parents=True, exist_ok=True)
    files = {img: ledger.accepted_file(sources, cid, img) for img in c["images"]}
    missing = [img for img, p in files.items() if p is None]
    report: dict = {"id": cid, "images": {}, "missing": missing, "checks": {}, "notes": []}
    if files["master"] is None:
        raise SystemExit(f"{cid}: no accepted master; take one in first")
    try:
        colours = palette.block_colours(sources, cid)
    except FileNotFoundError:
        colours = None

    # Master: cut, C1–C4, C9 against the private swatches, then locked to them.
    mrep, mextra = checks.check_master(files["master"], c, colours)
    report["images"]["master"] = mrep
    master = mextra["cutout"]
    if colours:
        master, mlock = lock_to(master, np.array([im.hex_lab(h) for _, h in colours]))
        report["checks"]["C9-lock-master"] = mlock
    lab, total = palette._pixels(master)
    seeds = np.array([im.hex_lab(h) for _, h in colours]) if colours else lab[:: max(1, len(lab) // 8)][:8]
    C, share = palette.clusters(lab, seeds)
    targets = C[share >= TOL["speck_px"] ** 2 / max(total, 1)]
    mfig = mextra["figure"]
    if mfig is None:
        raise SystemExit(f"{cid}: the master has no figure")
    shape = master.shape

    # Parts: slice, lock to the master, name, register.
    sheets = {}
    locks: dict = {}
    for img in ("parts", "parts2"):
        if img in c["images"] and files.get(img):
            s = load_sheet(files[img], c, img)
            s["cut"], locks[img] = lock_to(s["cut"], targets)
            sheets[img] = s
            report["images"][img] = {"sha256": s["sha256"], "checks": s["checks"], "file": files[img].name}
    ids_all = [*c["parts"], *(c.get("parts2") or [])]
    named: dict = {}
    regs: dict = {}
    baked: dict = {}
    crops: dict = {}
    gaps = {}
    for img, s in sheets.items():
        ids = list(c[img])
        reg_ids = [i for i in ids if not i.startswith("pupil-")]
        got, spare, cost = parts.assign(s["pieces"], ids, img)
        r, close = parts.min_gap(s["pieces"], s["cut"].shape)
        gaps[img] = {"touching": close, "spare": spare, "cost": round(cost, 3)}
        tgt = rg.Target(rg.shrink(master, rg.COARSE))
        for pid in reg_ids:
            if pid not in got:
                continue
            p = s["pieces"][got[pid]]
            crop, _ = p.crop(s["cut"])
            reg = rg.register(crop, master, near=side_window(pid, mfig.box), coarse_target=tgt)
            if reg is None:
                continue
            named[pid] = (img, got[pid])
            crops[pid] = crop
            regs[pid] = reg
            baked[pid] = rg.bake(crop, reg, shape)
        for pid in ids:
            if pid.startswith("pupil-") and pid in got:
                named[pid] = (img, got[pid])
    # The character's own right lands on the viewer's left of the master.
    mid = (mfig.box[0] + mfig.box[2]) / 2
    for a, b in (("arm-r", "arm-l"), ("leg-r", "leg-l"), ("ear-r", "ear-l")):
        if a in regs and b in regs and regs[a].cx > mid > regs[b].cx:
            for d in (named, regs, baked, crops):
                d[a], d[b] = d[b], d[a]
            report["notes"].append(f"{a} and {b} swapped: each landed on the other's side")

    # C5 separation, C6 registration.
    c5 = {"status": "pass", "notes": []}
    for img, g in gaps.items():
        if g["touching"]:
            c5["status"] = "fail"
            c5["notes"].append(f"{img}: {len(g['touching'])} pair(s) closer than {TOL['gap_fail_px']} px")
        if g["spare"]:
            c5["notes"].append(f"{img}: {len(g['spare'])} spare piece(s)")
    for img, s in sheets.items():
        if s["checks"]["C4"]["count"] < s["checks"]["C4"]["expected"]:
            biggest = max(p.area for p in s["pieces"]) if s["pieces"] else 0
            for pid, (im_, i) in named.items():
                shp = parts.shape_of(pid)
                if im_ == img and shp and s["pieces"][i].area / max(biggest, 1) > TOL["fused_area_max"] * shp[0]:
                    c5["status"] = "fail"
                    c5["notes"].append(f"{pid} looks fused (too big for one piece)")
    report["checks"]["C5"] = c5
    c6 = {"parts": {}, "status": "pass", "notes": []}
    for pid, reg in regs.items():
        st = "pass"
        if reg.ncc < TOL["ncc_min"]:
            st = "fail"
        elif reg.ncc < TOL["ncc_warn"]:
            st = "warn"
        if not (TOL["scale_min"] <= reg.r <= TOL["scale_max"]) or abs(reg.theta) > TOL["tilt_deg"]:
            st = checks.worst(st, "warn")
        c6["parts"][pid] = {**reg.json(), "status": st}
        c6["status"] = checks.worst(c6["status"], st)
    lost = [i for i in ids_all if i not in named and not i.startswith("pupil-")]
    if lost:
        c6["status"] = "fail"
        c6["notes"].append("not placed: " + ", ".join(lost))

    # Tree, z from the master's evidence, pivots.
    present = [i for i in ids_all if i in baked]
    tree: dict = {}
    for pid in present:
        par = parent_of(pid, present)
        if par is not None:
            tree.setdefault(par, []).append(pid)
    z: dict = {"torso": 0}
    pivots: dict = {}
    c7 = {"joints": {}, "status": "pass", "notes": []}
    for par, kids in tree.items():
        over, under = [], []
        for k in kids:
            a, b = baked[k][..., 3] > 127, baked[par][..., 3] > 127
            ov = a & b
            tucked = False  # the child under its parent, as the master shows where they overlap
            if ov.sum() >= 4:
                ys, xs = np.nonzero(ov)
                ml = im.lab(master[ys, xs, :3].astype(float))
                dk = im.de00(im.lab(baked[k][ys, xs, :3].astype(float)), ml).mean()
                dp = im.de00(im.lab(baked[par][ys, xs, :3].astype(float)), ml).mean()
                tucked = dk > dp
            (under if tucked else over).append(k)
            # The cap is on the piece that tucks under: the child's own, or the parent's
            # (a neck under the head).
            pivots[k] = rg.pivot(a, b) if tucked else rg.pivot(b, a)
            pivots[k]["tucked"] = tucked
        for n, k in enumerate(sorted(over, key=lambda k: -(baked[k][..., 3] > 127).sum())):
            z[k] = n + 1
        for n, k in enumerate(sorted(under, key=lambda k: (baked[k][..., 3] > 127).sum())):
            z[k] = -(n + 1)
    for k, pv in pivots.items():
        par = parent_of(k, present)
        rng = range_for(k)
        j = {"kind": pv["kind"], "range": rng}
        st = "pass"
        if pv["kind"] == "cap":
            j["residual"] = round(pv["residual"], 4)
            if pv["residual"] > TOL["cap_residual"]:
                st = "fail"
            disc = np.zeros(shape[:2], bool)
            yy, xx = np.ogrid[: shape[0], : shape[1]]
            disc = np.hypot(xx + 0.5 - pv["x"], yy + 0.5 - pv["y"]) <= pv["r"]
            child = baked[k][..., 3] > 127
            parent = baked[par][..., 3] > 127
            low, high = (child, parent) if pv["tucked"] else (parent, child)
            # The cap: the under piece's round end, past the joint toward the piece on top.
            ly, lx = np.nonzero(low)
            ux, uy = pv["x"] - (lx.mean() + 0.5), pv["y"] - (ly.mean() + 0.5)
            beyond = (xx + 0.5 - pv["x"]) * ux + (yy + 0.5 - pv["y"]) * uy > 0
            cap = low & disc & beyond
            if cap.any():
                cover = float((cap & high).sum() / cap.sum())
                j["cap_cover"] = round(cover, 4)
                if cover < TOL["cap_cover"]:
                    st = checks.worst(st, "fail")
            if rng:
                worst_cover = 1.0
                for deg in (-rng, rng):
                    turned = rotate_about(child, pv["x"], pv["y"], deg)
                    kept = disc & (child | parent)
                    covered = (disc & (turned | parent) & kept).sum() / max(kept.sum(), 1)
                    worst_cover = min(worst_cover, float(covered))
                j["joint_cover"] = round(worst_cover, 4)
                if worst_cover < TOL["joint_cover"]:
                    st = checks.worst(st, "fail")
        elif rng and pv["kind"] in ("no_cap", "none"):
            st = "fail"
            c7["notes"].append(f"{k} has no cap to turn on")
        elif rng:
            st = "warn"
        j["status"] = st
        c7["joints"][k] = j
        c7["status"] = checks.worst(c7["status"], st)
    report["checks"]["C7"] = c7

    # Root pivot: bottom centre on the floor.
    rest = compose(baked, draw_order(tree, z, "torso")) if "torso" in baked else master.copy()
    rest_a = rest[..., 3] > TOL["margin_alpha"]
    master_a = master[..., 3] > TOL["margin_alpha"]
    v = iou(rest_a, master_a)
    need = TOL["iou_rest_complex"] if is_complex(cid) else TOL["iou_rest"]
    c6["iou_rest"] = round(v, 4)
    if v < need:
        c6["status"] = "fail"
        c6["notes"].append(f"rest pose IoU {v:.3f} against the master, needs {need}")
    report["checks"]["C6"] = c6

    # C8 hidden fill: the torso solid between the shoulder and hip lines; a neck stub.
    c8 = {"status": "skip", "notes": []}
    if "torso" in baked:
        t = baked["torso"][..., 3] > 127
        sh = [pivots[k]["y"] for k in ("arm-r", "arm-l") if k in pivots and pivots[k]["y"] is not None]
        hp = [pivots[k]["y"] for k in ("leg-r", "leg-l") if k in pivots and pivots[k]["y"] is not None]
        if sh and hp and max(hp) > min(sh):
            rows = t[int(min(sh)) : int(max(hp))]
            filled, hull = 0, 0
            for row in rows:
                xs = np.nonzero(row)[0]
                if len(xs):
                    hull += xs.max() - xs.min() + 1
                    filled += len(xs)
            fill = filled / max(hull, 1)
            c8["torso_fill"] = round(fill, 4)
            c8["status"] = "pass" if fill >= TOL["torso_fill_min"] else "fail"
        if "head" in pivots and pivots["head"]["y"] is not None and "head" in baked:
            hb = im.mask_bbox(baked["head"][..., 3] > 127)
            hx, hy = pivots["head"]["x"], pivots["head"]["y"]
            col = t[:, int(np.clip(hx, 0, shape[1] - 1))]
            top = np.nonzero(col)[0]
            stub = (hy - top.min()) / max(hb[3] - hb[1], 1) if len(top) else 0
            c8["neck_stub"] = round(float(stub), 4)
            if stub < TOL["neck_stub_min"]:
                c8["status"] = "fail"
                c8["notes"].append("no neck stub under the head")
            elif c8["status"] == "skip":
                c8["status"] = "pass"
    report["checks"]["C8"] = c8

    # Pupils cut from the master, then face patches against the face piece: the
    # host (head, or the body of a character whose face is on it) with the extras
    # the brief keeps on it, and the pupils.
    host = "head" if "head" in baked else "torso"
    c10 = {"status": "skip", "notes": []}
    pupils = []
    if host in baked and any(i.startswith("pupil-") for i in ids_all):
        pupils = swaps.pupils_from_master(master, baked[host])
        if len(pupils) != 2:
            c10["status"] = "fail"
            c10["notes"].append(f"found {len(pupils)} pupil(s) in the master, expected 2")
        for p in pupils:
            if p["diameter"] < TOL["pupil_min_px"]:
                c10["status"] = "fail"
                c10["notes"].append(f"a pupil is {p['diameter']} px, under {TOL['pupil_min_px']}")
    face_out: dict = {}
    neutral: dict = {}
    if host in baked:
        keep = [host] + [k for k in tree.get(host, []) if k.startswith(FACE_EXTRAS)]
        piece = {k: baked[k] for k in keep}
        for n, p in enumerate(pupils):
            piece[f"pupil-{n}"] = p["sprite"]
        face_base = compose(piece, [*draw_order({host: [k for k in keep if k != host]}, z, host), *[k for k in piece if k.startswith("pupil-")]])
    for img, states, rows in (("face", FACE_STATES, 2), ("face2", FACE2_STATES, 1)):
        if img not in c["images"] or not files.get(img) or host not in baked:
            continue
        s = load_sheet(files[img], c, img)
        s["cut"], locks[img] = lock_to(s["cut"], targets)
        report["images"][img] = {"sha256": s["sha256"], "checks": s["checks"], "file": files[img].name}
        cols = len(states) // rows
        order = swaps.grid_order(s["pieces"], rows, cols, s["cut"].shape)
        cells = [s["pieces"][i].crop(s["cut"])[0] if i is not None else None for i in order]
        got = swaps.face_patches(cells, states, face_base, neutral)
        neutral = got["neutral"]  # face2 has no neutral heads of its own
        for slot in ("eyes", "mouth"):
            if slot in got:
                face_out.setdefault(slot, {"box": got[slot]["box"], "choices": {}, "ring": {}})
                face_out[slot]["choices"].update(got[slot]["choices"])
                face_out[slot]["ring"].update(got[slot]["ring"])
        for row in got["report"]["cells"]:
            c10["status"] = checks.worst(c10["status"], row["status"])
        c10.setdefault("cells", []).extend(got["report"]["cells"])
    for slot, f in face_out.items():
        for st, ring in f["ring"].items():
            if ring > TOL["ring_de00_fail"]:
                c10["status"] = "fail"
                c10["notes"].append(f"{slot}.{st} ring dE00 {ring}")
            elif ring > TOL["ring_de00_max"]:
                c10["status"] = checks.worst(c10["status"], "warn")
    report["checks"]["C10"] = c10

    # Arm swaps pinned at the shoulder ball.
    arm_out: dict = {}
    c11 = {"status": "skip", "poses": [], "notes": []}
    if "arms" in c["images"] and files.get("arms"):
        s = load_sheet(files["arms"], c, "arms")
        s["cut"], locks["arms"] = lock_to(s["cut"], targets)
        report["images"]["arms"] = {"sha256": s["sha256"], "checks": s["checks"], "file": files["arms"].name}
        poses = arm_poses(c)
        rows = 2 if len(poses) == 8 else 1
        order = swaps.grid_order(s["pieces"], rows, len(poses) // rows, s["cut"].shape)
        for (slot, pose), i in zip(poses, order):
            row = {"slot": slot, "pose": pose}
            if i is None or slot not in regs or slot not in pivots or pivots[slot]["x"] is None:
                row.update(status="fail", notes=["no drawing or no rest arm to pin to"])
                c11["poses"].append(row)
                c11["status"] = "fail"
                continue
            reg = regs[slot]
            pv = pivots[slot]
            # The pivot in the rest arm's own sheet frame.
            ch, cw = crops[slot].shape[:2]
            dx, dy = pv["x"] - reg.cx, pv["y"] - reg.cy
            cth, sth = np.cos(np.radians(-reg.theta)), np.sin(np.radians(-reg.theta))
            # master = centre + m·Rf(-theta)·(p - c_p) → p = c_p + r·Rf(-theta)^T·(master - centre)
            px = cw / 2 + reg.r * (cth * dx - sth * dy)
            py = ch / 2 + reg.r * (sth * dx + cth * dy)
            rr = (pv["r"] or 0.25 * min(cw, ch) / reg.r) * reg.r
            ball, bp = swaps.shoulder_ball(crops[slot], (px, py), rr)
            pose_crop, _ = s["pieces"][i].crop(s["cut"], pad=8)
            found = swaps.find_ball(pose_crop, ball, bp)
            if found is None:
                row.update(status="fail", notes=["shoulder ball not found"])
                c11["poses"].append(row)
                c11["status"] = "fail"
                continue
            fit = swaps.fit_ball(pose_crop, (found["x"], found["y"]), rr * found["scale"])
            st, notes = "pass", []
            at = (found["x"], found["y"])
            if fit:
                fx, fy, fr, resid = fit
                row["residual"] = round(resid, 4)
                d_rel = fr / max(rr * found["scale"], 1e-6) - 1
                row["diameter"] = round(d_rel, 4)
                if resid <= TOL["cap_residual"] and abs(d_rel) <= TOL["ball_diameter_tol"]:
                    at = (fx, fy)
                else:
                    st = "warn"
                    notes.append("ball circle off; pinned at the matched centre")
            m = 1 / (found["scale"] * reg.r)
            phh, pww = pose_crop.shape[:2]
            centre = (pv["x"] + m * (pww / 2 - at[0]), pv["y"] + m * (phh / 2 - at[1]))
            placed = rg.warp(pose_crop, m, 0.0, (shape[1], shape[0]), centre)
            pm = placed[..., 3] > 127
            rest_len = swaps.arm_length(baked[slot][..., 3] > 127, (pv["x"], pv["y"]))
            pose_len = swaps.arm_length(pm, (pv["x"], pv["y"]))
            row["length"] = round(pose_len / max(rest_len, 1e-6), 4)
            if pose in ("up", "point") and abs(row["length"] - 1) > TOL["arm_length_tol"]:
                st = "fail"
                notes.append(f"straight arm {row['length']:.0%} of the rest arm's length")
            yy, xx = np.ogrid[: shape[0], : shape[1]]
            ring = np.hypot(xx + 0.5 - pv["x"], yy + 0.5 - pv["y"]) <= (pv["r"] or rr / reg.r)
            a_ = ring & pm
            b_ = ring & (baked[slot][..., 3] > 127)
            if a_.any() and b_.any():
                sl = im.lab(np.median(placed[a_][:, :3], 0).astype(float))
                rl = im.lab(np.median(baked[slot][b_][:, :3], 0).astype(float))
                row["sleeve_de00"] = round(float(im.de00(sl, rl)), 2)
                if row["sleeve_de00"] > TOL["sleeve_de00_max"]:
                    st = checks.worst(st, "warn")
                    notes.append("sleeve colour off at the shoulder")
            row.update(status=st, notes=notes, ncc=round(found["ncc"], 3))
            c11["poses"].append(row)
            c11["status"] = checks.worst(c11["status"], st)
            arm_out.setdefault(slot, {})[pose] = placed
    report["checks"]["C11"] = c11

    # C9 on the later sheets: shifted onto the master's own colours, they agree.
    c9 = {"status": "pass" if locks else "skip", "sheets": {}, "notes": []}
    for img, rows_ in locks.items():
        after = [r["after"] for r in rows_ if r["moved"]]
        med = float(np.median(after)) if after else 0.0
        top = max(after) if after else 0.0
        # Only the colours the sheet holds move; one it doesn't hold (a face sheet has
        # no legs) stays out of the score.
        st = "pass" if med <= TOL["lock_median_max"] and top <= TOL["lock_swatch_max"] else "warn"
        if st == "warn":
            c9["notes"].append(f"{img}: after the lock, median dE00 {med:.1f}, worst {top:.1f}")
        c9["sheets"][img] = {"median_after": round(med, 2), "max_after": round(top, 2), "status": st}
        c9["status"] = checks.worst(c9["status"], st)
    report["checks"]["C9"] = c9

    # Sprites, atlas, manifest.
    man, sprites = manifest(c, baked, tree, z, pivots, face_out, pupils, arm_out, rest, sources)
    atlas2x, rects = atlas.compose_atlas([s for _, s in sprites])
    keys = [k for k, _ in sprites]
    fill_sprites(man, keys, rects, (atlas2x.size[0] // 2, atlas2x.size[1] // 2))
    buf = folder / "atlas@2x.png"
    atlas2x.save(buf, "PNG", optimize=True)
    src_shas = {img: im.sha256_file(p) for img, p in files.items() if p is not None}
    cand = {
        "id": cid,
        "builder": BUILDER_VERSION,
        "sources": src_shas,
        "manifest": man,
        "atlas2x": im.sha256_file(buf),
        "rects": {k: list(r) for k, r in zip(keys, rects)},
    }
    cand["rig_sha256"] = rig_sha(cand)
    (folder / "candidate.json").write_text(json.dumps(cand, indent=2) + "\n", encoding="utf-8", newline="\n")
    Image.fromarray(rest, "RGBA").save(folder / "rest.png")
    report["rig_sha256"] = cand["rig_sha256"]
    report["counts"] = man["counts"]
    report["status"] = checks.worst(
        *(v.get("status", "skip") for v in report["checks"].values() if isinstance(v, dict)),
        *(r["status"] for r in [report["images"]["master"]]),
        "fail" if missing else "pass",
    )
    out(f"{cid}: candidate {report['status']} -> review/{batch}/{cid}/ (rig {cand['rig_sha256'][:12]})")
    return report


def rig_sha(cand: dict) -> str:
    body = {k: cand[k] for k in ("id", "builder", "sources", "manifest", "atlas2x", "rects")}
    return im.sha256_bytes(json.dumps(body, sort_keys=True).encode())


# ---------- manifest ----------


def _pct(v: float) -> float:
    return round(float(v) * 100, 2) + 0.0


def _box_in(child, parent) -> list[float]:
    """child box (x0, y0, x1, y1) as % of the parent box."""
    pw, ph = parent[2] - parent[0], parent[3] - parent[1]
    return [
        _pct((child[0] - parent[0]) / pw),
        _pct((child[1] - parent[1]) / ph),
        _pct((child[2] - child[0]) / pw),
        _pct((child[3] - child[1]) / ph),
    ]


def _pt_in(x, y, box) -> list[float]:
    return [_pct((x - box[0]) / (box[2] - box[0])), _pct((y - box[1]) / (box[3] - box[1]))]


def _sprite(rgba: np.ndarray, k2: float) -> tuple[tuple[int, int, int, int], np.ndarray] | None:
    box = im.mask_bbox(rgba[..., 3] > 0)
    if box is None:
        return None
    x0, y0, x1, y1 = box
    crop = Image.fromarray(rgba[y0:y1, x0:x1], "RGBA").convert("RGBa")
    w, h = max(1, round((x1 - x0) * k2)), max(1, round((y1 - y0) * k2))
    return box, np.array(crop.resize((w, h), Image.LANCZOS).convert("RGBA"))


def manifest(c, baked, tree, z, pivots, face_out, pupils, arm_out, rest, sources) -> tuple[dict, list]:
    """(RigManifest with sprite slots unfilled, [(sprite key, 2x RGBA)])."""
    fig = im.mask_bbox(rest[..., 3] > 0)
    fh = fig[3] - fig[1]
    k2 = 2 * BUDGETS["figure_css_px_max"] / fh
    sprites: list = []
    boxes: dict = {}

    def add(keyname, rgba):
        got = _sprite(rgba, k2)
        if got is None:
            return None
        box, s2 = got
        sprites.append((keyname, s2))
        return box

    order = []

    def walk(p):
        order.append(p)
        for k in sorted(tree.get(p, []), key=lambda k: z[k]):
            walk(k)

    if "torso" in baked:
        walk("torso")
    parts_out = []
    for pid in order:
        box = add(f"part:{pid}", baked[pid])
        if box is None:
            continue
        boxes[pid] = box
        par = parent_of(pid, list(baked))
        pbox = fig if par is None else boxes[par]
        if par is None:
            px, py = (fig[0] + fig[2]) / 2, fig[3]
        else:
            pv = pivots.get(pid, {})
            px, py = (pv.get("x"), pv.get("y")) if pv.get("x") is not None else ((box[0] + box[2]) / 2, box[1])
        part = {
            "id": pid,
            "parent": par,
            "box": _box_in(box, pbox),
            "pivot": _pt_in(px, py, box),
            "z": int(z.get(pid, 0)),
            "sprite": f"part:{pid}",
            "range": range_for(pid),
        }
        sock = socket_of(pid)
        if sock:
            part["socket"] = sock
        parts_out.append(part)
    host = "head" if "head" in boxes else "torso"
    pupil_ids = []
    for pid, p in zip(("pupil-r", "pupil-l"), pupils):
        if host not in boxes:
            break
        box = add(f"part:{pid}", p["sprite"])
        if box is None:
            continue
        boxes[pid] = box
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        hz = max((x["z"] for x in parts_out if x["parent"] == host), default=0)
        parts_out.append(
            {
                "id": pid,
                "parent": host,
                "box": _box_in(box, boxes[host]),
                "pivot": _pt_in(cx, cy, box),
                "z": hz + 1 + len(pupil_ids),
                "sprite": f"part:{pid}",
                "range": 0,
            }
        )
        pupil_ids.append(pid)
    swaps_out = []
    for slot in ("eyes", "mouth"):
        f = face_out.get(slot)
        if not f or host not in boxes:
            continue
        b = f["box"]
        rest_id = "open" if slot == "eyes" else "rest"
        choices = [{"id": rest_id, "box": [0, 0, 100, 100], "sprite": None}]
        for st, rgba in f["choices"].items():
            if add(f"{slot}:{st}", rgba) is not None:
                cbox = im.mask_bbox(rgba[..., 3] > 0)
                choices.append({"id": st, "box": _box_in(cbox, b), "sprite": f"{slot}:{st}"})
        swaps_out.append(
            {
                "id": slot,
                "on": host,
                "box": _box_in(b, boxes[host]),
                "pivot": [50, 50],
                "rest": rest_id,
                "choices": choices,
            }
        )
    for slot, posed in arm_out.items():
        if slot not in boxes or "torso" not in boxes:
            continue
        pboxes = {}
        for pose, rgba in posed.items():
            b = add(f"{slot}:{pose}", rgba)
            if b is not None:
                pboxes[pose] = b
        allb = [boxes[slot], *pboxes.values()]
        sb = (min(b[0] for b in allb), min(b[1] for b in allb), max(b[2] for b in allb), max(b[3] for b in allb))
        pv = pivots[slot]
        choices = [{"id": "rest", "box": _box_in(boxes[slot], sb), "sprite": None}]
        for pose, b in pboxes.items():
            ch = {"id": pose, "box": _box_in(b, sb), "sprite": f"{slot}:{pose}"}
            if pose == "chin":
                ch["z"] = 1
            choices.append(ch)
        swaps_out.append(
            {
                "id": slot,
                "on": "torso",
                "box": _box_in(sb, boxes["torso"]),
                "pivot": _pt_in(pv["x"], pv["y"], sb),
                "rest": "rest",
                "choices": choices,
            }
        )
    pup = None
    if len(pupil_ids) == 2:
        tx, ty = [], []
        light = swaps.whites(baked[host])
        for p in pupils[:2]:
            ax, ay = swaps.pupil_travel(p["mask"], light)
            b = p["box"]
            tx.append(ax / max(b[2] - b[0], 1))
            ty.append(ay / max(b[3] - b[1], 1))
        pup = {"ids": pupil_ids, "travel": [_pct(min(tx)), _pct(min(ty))], "shownWith": ["open", "wide"]}
    hva = 1
    try:
        private = json.loads((Path(sources) / "sources" / "cast-private.json").read_text(encoding="utf-8"))
        hva = private["characters"][c["id"]].get("height_vs_amr", 1)
    except (OSError, KeyError, ValueError):
        pass
    animated = sum(1 for p in parts_out if p["range"])
    nodes = 1 + sum(2 for _ in parts_out) + sum(len(s["choices"]) for s in swaps_out) + 1
    man = {
        "v": 1,
        "id": c["id"],
        "name": c["name"],
        "family": c["family"],
        "ratio": round((fig[2] - fig[0]) / fh, 4),
        "heightVsAmr": hva,
        "floor": _pct((np.percentile(np.nonzero(rest[..., 3] > 0)[0] + 1, 98) - fig[1]) / fh),
        "atlas": {"x1": "", "x2": "", "bytes1": 0, "bytes2": 0},
        "parts": parts_out,
        "swaps": swaps_out,
        "pupils": pup,
        "signature": [],
        "counts": {"nodes": nodes, "animated": animated},
    }
    return man, sprites


def fill_sprites(man: dict, keys: list[str], rects: list, size1x: tuple[int, int]) -> None:
    """Replace each sprite key in the manifest with its background size and
    position (% of the element's own box) in the 1x atlas."""
    AW, AH = size1x
    at = dict(zip(keys, rects))

    def bg(k):
        x, y, w, h = at[k]
        return {
            "bg": [
                _pct(AW / w),
                _pct(AH / h),
                _pct(x / (AW - w)) if AW != w else 0,
                _pct(y / (AH - h)) if AH != h else 0,
            ]
        }

    for p in man["parts"]:
        if isinstance(p["sprite"], str):
            p["sprite"] = bg(p["sprite"])
    for s in man["swaps"]:
        for ch in s["choices"]:
            if isinstance(ch["sprite"], str):
                ch["sprite"] = bg(ch["sprite"])


# ---------- the generated TypeScript ----------

TS_HEAD = """/**
 * The cast puppet rigs. GENERATED by scripts/build-cast-rigs.py build, only from
 * sources whose sha256 the owner approved (docs/cast/CAST-BUILD.md); don't edit by
 * hand, run the script.
 *
 * Pure data with no imports (no server-only either), so Node scripts can load it;
 * pages reach it through src/lib/cast/rigs.ts. Each entry is a RigManifest
 * (src/lib/cast/rig-types.ts); atlases live in public/cast under hashed names.
 */
"""


def ts_file(rigs: dict) -> str:
    from . import fmt

    body = fmt.ts_value({k: rigs[k] for k in sorted(rigs)}, head=len("export const RIGS = "), tail=len(" as const;"))
    return TS_HEAD + "\nexport const RIGS = " + body + " as const;\n"


def read_ts(path: Path) -> dict:
    """The rigs already in a generated file (its body is JSON-compatible once the
    bare keys are quoted)."""
    import re

    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8")
    m = re.search(r"export const RIGS = (.*) as const;", text, re.S)
    if not m:
        return {}
    body = re.sub(r"^(\s*)([A-Za-z_$][A-Za-z0-9_$]*):", r'\1"\2":', m.group(1), flags=re.M)
    body = re.sub(r",(\s*[}\]])", r"\1", body)
    return json.loads(body)
