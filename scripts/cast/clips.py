"""The runtime's moves (src/lib/cast/clips.ts), as the builder needs them: which
sockets each clip turns and which swaps it shows, read straight from the
TypeScript through Node's type stripping, so the two never drift.

    load(path)              {"clips": {id: {"ms", "main", "first", "armless"}}, "maxMs",
                             "slides", "springs"}: each layer {"tracks": [socket | "pupils"],
                            "swaps": ["slot.choice"]}; slides {id: [[socket, ease, x, y]]},
                            each track that slides a part, x and y its farthest keys in
                            CSS px; springs {ease: how far past its key it carries a part}
    slides(clips, played)   (clip, socket, x, y) at each played slide's peak, in CSS px
    elements(man)           how many rendered elements each socket names (data-socket),
                            and the pupils
    animated(man, clips)    the most elements life moves at once on this rig
    unplayable(man, clips)  the rig's tap moves that move nothing on it

A clip moves every element whose data-socket is a track's socket (life.ts), and
"pupils" moves every pupil the figure draws. life moves either the look (the
head, the body and the pupils, toward the pointer) or one clip, never both: the
look waits while a clip plays. A rig plays the idle and guess clips and its own
tap moves, each counted with its `first` and `armless` layers
(src/lib/cast/rig-types.ts `counts`), as the runtime's rig check counts them.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path

from .spec import ROOT

CLIPS_TS = ROOT / "src" / "lib" / "cast" / "clips.ts"
# Run by Node with the module's file URL in CAST_CLIPS_URL; prints the table as JSON.
# The settle and pop eases are the damped springs of src/lib/motion/tokens.ts: from
# rest, one passes its key by exp(-zeta pi / sqrt(1 - zeta^2)) of the step.
READ = """
const m = await import(process.env.CAST_CLIPS_URL);
const t = await import(new URL("../motion/tokens.ts", process.env.CAST_CLIPS_URL).href);
const layer = (l) =>
  l ? { tracks: l.tracks.map((t) => t.socket), swaps: (l.swaps ?? []).map((s) => s.key) } : null;
const far = (keys, axis) => keys.reduce((a, k) => (Math.abs(k[axis] ?? 0) > Math.abs(a) ? k[axis] : a), 0);
const clips = {};
const slides = {};
for (const [id, c] of Object.entries(m.CLIPS)) {
  clips[id] = { ms: c.ms, main: layer(c), first: layer(c.first), armless: layer(c.armless) };
  for (const l of [c, c.first, c.armless]) {
    for (const tr of l ? l.tracks : []) {
      if (tr.socket === "pupils" || !tr.keys.some((k) => k.x !== undefined || k.y !== undefined)) continue;
      (slides[id] ??= []).push([tr.socket, tr.ease, far(tr.keys, "x"), far(tr.keys, "y")]);
    }
  }
}
const past = (s) => {
  const z = t.dampingRatio(s);
  return z < 1 ? Math.exp((-z * Math.PI) / Math.sqrt(1 - z * z)) : 0;
};
const springs = { settle: past(t.SETTLE_SPRING), pop: past(t.POP_SPRING) };
process.stdout.write(JSON.stringify({ clips, maxMs: m.LIMITS.maxMs, slides, springs }));
"""


@lru_cache(maxsize=4)
def load(path: Path = CLIPS_TS) -> dict:
    path = Path(path)
    if not path.exists():
        raise SystemExit(f"{path} is not in the tree: the candidate counts a rig's moves from the runtime's clips")
    node = shutil.which("node")
    if node is None:
        raise SystemExit("node is not on PATH: the candidate reads src/lib/cast/clips.ts through it")
    env = {**os.environ, "CAST_CLIPS_URL": path.resolve().as_uri()}
    res = subprocess.run(
        [node, "--no-warnings", "--input-type=module", "-e", READ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
        timeout=120,
    )
    if res.returncode != 0:
        raise SystemExit(f"reading {path.name} through node failed: {res.stderr.strip()[:400]}")
    return json.loads(res.stdout)


def _groups(slot: dict) -> int:
    return len({ch.get("z", slot.get("z", 0)) for ch in slot["choices"]})


def elements(man: dict) -> dict:
    """{socket: elements with that data-socket, "pupils": pupils drawn}, as
    CastFigure renders the rig: a socketed part is one span; an arm or fan slot
    is one span per z group of its choices; the eyes and mouth move with their
    host and carry no socket."""
    pup = man.get("pupils")
    pup_ids = set(pup["ids"]) if pup else set()
    out: dict = {}
    for p in man["parts"]:
        if p.get("socket") and p["id"] not in pup_ids:
            out[p["socket"]] = out.get(p["socket"], 0) + 1
    for s in man["swaps"]:
        if s["id"] not in ("eyes", "mouth"):
            out[s["id"]] = out.get(s["id"], 0) + _groups(s)
    eyes = next((s for s in man["swaps"] if s["id"] == "eyes"), None)
    if pup and eyes:
        shown = sum(ch["id"] in pup["shownWith"] for ch in eyes["choices"])
        out["pupils"] = shown * len(pup_ids & {p["id"] for p in man["parts"]})
    return out


# What the look turns toward the pointer (life.ts), all at once.
LOOK = ("head", "body", "pupils")


def _layers(clip: dict) -> list[dict]:
    """A clip's layers as the count takes them: its own, the first speaker's and
    the armless one (each may play with it; counting them all never undercounts)."""
    return [lay for lay in (clip["main"], clip.get("first"), clip.get("armless")) if lay]


def played(man: dict, clips: dict) -> list[str]:
    """The clips this rig plays: the idle and guess clips, and its tap moves."""
    return [cid for cid in clips["clips"] if not cid.startswith("sig.")] + [s for s in man["signature"] if s in clips["clips"]]


def animated(man: dict, clips: dict) -> int:
    n = elements(man)
    best = sum(n.get(s, 0) for s in LOOK)
    for cid in played(man, clips):
        socks = {t for lay in _layers(clips["clips"][cid]) for t in lay["tracks"]}
        best = max(best, sum(n.get(s, 0) for s in socks))
    return best


def slides(clips: dict, played: list[str]) -> list[tuple[str, str, float, float]]:
    """(clip, socket, x, y) for each track of a played clip that slides a part, at its
    peak: its farthest key carried past by its ease's spring (calm and the idle sine
    never pass a key), in CSS px."""
    out = []
    for cid in played:
        for sock, ease, x, y in clips.get("slides", {}).get(cid, []):
            k = 1 + clips.get("springs", {}).get(ease, 0)
            out.append((cid, sock, x * k, y * k))
    return out


def unplayable(man: dict, clips: dict) -> list[str]:
    """The tap moves that aren't clips, run past the clip cap, or move nothing on
    this rig (no socket of theirs is drawn and no swap of theirs is a choice)."""
    n = elements(man)
    choices = {f"{s['id']}.{ch['id']}" for s in man["swaps"] for ch in s["choices"]}
    out = []
    for sid in man["signature"]:
        clip = clips["clips"].get(sid)
        if clip is None:
            out.append(f"{sid}: no such clip")
            continue
        if clip["ms"] > clips["maxMs"]:
            out.append(f"{sid}: {clip['ms']} ms, over {clips['maxMs']}")
        lays = _layers(clip)
        moves = any(n.get(t, 0) for lay in lays for t in lay["tracks"])
        shows = any(k in choices for lay in lays for k in lay["swaps"])
        if not moves and not shows:
            out.append(f"{sid}: moves nothing on this rig")
    return out
