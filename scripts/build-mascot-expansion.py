"""
Build Amr's expansion scene packs (docs/mascot/expansion-sheets.json) as drawn.

    python -I scripts/build-mascot-expansion.py <sheets folder> [--preview <folder>] [--check]
    python -I scripts/build-mascot-expansion.py --thumbs

The folder holds the X sheets the spec names (X001-bookmark-return.png ...), as
scripts/intake-refined-sprites.py put them: 1536 x 1024, eight 384 x 512 slots, all
eight real beats. Each file must match the spec's sha256.

Each sheet is placed once and every slot keeps that placement:
  scale   one for the whole release: the refined sheets draw his standing figure
          435 px tall (crown about y45, soles about y480 in every slot), so every sheet
          gets 177 / 435, the live idle's height. Slot 1 needn't be a standing pose here.
  place   by Amr's own figure in slot 1: his feet x goes to the live feet x and his
          lowest point to the floor, unless something of the sheet would then pass a
          side of the cell (a colleague standing beside him): the scene then slides
          just far enough to fit. His feet x is where his trouser hems are (the khaki
          below his shirt, kept to the columns under it): the largest figure in the
          slot is him only while nothing touches him, and a prop on the floor or a
          colleague he hands something to would pull it off his feet. Where his
          trousers can't be read under his waist, the largest figure's feet are used,
          and where neither finds them (a leg hidden, a prop of the same khaki
          touching him) FEET_X gives the place read off his shoes. The other seven slots get the very same transform, so a jump stays a
          jump and the props and cameos keep the places the artist gave them: the
          release poses him in place, so nothing needs re-centring frame by frame.
  colour  none (no skin, clothes or hair matching), and no sharpening: the refined art
          already matches the live sprite's colours and is crisper than it.
  alpha   the faint haze (alpha 8 or less) is cleared, as for every other pack.

The packs (eight frames, one row) land in public/mascot and are written into
src/components/agent/mascot/mascot-packs.ts after every other pack, whose files and
lines stay exactly as they are; scripts/build-mascot-packs.py and
build-mascot-scenes.py keep them as they are when they rebuild theirs. --check builds
nothing: it confirms the shipped expansion packs and the spec agree.

It also writes the thumbnail atlas for the Scenes tab (public/mascot/amr-thumbs.*.webp:
each listed scene's held pose at 72 x 84, one image for them all, where a pack each
would be megabytes) and engine/scene-thumbs.ts; --thumbs writes only those, from the
packs as they ship (build-mascot-scenes.py calls it after rebuilding the companion
packs). --check also confirms the shipped atlas is the one the packs make now.

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


def _load(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


packs = _load("build_mascot_packs", "build-mascot-packs.py")
scenes = _load("build_mascot_scenes", "build-mascot-scenes.py")
heads = packs.heads

SPEC = packs.EXPANSION_SPEC
REFINED_STANCE = 435  # px: the refined release's standing height in a 384 x 512 slot
FRAMES = 8


def spec() -> dict:
    return json.loads(SPEC.read_text(encoding="utf-8"))


def pack_names() -> list[str]:
    return [s["pack"] for s in spec()["sheets"]]


MARGIN = 2  # 1x px kept clear at each side of the cell
ANCHOR_SLACK = 10  # source px: closer than this, the largest figure's feet are his own

# Slot 1's feet x, read off his two shoes by eye, where neither his hems nor the
# largest figure find them: {sheet: (source px, why)}.
FEET_X: dict[str, tuple[float, str]] = {
    "X071": (210.0, "his right trouser leg is behind the filing rack"),
    "X100": (130.0, "the turtle's equipment touches his trousers"),
    "X123": (145.0, "the khaki hamper touches his leg"),
}


def own_feet_x(slot: np.ndarray) -> float | None:
    """Amr's feet x in a slot from his own trousers: the khaki below his waist, kept
    near it, its lowest quarter (his hems, between his shoes). His waist is the
    lowest rows of his shirt, where it is his torso only (an arm held out widens the
    shirt higher up). None when his shirt or trousers don't show, or the hems found
    aren't under his waist (a wooden hamper beside him is the same khaki)."""
    g = heads.garments(Image.fromarray(slot))
    if "shirt" not in g or "trousers" not in g:
        return None
    sy, sx = np.nonzero(g["shirt"])
    waist = sx[sy >= np.percentile(sy, 85)]
    x0, x1 = float(waist.min()), float(waist.max())
    w = x1 - x0
    ys, xs = np.nonzero(g["trousers"])
    keep = (xs >= x0 - 0.5 * w) & (xs <= x1 + 0.5 * w) & (ys > np.percentile(sy, 60))
    ys, xs = ys[keep], xs[keep]
    if len(xs) < 300:
        return None
    hems = xs[ys >= ys.max() - 0.25 * (ys.max() - ys.min())]
    fx = float(hems.mean())
    return fx if x0 - 0.25 * w <= fx <= x1 + 0.25 * w else None


def fit_width(slots, ax: float, scale: float) -> tuple[float, float]:
    """Amr's feet go to the live feet x, unless that puts something of the sheet (a
    colleague beside him, a prop he hands over) past a side of the cell: then the whole
    scene slides just far enough to fit, the same for all eight frames. Returns the feet
    x to anchor on and how far it slid (1x px, 0 when it didn't)."""
    union = np.zeros(slots[0].shape[:2], bool)
    for sl in slots:
        union |= sl[..., 3] > 32
    xs = np.nonzero(union.any(0))[0]
    left = packs.LIVE_FEET_X + (xs.min() - ax) * scale
    right = packs.LIVE_FEET_X + (xs.max() + 1 - ax) * scale
    lo, hi = MARGIN, packs.CELL_W - MARGIN
    if right - left > hi - lo:  # can't fit: centre it
        shift = (lo + hi) / 2 - (left + right) / 2
    elif right > hi:
        shift = hi - right
    elif left < lo:
        shift = lo - left
    else:
        return ax, 0.0
    return ax - shift / scale, shift


def load_frames(src: Path):
    """{frame id: {k: cell}}, notes, placement log."""
    frames, notes, log = {}, [], []
    scale = packs.STANCE_H / REFINED_STANCE
    for sheet in spec()["sheets"]:
        path = src / sheet["file"]
        if not path.exists():
            raise SystemExit(f"{sheet['id']}: {path} is missing")
        got = scenes.sha256(path)
        if got != sheet["sha256"]:
            raise SystemExit(f"{sheet['id']}: {path.name} isn't the approved file (sha256 {got[:12]}…)")
        rgba = np.array(Image.open(path).convert("RGBA"))
        if rgba.shape[:2] != (1024, 1536):
            raise SystemExit(f"{sheet['id']}: expected 1536 x 1024, got {rgba.shape[1]} x {rgba.shape[0]}")
        if len(sheet["slots"]) != FRAMES:
            raise SystemExit(f"{sheet['id']}: the spec lists {len(sheet['slots'])} slots, not {FRAMES}")
        rgba = packs.clean(rgba)
        slots = [rgba[(i // 4) * packs.SLOT_H:(i // 4 + 1) * packs.SLOT_H,
                      (i % 4) * packs.SLOT_W:(i % 4 + 1) * packs.SLOT_W] for i in range(FRAMES)]
        ax, fy, box = scenes.amr_place(slots[0][..., 3], REFINED_STANCE)
        own = FEET_X[sheet["id"]][0] if sheet["id"] in FEET_X else own_feet_x(slots[0])
        moved = own is not None and abs(own - ax) > ANCHOR_SLACK
        if moved:
            ax_figure, ax = ax, own
        ax, slid = fit_width(slots, ax, scale)
        log.append(f"{sheet['id']} {sheet['pack']}: Amr in slot 1 {box['floor'] - box['top']} px tall, "
                   f"feet x {ax:.1f}, floor {fy:.0f}"
                   + (f" (his hems; the largest figure's feet were at {ax_figure:.1f})" if moved else "")
                   + (f", slid {slid:+.1f} px at 1x to fit" if slid else ""))
        for i, slot in enumerate(sheet["slots"]):
            img = Image.fromarray(slots[i])
            frames[slot["id"]] = {k: packs.register(img, scale, ax, fy, k) for k in packs.SCALES}
            edges = packs.overflow(frames[slot["id"]][1])
            if edges:
                notes.append(f"{slot['id']} touches the cell's {', '.join(edges)} edge")
    return frames, notes, log


def write_packs(frames) -> None:
    """Write the expansion packs and the manifest: every other pack's entry and frames
    are read back from the manifest and written out unchanged, these after them."""
    shipped = packs.shipped_packs()
    names = pack_names()
    for name in names:
        for old in list(packs.PUBLIC.glob(f"amr-{name}.*.webp")) + list(packs.PUBLIC.glob(f"amr-{name}@2x.*.webp")):
            old.unlink()
    manifest, order = {}, {}
    for pack, (entry, fids) in shipped.items():
        if pack in names:
            continue
        manifest[pack] = entry
        order[pack] = fids
    for sheet in spec()["sheets"]:
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


# The Scenes tab's thumbnails: each scene's held pose, small, in one atlas (a pack
# each would be megabytes).
THUMB_W, THUMB_H, THUMB_COLUMNS = 72, 84, 16
THUMBS_TS = packs.ROOT / "src" / "components" / "agent" / "mascot" / "engine" / "scene-thumbs.ts"

# Packs the Scenes tab plays as a named variant (GALLERY_VARIANTS in engine/scenes.ts),
# each shown by the beat that variant holds rather than the sheet's: {pack: beat}.
# test/agent/mascot-scenes-tab.test.tsx keeps this and the variants' stills equal.
GALLERY_HOLDS: dict[str, int] = {
    "x112": 5,  # x112.filter: the filter moment, before the reset of beats 6-8
}


def thumb_scenes() -> list[tuple[str, str, int]]:
    """(scene, pack, cell) for every scene the Scenes tab lists: the companion stories
    the visitor may ask for, then X001-X124, each shown by the beat a tap leaves him
    holding (its gallery variant's, else its last, or `last` while its final beats are
    drawn wrong)."""
    out = []
    comp = scenes.companion_spec()["sheets"]
    play = {"reviewer", "dino", "rabbit", "octopus", "ahwa", "escape", "comic", "retry", "quiet"}
    for sheet in comp:
        if sheet["pack"] in play:
            out.append((sheet["pack"], sheet["pack"], len(sheet["slots"]) - 1))
    for sheet in spec()["sheets"]:
        held = GALLERY_HOLDS.get(sheet["pack"], sheet.get("last", FRAMES))
        out.append((sheet["pack"], sheet["pack"], held - 1))
    return out


def thumb_atlas() -> tuple[bytes, list[tuple[str, str, int]], int]:
    """The atlas as WebP bytes, its scenes and its rows, from the packs as they ship."""
    shipped = packs.shipped_packs()
    items = thumb_scenes()
    rows = -(-len(items) // THUMB_COLUMNS)
    atlas = Image.new("RGBA", (THUMB_COLUMNS * THUMB_W, rows * THUMB_H), (0, 0, 0, 0))
    opened: dict[str, Image.Image] = {}
    for i, (_scene, pack, cell) in enumerate(items):
        entry = shipped[pack][0]
        if pack not in opened:
            opened[pack] = Image.open(packs.PUBLIC / Path(entry["src2x"]).name).convert("RGBA")
        cw, ch = packs.CELL_W * 2, packs.PACK_H * 2
        r, c = divmod(cell, packs.COLUMNS)
        img = opened[pack].crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
        img = img.convert("RGBa").resize((THUMB_W, THUMB_H), Image.LANCZOS).convert("RGBA")
        atlas.alpha_composite(img, ((i % THUMB_COLUMNS) * THUMB_W, (i // THUMB_COLUMNS) * THUMB_H))
    return packs.webp_bytes(atlas), items, rows


def thumbs_ts(name: str, data: bytes, items, rows: int) -> str:
    # Keys quoted only where they must be, as prettier leaves them, so --check agrees
    # with the formatted file.
    index = ",\n".join(
        f"  {scene if scene.isidentifier() else json.dumps(scene)}: {i}"
        for i, (scene, _p, _c) in enumerate(items)
    )
    return f'''/**
 * The Scenes tab's thumbnails: each listed scene's held pose, {THUMB_W} x {THUMB_H}, in one
 * atlas ({THUMB_COLUMNS} to a row). Written by scripts/build-mascot-expansion.py; do not
 * edit by hand.
 */

export const SCENE_THUMBS = {{
  src: "/mascot/{name}",
  bytes: {len(data)},
  cell: {{ w: {THUMB_W}, h: {THUMB_H} }},
  columns: {THUMB_COLUMNS},
  rows: {rows},
}} as const;

/** Each listed scene's cell in the atlas. */
export const THUMB_INDEX: Readonly<Record<string, number>> = {{
{index},
}};
'''


def write_thumbs() -> None:
    data, items, rows = thumb_atlas()
    for old in packs.PUBLIC.glob("amr-thumbs.*.webp"):
        old.unlink()
    name = f"amr-thumbs.{hashlib.sha256(data).hexdigest()[:8]}.webp"
    (packs.PUBLIC / name).write_bytes(data)
    THUMBS_TS.write_text(thumbs_ts(name, data, items, rows), encoding="utf-8", newline="\n")
    print(f"thumbnails: {len(items)} scenes, {name} {len(data) // 1024} KB")


def check() -> None:
    shipped = packs.shipped_packs()
    bad = []
    for sheet in spec()["sheets"]:
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
    data, items, rows = thumb_atlas()
    name = f"amr-thumbs.{hashlib.sha256(data).hexdigest()[:8]}.webp"
    if not (packs.PUBLIC / name).exists():
        bad.append(f"the thumbnail atlas is stale: the packs make {name} now (--thumbs)")
    elif not THUMBS_TS.exists() or THUMBS_TS.read_text(encoding="utf-8") != thumbs_ts(name, data, items, rows):
        bad.append(f"{THUMBS_TS.name} is stale (--thumbs)")
    if bad:
        raise SystemExit("\n".join(bad))
    print(f"expansion packs and their thumbnails agree with the spec: {len(spec()['sheets'])} sheets")


def write_previews(frames, out: Path) -> None:
    """contact-x-<family>-{light,dark}@{1,2}x.png: per family, each sheet's eight frames
    after the live idle, at the size he's shown (1x) and on sharp screens (2x)."""
    out.mkdir(parents=True, exist_ok=True)
    live = Image.open(next(packs.PUBLIC.glob("amr.*.webp"))).convert("RGBA")
    families: dict[str, dict[str, list[str]]] = {}
    for s in spec()["sheets"]:
        families.setdefault(s["family"], {})[s["pack"]] = [slot["id"] for slot in s["slots"]]
    for family, by_pack in families.items():
        stances = {pack: frames[fids[0]] for pack, fids in by_pack.items()}
        rest = {pack: fids[1:] for pack, fids in by_pack.items()}
        packs.write_contacts(frames, stances, rest, live, out, f"x-{family}-")


def folder_arg(args: list[str], valued: tuple[str, ...] = ()) -> Path:
    """The folder given on the command line: the first argument that is neither a flag
    nor a flag's value. No folder, or -h / --help, prints the usage."""
    if "-h" in args or "--help" in args:
        raise SystemExit(__doc__)
    skip = {i + 1 for i, a in enumerate(args) if a in valued}
    for i, a in enumerate(args):
        if i not in skip and not a.startswith("-"):
            return Path(a)
    raise SystemExit(__doc__)


def main() -> None:
    args = sys.argv[1:]
    if "-h" in args or "--help" in args:
        raise SystemExit(__doc__)
    if "--check" in args:
        check()
        return
    if "--thumbs" in args:  # only the Scenes tab's atlas, from the packs as they ship
        write_thumbs()
        return
    src = folder_arg(args, ("--preview",))
    preview = Path(args[args.index("--preview") + 1]) if "--preview" in args else None
    frames, notes, log = load_frames(src)
    for line in log:
        print(line)
    for n in notes:
        print("note:", n)
    write_packs(frames)
    write_thumbs()
    shipped = packs.shipped_packs()
    sizes = [(p, shipped[p][0]) for p in pack_names()]
    for pack, e in sizes:
        print(f"{pack:6} {e['frames']} frames  {e['bytes'] // 1024:4} KB  2x {e['bytes2x'] // 1024:4} KB")
    print(f"total  {sum(e['bytes'] for _, e in sizes) // 1024} KB, 2x {sum(e['bytes2x'] for _, e in sizes) // 1024} KB")
    if preview:
        write_previews(frames, preview)
        print("previews in", preview)


if __name__ == "__main__":
    main()
