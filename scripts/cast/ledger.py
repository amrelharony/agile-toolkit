"""The private ledgers and folders of the cast sources (docs/cast/CAST-BUILD.md).

    ledger/received.jsonl    one row per return and per image taken in
    ledger/approvals.jsonl   one row per approval, bound to the sha256 it approves
    accepted/AAW-NN/         the current file of each image (highest -vN wins)

A row is never rewritten: a changed file simply no longer matches its approval.
"""

from __future__ import annotations

import datetime as dt
import json
import shutil
from pathlib import Path

from . import imaging as im
from .spec import parse_image_name


def today() -> str:
    return dt.date.today().isoformat()


def now() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def received_path(sources: Path) -> Path:
    return Path(sources) / "ledger" / "received.jsonl"


def approvals_path(sources: Path) -> Path:
    return Path(sources) / "ledger" / "approvals.jsonl"


def append(path: Path, row: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def read(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def accepted_dir(sources: Path, cid: str) -> Path:
    return Path(sources) / "accepted" / cid


def accepted_file(sources: Path, cid: str, image: str) -> Path | None:
    """The current file for an image: the highest -vN among the accepted copies."""
    d = accepted_dir(sources, cid)
    if not d.is_dir():
        return None
    best = None
    for p in d.iterdir():
        got = parse_image_name(p.name) if p.is_file() else None
        if got and got[0] == cid and got[1] == image and (best is None or got[2] > best[0]):
            best = (got[2], p)
    return best[1] if best else None


def accept(sources: Path, cid: str, src: Path, name: str | None = None) -> tuple[Path, Path | None]:
    """Copy src into accepted/<id>/ under its name (or `name`). A different file
    already under that name moves to accepted/<id>/_old/<date>/ first. (dest,
    superseded)."""
    d = accepted_dir(sources, cid)
    d.mkdir(parents=True, exist_ok=True)
    dest = d / (name or src.name)
    old = None
    if dest.exists():
        if im.sha256_file(dest) == im.sha256_file(src):
            return dest, None
        keep = d / "_old" / today()
        keep.mkdir(parents=True, exist_ok=True)
        old = keep / dest.name
        n = 2
        while old.exists():
            old = keep / f"{dest.stem}.{n}{dest.suffix}"
            n += 1
        shutil.move(str(dest), str(old))
    shutil.copy2(src, dest)
    return dest, old


def approvals_for(sources: Path, cid: str, image: str) -> list[dict]:
    return [r for r in read(approvals_path(sources)) if r.get("id") == cid and r.get("image") == image]


def approval_of(sources: Path, cid: str, image: str, sha: str, by: str | None = None) -> dict | None:
    """The approval row for exactly this file (sha), by `by` when given."""
    for r in reversed(approvals_for(sources, cid, image)):
        if r.get("sha256") == sha and (by is None or r.get("by") == by):
            return r
    return None
