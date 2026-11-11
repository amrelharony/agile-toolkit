"""Taking a return in (docs/cast/CAST-BUILD.md, step 1).

    intake(src, sources)   src is ChatGPT's zip, a folder of PNGs or one PNG

1. The return is archived untouched in returns/<date>-<stem>/original/.
2. Only PNG images are read from it, by name, as bytes (a zip member is never
   extracted to disk by the zip library, never opened as anything but an image,
   and nothing from it ever runs). Names matching the regex in CAST-BUILD.md are
   kept as they are; any other PNG is sorted by what it holds (one figure, a face
   sheet's heads, a grid of arms, the pieces) and given its proper name. Both go
   into a new returns/<date>-<stem>/extracted/ folder.
3. Every image gets a row in ledger/received.jsonl (sha256, bytes, size, brief
   version, where it came from) and is copied into accepted/<id>/.
4. It prints found / missing / sorted by content / extra, per character.
"""

from __future__ import annotations

import hashlib
import io
import shutil
import zipfile
from pathlib import Path, PurePosixPath

import numpy as np
from PIL import Image

from . import imaging as im
from . import ledger, parts
from .spec import ID_RE, NAME_RE, SPEC, character, key_rgb, parse_image_name

MAX_MEMBER_BYTES = 64 << 20  # far over any 1536 x 1024 PNG: bigger members are not read


def _digest_folder(folder: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(folder.rglob("*")):
        if p.is_file():
            h.update(p.relative_to(folder).as_posix().encode() + b"\0" + im.sha256_file(p).encode())
    return h.hexdigest()


def _unique(path: Path) -> Path:
    if not path.exists():
        return path
    n = 2
    while (path.parent / f"{path.name}-{n}").exists():
        n += 1
    return path.parent / f"{path.name}-{n}"


def _members(archived: Path) -> tuple[list[tuple[str, str, bytes]], list[tuple[str, str]]]:
    """([(path inside the return, base name, bytes)] for PNG-named files, [(path,
    why skipped)] for the rest)."""
    found, skipped = [], []
    if archived.is_file() and zipfile.is_zipfile(archived):
        with zipfile.ZipFile(archived) as z:
            for info in z.infolist():
                if info.is_dir():
                    continue
                inner = info.filename.replace("\\", "/")
                base = PurePosixPath(inner).name
                if not base.lower().endswith(".png"):
                    skipped.append((inner, "not a PNG"))
                elif info.flag_bits & 0x1:
                    skipped.append((inner, "encrypted"))
                elif info.file_size > MAX_MEMBER_BYTES:
                    skipped.append((inner, "too big to be one image"))
                else:
                    found.append((inner, base, z.read(info)))
    elif archived.is_dir():
        for p in sorted(archived.rglob("*")):
            if not p.is_file():
                continue
            inner = p.relative_to(archived).as_posix()
            if not p.name.lower().endswith(".png"):
                skipped.append((inner, "not a PNG"))
            elif p.stat().st_size > MAX_MEMBER_BYTES:
                skipped.append((inner, "too big to be one image"))
            else:
                found.append((inner, p.name, p.read_bytes()))
    else:
        found.append((archived.name, archived.name, archived.read_bytes()))
    return found, skipped


def _decode(data: bytes) -> tuple[np.ndarray, list[int]] | None:
    if not im.is_png_bytes(data):
        return None
    try:
        with Image.open(io.BytesIO(data)) as probe:
            probe.verify()
        with Image.open(io.BytesIO(data)) as img:
            return np.array(img.convert("RGBA")), list(img.size)
    except Exception:  # a broken or hostile file is reported, never trusted
        return None


def intake(src: Path, sources: Path, cid: str | None = None, date: str | None = None, out=print) -> dict:
    src = Path(src)
    sources = Path(sources)
    if not src.exists():
        raise SystemExit(f"no such return: {src}")
    if src.is_file() and not zipfile.is_zipfile(src) and src.suffix.lower() != ".png":
        raise SystemExit(f"not a zip, a folder or a PNG: {src}")
    if cid is not None:
        character(cid)
    date = date or ledger.today()
    rec = ledger.received_path(sources)
    ret_sha = im.sha256_file(src) if src.is_file() else _digest_folder(src)
    for r in ledger.read(rec):
        if r.get("kind") == "return" and r.get("sha256") == ret_sha:
            out(f"already taken in: {src.name} is returns/{r['folder']} ({r['date']}); nothing to do")
            return {"folder": r["folder"], "images": [], "repeat": True}

    stem = src.stem if src.is_file() else src.name
    folder = _unique(sources / "returns" / f"{date}-{stem}")
    original = folder / "original"
    original.mkdir(parents=True)
    archived = original / src.name
    if src.is_dir():
        shutil.copytree(src, archived)
    else:
        shutil.copy2(src, archived)
    extracted = folder / "extracted"
    extracted.mkdir()

    found, skipped = _members(archived)
    extra = list(skipped)
    whose_default = cid or (ID_RE.search(stem).group(0) if ID_RE.search(stem) else None)
    taken: dict[str, dict] = {}  # name in extracted/ → ledger row
    sorted_rows = []
    seen_base = set()

    def take(name: str, data: bytes, size, inner: str, how: str, reason: str = "") -> None:
        got = parse_image_name(name)
        (extracted / name).write_bytes(data)
        taken[name] = {
            "kind": "image",
            "id": got[0],
            "image": got[1],
            "version": got[2],
            "file": name,
            "sha256": im.sha256_bytes(data),
            "bytes": len(data),
            "size": size,
            "date": date,
            "brief_version": SPEC["brief_version"],
            "return": folder.name,
            "from": inner,
            "sorted": how,
            **({"reason": reason} if reason else {}),
        }

    loose = []
    for inner, base, data in found:
        decoded = _decode(data)
        if decoded is None:
            extra.append((inner, "not a readable PNG"))
            continue
        if base in seen_base:
            extra.append((inner, "same name twice in the return"))
            continue
        seen_base.add(base)
        if NAME_RE.match(base):
            got = parse_image_name(base)
            if got[1] not in character(got[0])["images"]:
                extra.append((inner, f"{got[0]} has no {got[1]} image"))
                continue
            take(base, data, decoded[1], inner, "name")
        else:
            loose.append((inner, base, data, decoded))

    for inner, base, data, (rgba, size) in loose:
        m = ID_RE.search(inner)
        whose = m.group(0) if m else whose_default
        if whose is None:
            extra.append((inner, "a PNG with no AAW-NN in its name or folder: pass --id"))
            continue
        c = character(whose)
        image, reason, _ = parts.sort_image(c, rgba, key_rgb(c))
        if image is None:
            extra.append((inner, reason))
            continue
        name = f"{whose}_{image}.png"
        k = 2
        dup = False
        while name in taken:
            name = f"{whose}_{image}-v{k}.png"
            k += 1
            dup = True
        take(name, data, size, inner, "content", reason + (" (another file is this image too)" if dup else ""))
        sorted_rows.append((inner, name, reason, dup))

    for row in taken.values():
        ledger.append(rec, row)
    ledger.append(
        rec,
        {
            "kind": "return",
            "sha256": ret_sha,
            "name": src.name,
            "folder": folder.name,
            "date": date,
            "images": len(taken),
        },
    )
    superseded = []
    for name, row in sorted(taken.items()):
        _, old = ledger.accept(sources, row["id"], extracted / name)
        if old:
            superseded.append((name, old))

    ids = sorted({r["id"] for r in taken.values()} | ({whose_default} if whose_default else set()))
    report = {"folder": folder.name, "images": sorted(taken), "extra": extra, "sorted": sorted_rows, "per": {}}
    out(f"return {src.name} -> returns/{folder.name}")
    for i in ids:
        c = character(i)
        here = sorted({r["image"] for r in taken.values() if r["id"] == i}, key=c["images"].index)
        have = [img for img in c["images"] if ledger.accepted_file(sources, i, img)]
        missing = [img for img in c["images"] if img not in have]
        report["per"][i] = {"found": here, "missing": missing}
        out(f"  {i} {c['name']}: found {', '.join(here) or 'nothing'}; still missing {', '.join(missing) or 'nothing'}")
    if sorted_rows:
        out("  sorted by content (confirm before approving):")
        for inner, name, reason, dup in sorted_rows:
            out(f"    {inner} -> {name}  ({reason}){'  DUPLICATE' if dup else ''}")
    for name, old in superseded:
        out(f"  {name} replaces an earlier copy, kept as {old.relative_to(sources).as_posix()}")
    if extra:
        out("  extra (not taken in):")
        for inner, why in extra:
            out(f"    {inner}: {why}")
    return report
