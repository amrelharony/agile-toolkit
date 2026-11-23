"""
Take in a refined Amr sprite release: check every sheet against the release's own
manifest and copy the sheets out to a build folder.

    python -I scripts/intake-refined-sprites.py <release zip> <out folder> [--record <json>]

The two releases of 13 November 2026 are Amr_Refined_Original_124.zip (S01-S114 and
N01-N10, every Amr redrawn whole from the approved standing master) and
Amr_Refined_Expansion_124.zip (X001-X124, new story families, with catalog.json).

Each sheet in the zip's manifest.json must be present with exactly the manifest's
sha256, 1536 x 1024 RGBA; the sheets are written to <out folder> under their own
file names (an identical file already there is left alone). An expansion release
also gets its catalog.json copied there, for scripts/build-expansion-spec.py.

--record writes a small JSON of what was taken in (release, date, each sheet's
file and sha256), committed under docs/mascot so a rebuild can tell which art it
is meant to use. The source PNGs themselves never ship.

Needs Pillow only.
"""

import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

from PIL import Image

sys.dont_write_bytecode = True


def main(args: list[str]) -> None:
    if len(args) < 2:
        raise SystemExit(__doc__)
    src, out = Path(args[0]), Path(args[1])
    record = Path(args[args.index("--record") + 1]) if "--record" in args else None
    z = zipfile.ZipFile(src)
    top = next(n.split("/")[0] for n in z.namelist() if n.endswith("/manifest.json"))
    manifest = json.loads(z.read(f"{top}/manifest.json"))
    out.mkdir(parents=True, exist_ok=True)
    taken, wrote = {}, 0
    for sheet in manifest["sheets"]:
        sid, name, want = sheet["sheet_id"], sheet["filename"], sheet["sha256"]
        data = z.read(f"{top}/{sheet['sheet_path']}")
        got = hashlib.sha256(data).hexdigest()
        if got != want:
            raise SystemExit(f"{sid}: {name} is not the file the manifest lists ({got[:12]} vs {want[:12]})")
        im = Image.open(io.BytesIO(data))
        if im.size != (1536, 1024) or im.mode != "RGBA":
            raise SystemExit(f"{sid}: {name} is {im.size} {im.mode}, not 1536 x 1024 RGBA")
        dest = out / name
        if not dest.exists() or hashlib.sha256(dest.read_bytes()).hexdigest() != got:
            dest.write_bytes(data)
            wrote += 1
        taken[sid] = {"file": name, "sha256": got}
    expected = manifest.get("expected_ids") or []
    missing = sorted(set(expected) - set(taken))
    if missing:
        raise SystemExit(f"the manifest expects sheets it doesn't list: {', '.join(missing)}")
    catalog = f"{top}/catalog.json"
    if catalog in z.namelist():
        data = z.read(catalog)
        want = manifest.get("catalog_sha256")
        if want and hashlib.sha256(data).hexdigest() != want:
            raise SystemExit("catalog.json is not the one the manifest lists")
        (out / "catalog.json").write_bytes(data)
    print(f"{src.name}: {len(taken)} sheets checked, {wrote} written to {out}")
    if record:
        record.write_text(json.dumps({
            "release": src.name,
            "schema": manifest.get("schema"),
            "created_at_utc": manifest.get("created_at_utc"),
            "status": manifest.get("status"),
            "sheets": taken,
        }, indent=1) + "\n", encoding="utf-8")
        print(f"recorded in {record}")


if __name__ == "__main__":
    main(sys.argv[1:])
