"""
Put the single-slot corrections (docs/mascot/refined-patches.json) into a folder of
refined source sheets, so the next build uses the corrected art.

    python -I scripts/patch-refined-slots.py <sheets folder> <cells folder> [--record]

Each patch names a sheet of the refined release, one of its eight 384 x 512 slots and
a corrected cell PNG of exactly that size, redrawn whole (a new frame, not a touch-up).
The cell must match its sha256 in the record and keep clear of its edges. The sheet
must be the release's own (its sha256 in docs/mascot/refined-original-release.json)
or already patched; the slot is replaced outright, pixels and alpha, and the sheet
is written back in place. A patched sheet is told by its pixels (pixels_sha256: the
sha256 of its RGBA bytes), not its PNG bytes, which depend on the encoder.

--record writes each patched sheet's pixels_sha256 into the record (for a new patch).
scripts/build-mascot-packs.py refuses a folder whose patched sheets aren't patched.

Needs Pillow and numpy only. The cells, like the sheets, never ship.
"""

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parent.parent
RECORD = ROOT / "docs" / "mascot" / "refined-patches.json"
RELEASE = ROOT / "docs" / "mascot" / "refined-original-release.json"
SLOT_W, SLOT_H = 384, 512


def pixels_sha(img: Image.Image) -> str:
    return hashlib.sha256(np.ascontiguousarray(np.array(img.convert("RGBA"))).tobytes()).hexdigest()


def write_text(path: Path, text: str) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    tmp.replace(path)


def main(args: list[str]) -> None:
    if len(args) < 2:
        raise SystemExit(__doc__)
    sheets, cells = Path(args[0]), Path(args[1])
    record = json.loads(RECORD.read_text(encoding="utf-8"))
    release = json.loads(RELEASE.read_text(encoding="utf-8"))["sheets"]
    for p in record["patches"]:
        path = sheets / p["file"]
        cell_path = cells / p["cell"]
        data = cell_path.read_bytes()
        if hashlib.sha256(data).hexdigest() != p["cell_sha256"]:
            raise SystemExit(f"{p['cell']}: not the recorded cell (sha256 differs)")
        cell = Image.open(cell_path)
        if cell.mode != "RGBA" or cell.size != (SLOT_W, SLOT_H):
            raise SystemExit(f"{p['cell']}: expected a {SLOT_W} x {SLOT_H} RGBA cell, got {cell.size} {cell.mode}")
        a = np.array(cell)[..., 3] > 8
        if a[0].any() or a[-1].any() or a[:, 0].any() or a[:, -1].any():
            raise SystemExit(f"{p['cell']}: the drawing touches the cell's edge")
        sheet = Image.open(path)
        done = p.get("pixels_sha256")
        if done and pixels_sha(sheet) == done:
            print(f"{p['sheet']} slot {p['slot']} ({p['frame']}): already patched")
            continue
        if hashlib.sha256(path.read_bytes()).hexdigest() != release[p["sheet"]]["sha256"]:
            raise SystemExit(f"{p['file']}: neither the release's sheet nor the patched one")
        sheet = sheet.convert("RGBA")
        i = p["slot"] - 1
        x, y = (i % 4) * SLOT_W, (i // 4) * SLOT_H
        arr = np.array(sheet)
        arr[y:y + SLOT_H, x:x + SLOT_W] = np.array(cell.convert("RGBA"))
        patched = Image.fromarray(arr)
        got = pixels_sha(patched)
        if done and got != done:
            raise SystemExit(f"{p['sheet']}: the patched pixels aren't the recorded ones")
        tmp = path.with_name(path.stem + ".tmp.png")
        patched.save(tmp, optimize=True)
        tmp.replace(path)
        p["pixels_sha256"] = got
        print(f"{p['sheet']} slot {p['slot']} ({p['frame']}): patched")
    if "--record" in args:
        write_text(RECORD, json.dumps(record, indent=2, ensure_ascii=False) + "\n")
        print("recorded", RECORD.relative_to(ROOT))


if __name__ == "__main__":
    main(sys.argv[1:])
