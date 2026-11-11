"""The public half of the cast puppet spec, as the builder reads it.

Everything numeric the checks compare against comes from docs/cast/cast-rig.json:
`TOL` is its `tolerances` block, `RANGES` its joint ranges, `PACK` its atlas
settings and `BUDGETS` its byte and node caps. No module keeps a threshold of its
own (test_cast_spec.py holds that line).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC_PATH = ROOT / "docs" / "cast" / "cast-rig.json"
DEFAULT_SOURCES = Path("D:/Claude Desktop/Agile_At_Work_Cast_Sources")
BRIEF_BLOCKS = ROOT / "scripts" / "cast" / "brief-blocks.mjs"
BUILDER_VERSION = 1

# docs/cast/CAST-BUILD.md "Taking a return in": the only names intake keeps as named.
NAME_RE = re.compile(
    r"^AAW-(0[1-9]|[12][0-9]|30)_(master|parts|parts2|face|face2|arms)(-v[0-9]+)?\.png$"
)
ID_RE = re.compile(r"AAW-(0[1-9]|[12][0-9]|30)")
IMAGES = ("master", "parts", "parts2", "face", "face2", "arms")

# How many cells the brief asks for (scripts/cast/brief-blocks.mjs: imageFace
# "eight times", imageFace2 "two times", imageArms "Eight whole arms",
# imageArmsAmr "four whole arms"); test_cast_spec.py reads the brief to hold it.
FACE_CELLS = 8
FACE2_CELLS = 2
ARM_CELLS = 8
AMR = "AAW-01"
AMR_ARM_CELLS = 4

# What each face cell is, in the brief's order (imageFace / imageFace2).
FACE_STATES = (
    ("eyes", "open"),
    ("eyes", "closed"),
    ("eyes", "happy"),
    ("eyes", "wide"),
    ("mouth", "rest"),
    ("mouth", "smile"),
    ("mouth", "open"),
    ("mouth", "o"),
)
FACE2_STATES = (("eyes", "curious"), ("mouth", "talk"))
# The arm cells (imageArms / imageArmsAmr): (slot, pose), reading order.
ARM_POSES = (
    ("arm-r", "wave"),
    ("arm-r", "up"),
    ("arm-r", "open"),
    ("arm-r", "point"),
    ("arm-l", "up"),
    ("arm-l", "open"),
    ("arm-l", "chin"),
    ("arm-l", "sig"),
)
AMR_ARM_POSES = (("arm-r", "wave"), ("arm-r", "up"), ("arm-r", "open"), ("arm-l", "up"))


def load_spec(path: Path = SPEC_PATH) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


SPEC = load_spec()
TOL: dict = SPEC["tolerances"]
RANGES: dict = SPEC["ranges"]
PACK: dict = SPEC["pack"]
BUDGETS: dict = SPEC["budgets"]
KEYS: dict = SPEC["keys"]


def character(cid: str, spec: dict | None = None) -> dict:
    for c in (spec or SPEC)["characters"]:
        if c["id"] == cid:
            return c
    raise KeyError(f"unknown character {cid}")


def batch_of(cid: str, spec: dict | None = None) -> str:
    for b, ids in (spec or SPEC)["batches"].items():
        if cid in ids:
            return b
    raise KeyError(f"{cid} is in no batch")


def targets(arg: str, spec: dict | None = None) -> list[str]:
    """`AAW-NN`, a batch letter `A`..`E` or `all` → character ids, in spec order."""
    spec = spec or SPEC
    ids = [c["id"] for c in spec["characters"]]
    if arg == "all":
        return ids
    if arg in spec["batches"]:
        return list(spec["batches"][arg])
    if arg in ids:
        return [arg]
    raise SystemExit(f"not a character, batch or 'all': {arg}")


def key_name(c: dict) -> str:
    return c.get("key") or "magenta"


def key_rgb(c: dict) -> tuple[int, int, int]:
    h = KEYS[key_name(c)].lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def cell_count(c: dict, image: str) -> int:
    """How many separate drawings an image holds for this character."""
    if image == "master":
        return 1
    if image in ("parts", "parts2"):
        return len(c.get(image) or [])
    if image == "face":
        return FACE_CELLS
    if image == "face2":
        return FACE2_CELLS
    if image == "arms":
        return AMR_ARM_CELLS if c["id"] == AMR else ARM_CELLS
    raise KeyError(image)


def arm_poses(c: dict) -> tuple:
    return AMR_ARM_POSES if c["id"] == AMR else ARM_POSES


def is_complex(cid: str) -> bool:
    return cid in BUDGETS["complex"]


def range_for(part_id: str) -> int:
    """The joint range in degrees a part may turn (0 = it never turns)."""
    base = re.sub(r"-(r|l|\d+|f[rl]|h[rl]|mid-[rl]|open|closed)$", "", part_id)
    if base.startswith("leg"):
        base = "leg"
    if part_id.startswith("limb"):
        base = "limb"
    if part_id.startswith("fan"):
        base = "fan"
    return int(RANGES.get(base, 0))


def parse_image_name(name: str) -> tuple[str, str, int] | None:
    """'AAW-04_parts-v2.png' → ('AAW-04', 'parts', 2); None when the name isn't one."""
    m = NAME_RE.match(name)
    if not m:
        return None
    stem = name[: -len(".png")]
    cid, rest = stem.split("_", 1)
    image, _, ver = rest.partition("-v")
    return cid, image, int(ver) if ver else 1
