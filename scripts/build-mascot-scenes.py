"""
Build Amr's companion scene packs (docs/mascot/companion-scenes.json) as baked scenes.

    python -I scripts/build-mascot-scenes.py <sheets folder> [--preview <folder>] [--check]

The folder holds the sheets the spec names (N01-ai-reviewer.png ...), 1536 x 1024,
eight 384 x 512 slots, slot 1 Amr alone in his standard stance. Each file must match
the spec's sha256: the art is used exactly as it was approved.

A baked scene is built as drawn, Amr and whatever shares his slot together:
  scale   one per sheet, from slot 1: his stance is made the live idle's height.
          Nothing is scaled on its own (no head sizing).
  place   each slot is put on the floor and the feet x by Amr's own body only (the
          largest figure in the slot), never by the whole slot, so a colleague or a
          prop beside him can't move him. A slot whose Amr sits within ALIGN_PX
          (1x px) of slot 1's place keeps slot 1's; one further off is moved by
          exactly his own drift, so he doesn't jump between the idle and the scene.
  colour  none: no skin, clothes or hair matching, so a green dinosaur or a cup of
          red tea is never mistaken for his shirt or skin.
  alpha   the generator's faint haze (alpha 8 or less, under 3%) is cleared, as for
          every other pack; everything above it is kept.
  1x      the 1x cells get the same unsharp step as every other pack, measured on
          this sheet's own stance (sharpness only, no colour).

The packs land in public/mascot next to the others and are written into
src/components/agent/mascot/mascot-packs.ts after them; every other pack's files and
lines are left exactly as they are. scripts/build-mascot-packs.py keeps these packs
as they are when it rebuilds the rest. After writing them it rebuilds the Scenes tab's
thumbnail atlas (scripts/build-mascot-expansion.py --thumbs), which shows the
companion stories too. --check builds nothing: it confirms the shipped baked packs
and the spec agree.

Needs Pillow and numpy. The source PNGs never ship.
"""

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import mascot_heads as heads  # noqa: E402

_spec = importlib.util.spec_from_file_location("build_mascot_packs", HERE / "build-mascot-packs.py")
packs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(packs)

SPEC = packs.ROOT / "docs" / "mascot" / "companion-scenes.json"
ALIGN_PX = 0.75  # 1x px: closer than this to slot 1's place and the slot keeps it


def companion_spec() -> dict:
    return json.loads(SPEC.read_text(encoding="utf-8"))


def baked_pack_names() -> list[str]:
    return [s["pack"] for s in companion_spec()["sheets"]]


def amr_mask(alpha: np.ndarray) -> np.ndarray:
    """Amr's own pixels in a slot: the largest figure (alpha > 32). Something he holds
    joins him; a colleague standing beside him doesn't."""
    comps = heads.components(alpha > 32)
    if not comps:
        raise SystemExit("an empty slot")
    ys, xs = comps[0]
    m = np.zeros(alpha.shape, bool)
    m[ys, xs] = True
    return m


def amr_place(alpha: np.ndarray, stance_h: int) -> tuple[float, float, dict]:
    """Where Amr stands in a slot: (feet x, floor y), from his own pixels only.
    Feet x is the mean of his solid pixels in the bottom 12% of his stance's height."""
    m = amr_mask(alpha)
    rows = np.nonzero(m.any(1))[0]
    top, floor = int(rows[0]), int(rows[-1]) + 1
    solid = m & (alpha > 128)
    _, xs = np.nonzero(solid[int(floor - 0.12 * stance_h):floor])
    return float(xs.mean()) + 0.5, float(floor), {"top": top, "floor": floor}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_scene_frames(src: Path):
    """{frame id: {k: cell}}, {pack: {k: stance cell}}, notes, placement log."""
    frames, stances, notes, log = {}, {}, [], []
    for sheet in companion_spec()["sheets"]:
        path = src / sheet["file"]
        if not path.exists():
            raise SystemExit(f"{sheet['id']}: {path} is missing")
        got = sha256(path)
        if got != sheet["sha256"]:
            raise SystemExit(f"{sheet['id']}: {path.name} isn't the approved file (sha256 {got[:12]}…)")
        rgba = np.array(Image.open(path).convert("RGBA"))
        if rgba.shape[:2] != (1024, 1536):
            raise SystemExit(f"{sheet['id']}: expected 1536 x 1024, got {rgba.shape[1]} x {rgba.shape[0]}")
        rgba = packs.clean(rgba)
        slots = [rgba[(i // 4) * packs.SLOT_H:(i // 4 + 1) * packs.SLOT_H,
                      (i % 4) * packs.SLOT_W:(i % 4 + 1) * packs.SLOT_W] for i in range(8)]
        a0 = slots[0][..., 3]
        top, floor, _, _ = packs.bounds(a0)
        stance_h = floor - top
        scale = packs.STANCE_H / stance_h
        ax0, fy0, _ = amr_place(a0, stance_h)
        pack = sheet["pack"]
        stances[pack] = {k: packs.register(Image.fromarray(slots[0]), scale, ax0, fy0, k) for k in packs.SCALES}
        if len(sheet["slots"]) != 7:
            raise SystemExit(f"{sheet['id']}: the spec lists {len(sheet['slots'])} slots, not 7")
        for i, slot in enumerate(sheet["slots"], start=1):
            ax, fy, _ = amr_place(slots[i][..., 3], stance_h)
            dx, dy = (ax - ax0) * scale, (fy - fy0) * scale
            moved = abs(dx) > ALIGN_PX or abs(dy) > ALIGN_PX
            use_x, use_y = (ax, fy) if moved else (ax0, fy0)
            log.append(f"{slot['id']:18} Amr {dx:+5.1f},{dy:+5.1f} px at 1x from slot 1"
                       + ("  -> moved by his own drift" if moved else ""))
            img = Image.fromarray(slots[i])
            frames[slot["id"]] = {k: packs.register(img, scale, use_x, use_y, k) for k in packs.SCALES}
            edges = packs.overflow(frames[slot["id"]][1])
            if edges:
                notes.append(f"{slot['id']} touches the cell's {', '.join(edges)} edge")
        log.append(f"{sheet['id']} {pack}: stance {stance_h} px -> scale {scale:.4f} (1x)")
    return frames, stances, notes, log


def sharpen_baked(frames, stances) -> dict:
    """The same 1x unsharp step as every other pack, its amount from this sheet's stance."""
    amounts = {}
    goal = heads.detail(packs.live_cell(Image.open(next(packs.PUBLIC.glob("amr.*.webp"))).convert("RGBA")))
    for sheet in companion_spec()["sheets"]:
        pack = sheet["pack"]
        amounts[pack] = packs.sharp_amount(packs.small(stances[pack][2]), goal) if goal else 0.0
        for slot in sheet["slots"]:
            fid = slot["id"]
            frames[fid][1] = heads.sharpen(packs.small(frames[fid][2]), amounts[pack], packs.SHARP_RADIUS)
        stances[pack][1] = heads.sharpen(packs.small(stances[pack][2]), amounts[pack], packs.SHARP_RADIUS)
    return amounts


def write_baked(frames) -> None:
    """Write the baked packs and the manifest: every other pack's entry and frames are
    read back from the manifest and written out unchanged, the baked packs after them."""
    shipped = packs.shipped_packs()
    names = baked_pack_names()
    for name in names:
        for old in list(packs.PUBLIC.glob(f"amr-{name}.*.webp")) + list(packs.PUBLIC.glob(f"amr-{name}@2x.*.webp")):
            old.unlink()
    manifest, order = {}, {}
    for pack, (entry, fids) in shipped.items():
        if pack in names:
            continue
        manifest[pack] = entry
        order[pack] = fids
    for sheet in companion_spec()["sheets"]:
        pack = sheet["pack"]
        fids = [slot["id"] for slot in sheet["slots"]]
        entry = {"frames": len(fids)}
        for k in packs.SCALES:
            data = packs.webp_bytes(packs.pack_sheet([frames[f][k] for f in fids], k))
            digest = hashlib.sha256(data).hexdigest()[:8]
            name = f"amr-{pack}{'' if k == 1 else '@2x'}.{digest}.webp"
            (packs.PUBLIC / name).write_bytes(data)
            entry["src" if k == 1 else "src2x"] = f"/mascot/{name}"
            entry["bytes" if k == 1 else "bytes2x"] = len(data)
        manifest[pack] = entry
        order[pack] = fids
    packs.PACKS.clear()
    packs.PACKS.update(order)
    packs.write_manifest(manifest)


def check() -> None:
    shipped = packs.shipped_packs()
    bad = []
    for sheet in companion_spec()["sheets"]:
        pack, fids = sheet["pack"], [slot["id"] for slot in sheet["slots"]]
        if pack not in shipped:
            bad.append(f"{sheet['id']}: pack {pack} isn't in the manifest")
            continue
        entry, have = shipped[pack]
        if have != fids:
            bad.append(f"{sheet['id']}: the manifest's frames for {pack} aren't the spec's")
        for key in ("src", "src2x"):
            if not (packs.PUBLIC / Path(entry[key]).name).exists():
                bad.append(f"{sheet['id']}: {entry[key]} is missing")
    if bad:
        raise SystemExit("\n".join(bad))
    print(f"baked packs agree with the spec: {', '.join(baked_pack_names())}")


def write_previews(frames, stances, out: Path) -> None:
    """contact-scenes-{light,dark}@{1,2}x.png: the live idle, each stance, then the story,
    with the live figure's top and floor rows marked. The @1x ones are the size he's
    shown at on most screens, on both backgrounds."""
    out.mkdir(parents=True, exist_ok=True)
    live = Image.open(next(packs.PUBLIC.glob("amr.*.webp"))).convert("RGBA")
    by_pack = {s["pack"]: [slot["id"] for slot in s["slots"]] for s in companion_spec()["sheets"]}
    packs.write_contacts(frames, stances, by_pack, live, out, "scenes-")


def colour_report(stances) -> list[str]:
    """How far each sheet's Amr is from the live idle's colours (measured, not changed)."""
    lines = []
    ref = packs.live_ref()
    live_g = packs.live_clothes()
    for pack, st in stances.items():
        cell = st[2]
        parts = []
        lab = heads.skin_lab(heads.measure(cell), ref)
        if lab is not None:
            parts.append(f"skin dE {heads.de2000(lab, ref['lab']):.1f}")
        g = heads.garments(cell)
        for name in heads.GARMENTS:
            if name in g and name in live_g:
                lab = heads.garment_lab(cell, g[name])
                if lab is not None:
                    parts.append(f"{name} dE {heads.de2000(lab, live_g[name]):.1f}")
        lines.append(f"{pack:9} " + (", ".join(parts) if parts else "not measurable"))
    return lines


def refresh_thumbs() -> None:
    """Rebuild the Scenes tab's atlas, whose first cells are these stories."""
    builder = HERE / "build-mascot-expansion.py"
    if not packs.EXPANSION_SPEC.exists() or not builder.exists():
        return
    spec = importlib.util.spec_from_file_location("build_mascot_expansion", builder)
    expansion = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(expansion)
    expansion.write_thumbs()


def main() -> None:
    args = sys.argv[1:]
    if "--check" in args:
        check()
        return
    if not args:
        raise SystemExit(__doc__)
    src = Path(args[0])
    preview = Path(args[args.index("--preview") + 1]) if "--preview" in args else None
    frames, stances, notes, log = load_scene_frames(src)
    for line in log:
        print(line)
    amounts = sharpen_baked(frames, stances)
    print("1x sharpening:", ", ".join(f"{p} {a:.2f}" for p, a in amounts.items()))
    for n in notes:
        print("note:", n)
    try:
        for line in colour_report(stances):
            print("colour (measured only):", line)
    except Exception as e:  # informational; never blocks a build
        print("colour report skipped:", e)
    write_baked(frames)
    refresh_thumbs()
    shipped = packs.shipped_packs()
    for pack in baked_pack_names():
        e = shipped[pack][0]
        print(f"{pack:9} {e['frames']} frames  {e['bytes'] // 1024:4} KB  2x {e['bytes2x'] // 1024:4} KB")
    if preview:
        write_previews(frames, stances, preview)
        print("previews in", preview)


if __name__ == "__main__":
    main()
