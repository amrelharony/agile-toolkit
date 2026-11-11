"""Packs the cast brief into batch zips and makes the prompt page's thumbnails.

    python -I scripts/cast/make-batches.py <batches dir> [--page <page dir>] [--desktop <dir>]

Reads <batches dir>/batch-plan.json, written by scripts/build-cast-brief.mjs
--batches. For each batch it builds AAW_Cast_Batch_<X>.zip holding README.txt and one
folder per character (CAST-AAW-NN.md, KICKOFF.txt and the reference pictures), then
copies the zips to --desktop when given. With --page it writes 240 px thumbnails of
every reference into <page dir>/thumbs/ for the prompt page.

The zips hold the bible's canon: they live in the private sources folder and on the
owner's Desktop, never in git.
"""
import json
import shutil
import sys
import zipfile
from pathlib import Path

sys.dont_write_bytecode = True

from PIL import Image


def arg(name):
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return None


def main():
    batches = Path(sys.argv[1])
    plan = json.loads((batches / "batch-plan.json").read_text(encoding="utf-8"))
    page = arg("--page")
    desktop = arg("--desktop")
    made = []
    for b, chars in plan["batches"].items():
        zpath = batches / f"AAW_Cast_Batch_{b}.zip"
        with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("README.txt", plan["readme"].replace("\n", "\r\n"))
            for c in chars:
                folder = c["folder"]
                z.write(c["md"], f"{folder}/CAST-{c['id']}.md")
                z.write(c["kickoff"], f"{folder}/KICKOFF.txt")
                for ref in c["refs"]:
                    z.write(ref, f"{folder}/{Path(ref).name}")
                    if page:
                        thumb = Path(page) / "thumbs" / Path(ref).name
                        thumb.parent.mkdir(parents=True, exist_ok=True)
                        im = Image.open(ref).convert("RGB")
                        im.thumbnail((240, 240), Image.LANCZOS)
                        im.save(thumb, "JPEG", quality=82, optimize=True)
        made.append(zpath)
        print(zpath.name, zpath.stat().st_size, "bytes,", len(chars), "characters")
    if desktop:
        dest = Path(desktop)
        dest.mkdir(parents=True, exist_ok=True)
        (dest / "README.txt").write_text(plan["readme"].replace("\n", "\r\n"), encoding="utf-8", newline="")
        for z in made:
            shutil.copy2(z, dest / z.name)
        print("copied", len(made), "zips to", dest)


if __name__ == "__main__":
    main()
