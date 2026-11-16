"""
Build Amr's live sheet (public/mascot/amr.*.webp) from the refined live sheets L01-L10.

    python -I scripts/build-mascot-live.py <sheets folder> --record [--preview <folder>]
    python -I scripts/build-mascot-live.py <sheets folder> [--preview <folder>]
    python -I scripts/build-mascot-live.py --check [<sheets folder>]

The live sheet is the image every visitor loads first: his idle breathing, the 16
directions he looks in, his everyday reactions, the stand-ins while a pack loads and
every reduced-motion still; AmrStill, the comics intro and the VIP portrait show it
too. docs/mascot/live-sheets.json (the brief is AMR-LIVE-SHEET-BRIEF.md) says which
slot of which sheet fills which of its cells: 8 columns x 11 rows of 192 x 208, the
grid and rows engine/sprite-poses.ts reads.

The sheets are 1536 x 1024, eight 384 x 512 slots, in the refined release's format.
--record takes a returned set in: it writes each sheet's sha256 into the spec. After
that every build checks each file against it, so only the approved files go in.

Each sheet is built as drawn, like the refined release (build-mascot-packs.py
--as-drawn, build-mascot-expansion.py):
  scale   one for every sheet: the release draws his standing figure 435 px tall, so
          177 / 435, the live idle's height.
  place   by slot 1 (or, for a sheet whose spec says `register: slots`, each slot by
          its own feet x, so a standing frame drawn a few px aside doesn't slide him;
          the floor still comes from slot 1, so a jump keeps its lift): his feet x (his trouser hems, as the expansion
          builder finds them, else his figure's; or the spec's `feet_x`, as for a run
          cycle drawn in place, which hangs from its hips) on the live feet line and his lowest
          point on the floor row; the other seven slots get the same transform, so a
          run cycle and a jump keep the motion the artist drew.
  cell    a pack cell (192 x 224, 16 rows of headroom) cut to the live cell's 208 rows;
          anything in the cut rows or touching a side is reported.
  colour  none, and no sharpening.

The sheet is written as amr.<first 8 hex of its sha256>.webp, the old one deleted, and
MASCOT_SPRITE_URL in src/components/agent/mascot/mascot-asset.ts pointed at it.
--check builds nothing unless given the folder: it confirms the spec covers every
cell and the shipped sheet exists; with the folder it also rebuilds the sheet in memory
and compares it with the one that ships.

Needs Pillow and numpy. The source PNGs never ship.
"""

import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

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
expansion = _load("build_mascot_expansion", "build-mascot-expansion.py")

SPEC = packs.ROOT / "docs" / "mascot" / "live-sheets.json"
ASSET_TS = packs.ROOT / "src" / "components" / "agent" / "mascot" / "mascot-asset.ts"
REFINED_STANCE = 435
SLOTS = 8

# The live sheet's rows (engine/sprite-poses.ts POSES, then the two look rows): frames used.
ROW_FRAMES = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8]


def write_text(path: Path, text: str) -> None:
    """Write through a temporary file and an atomic replace, retrying a few times: a
    scanner holding a just-changed file open makes a plain overwrite fail on Windows."""
    import os
    import time

    tmp = path.with_name(path.name + ".tmp")
    for attempt in range(6):
        try:
            tmp.write_text(text, encoding="utf-8", newline="\n")
            os.replace(tmp, path)
            return
        except OSError:
            if attempt == 5:
                raise
            time.sleep(0.5 * (attempt + 1))


def spec() -> dict:
    return json.loads(SPEC.read_text(encoding="utf-8"))


def coverage_problems(s: dict) -> list[str]:
    """Every used cell of the live sheet filled once, from a slot that exists."""
    need = {(r, c) for r, n in enumerate(ROW_FRAMES) for c in range(n)}
    seen: dict[tuple[int, int], str] = {}
    bad = []
    for sh in s["sheets"]:
        if len(sh["slots"]) != SLOTS:
            bad.append(f"{sh['id']}: {len(sh['slots'])} slots, not {SLOTS}")
        for r, c, slot in sh["cells"]:
            if not 1 <= slot <= SLOTS:
                bad.append(f"{sh['id']}: slot {slot} doesn't exist")
            if (r, c) in seen:
                bad.append(f"cell {r},{c} filled twice ({seen[(r, c)]} and {sh['id']})")
            seen[(r, c)] = sh["id"]
    missing = sorted(need - set(seen))
    extra = sorted(set(seen) - need)
    if missing:
        bad.append(f"cells nothing fills: {missing}")
    if extra:
        bad.append(f"cells the engine never shows: {extra}")
    return bad


def shipped_url() -> str:
    m = re.search(r'MASCOT_SPRITE_URL = "(/mascot/amr\.[0-9a-f]{8}\.webp)"', ASSET_TS.read_text(encoding="utf-8"))
    if not m:
        raise SystemExit(f"no MASCOT_SPRITE_URL in {ASSET_TS.name}")
    return m.group(1)


def load_sheet(src: Path, sh: dict, record: bool) -> np.ndarray:
    path = src / sh["file"]
    if not path.exists():
        raise SystemExit(f"{sh['id']}: {path} is missing")
    got = scenes.sha256(path)
    if not record:
        if not sh.get("sha256"):
            raise SystemExit(f"{sh['id']}: no approved hash yet; take the set in with --record")
        if got != sh["sha256"]:
            raise SystemExit(f"{sh['id']}: {path.name} isn't the approved file (sha256 {got[:12]}…)")
    sh["sha256"] = got
    rgba = np.array(Image.open(path).convert("RGBA"))
    if rgba.shape[:2] != (1024, 1536):
        raise SystemExit(f"{sh['id']}: expected 1536 x 1024, got {rgba.shape[1]} x {rgba.shape[0]}")
    return packs.clean(rgba)


def build(src: Path, s: dict, record: bool):
    """The live sheet as an image, the build notes and the placement log."""
    scale = packs.STANCE_H / REFINED_STANCE
    grid = s["grid"]
    sheet = Image.new("RGBA", (grid["columns"] * grid["cellW"], grid["rows"] * grid["cellH"]), (0, 0, 0, 0))
    notes, log = [], []
    for sh in s["sheets"]:
        rgba = load_sheet(src, sh, record)
        slots = [rgba[(i // 4) * packs.SLOT_H:(i // 4 + 1) * packs.SLOT_H,
                      (i % 4) * packs.SLOT_W:(i % 4 + 1) * packs.SLOT_W] for i in range(SLOTS)]
        ax, fy, box = scenes.amr_place(slots[0][..., 3], REFINED_STANCE)
        own = expansion.own_feet_x(slots[0])
        if "feet_x" in sh:  # the spec's own line for him (a run cycle hangs from its hips)
            ax = float(sh["feet_x"])
        elif own is not None and abs(own - ax) > expansion.ANCHOR_SLACK:
            ax = own
        log.append(f"{sh['id']}: slot 1 {box['floor'] - box['top']} px tall, feet x {ax:.1f}"
                   + (" (the spec's)" if "feet_x" in sh else "") + f", floor {fy:.0f}")
        per_slot = sh.get("register") == "slots"
        anchors = {}
        for i, sl in enumerate(slots, start=1):
            if not per_slot:
                anchors[i] = ax
                continue
            sax, _, _ = scenes.amr_place(sl[..., 3], REFINED_STANCE)
            sown = expansion.own_feet_x(sl)
            anchors[i] = sown if sown is not None and abs(sown - sax) > expansion.ANCHOR_SLACK else sax
        if per_slot:
            log.append(f"{sh['id']}: each slot on his own feet line, "
                       + ", ".join(f"{i}:{anchors[i] - ax:+.0f}" for i in sorted(anchors)) + " px from slot 1")
        for r, c, slot in sh["cells"]:
            cell = packs.register(Image.fromarray(slots[slot - 1]), scale, anchors[slot], fy, 1)
            edges = packs.overflow(cell)
            if edges:
                notes.append(f"{sh['id']} slot {slot} touches the cell's {', '.join(edges)} edge")
            a = np.array(cell)
            if (a[: packs.HEADROOM, :, 3] > 8).any():
                notes.append(f"{sh['id']} slot {slot} rises into the rows the live cell doesn't have (cut off)")
            live = cell.crop((0, packs.HEADROOM, grid["cellW"], packs.HEADROOM + grid["cellH"]))
            sheet.alpha_composite(live, (c * grid["cellW"], r * grid["cellH"]))
    return sheet, notes, log


def write(sheet: Image.Image) -> str:
    data = packs.webp_bytes(sheet)
    name = f"amr.{hashlib.sha256(data).hexdigest()[:8]}.webp"
    for old in packs.PUBLIC.glob("amr.*.webp"):
        if re.fullmatch(r"amr\.[0-9a-f]{8}\.webp", old.name) and old.name != name:
            old.unlink()
    (packs.PUBLIC / name).write_bytes(data)
    text = ASSET_TS.read_text(encoding="utf-8")
    text = re.sub(r'MASCOT_SPRITE_URL = "/mascot/amr\.[0-9a-f]{8}\.webp"', f'MASCOT_SPRITE_URL = "/mascot/{name}"', text)
    write_text(ASSET_TS, text)
    return name


def write_preview(new: Image.Image, out: Path) -> None:
    """live-old-new.png: each row of the shipped (old) sheet above the new one, light ground."""
    out.mkdir(parents=True, exist_ok=True)
    old = Image.open(packs.PUBLIC / Path(shipped_url()).name).convert("RGBA")
    w, h = new.size
    img = Image.new("RGBA", (w, h * 2 + 22 * 11), (245, 242, 235, 255))
    d = ImageDraw.Draw(img)
    ch = h // 11
    for r in range(11):
        y = r * (ch * 2 + 22)
        d.text((4, y + 4), f"row {r}: shipped above, new below", fill=(0, 0, 0, 255))
        img.alpha_composite(old.crop((0, r * ch, w, (r + 1) * ch)), (0, y + 22))
        img.alpha_composite(new.crop((0, r * ch, w, (r + 1) * ch)), (0, y + 22 + ch))
    img.convert("RGB").save(out / "live-old-new.png")


def folder_arg(args: list[str]) -> Path | None:
    skip = {i + 1 for i, a in enumerate(args) if a == "--preview"}
    for i, a in enumerate(args):
        if i not in skip and not a.startswith("-"):
            return Path(a)
    return None


def main() -> None:
    args = sys.argv[1:]
    if "-h" in args or "--help" in args:
        raise SystemExit(__doc__)
    s = spec()
    problems = coverage_problems(s)
    src = folder_arg(args)
    if "--check" in args:
        if not (packs.PUBLIC / Path(shipped_url()).name).exists():
            problems.append(f"{shipped_url()} is missing")
        if src is not None and not problems:
            sheet, _, _ = build(src, s, record=False)
            data = packs.webp_bytes(sheet)
            if f"amr.{hashlib.sha256(data).hexdigest()[:8]}.webp" != Path(shipped_url()).name:
                problems.append("the shipped live sheet isn't the one these sheets make")
        if problems:
            raise SystemExit("\n".join(problems))
        print("live-sheet spec covers every cell" + (" and the shipped sheet matches the sheets" if src else ""))
        return
    if problems:
        raise SystemExit("\n".join(problems))
    if src is None:
        raise SystemExit(__doc__)
    record = "--record" in args
    sheet, notes, log = build(src, s, record)
    for line in log:
        print(line)
    for n in notes:
        print("note:", n)
    if "--preview" in args:
        write_preview(sheet, Path(args[args.index("--preview") + 1]))
    if record:
        write_text(SPEC, json.dumps(s, indent=2, ensure_ascii=False) + "\n")
        print(f"recorded the approved hashes in {SPEC.relative_to(packs.ROOT)}")
    name = write(sheet)
    print(f"live sheet: {name} ({(packs.PUBLIC / name).stat().st_size // 1024} KB); MASCOT_SPRITE_URL updated")


if __name__ == "__main__":
    main()
