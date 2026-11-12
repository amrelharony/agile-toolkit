"""The runtime's rig contract, for the builder's tests: test/cast/rig-manifest.test.tsx's
problems() in Python, and the shape of its synthetic fixtures (test/cast/fixtures/
rig-fixture.ts: made-up geometry, no canon), so the builder's manifest is held to
what CastFigure and life read.

    problems(rig, clips=None)   what the runtime's check would object to ([] when sound)
    TEST_PUPPET, ARMLESS_PUPPET the fixtures' parts and slots (CastFigure renders 42 and 27 nodes)
"""

from __future__ import annotations

import re

from cast.spec import node_cap

# clips.ts turnLimit(): the most a clip turns a socket, either way.
TURN = {
    "body": 4,
    "head": 10,
    "arm-r": 15,
    "arm-l": 15,
    "leg-r": 10,
    "leg-l": 10,
    "tail": 15,
    "ear-r": 12,
    "ear-l": 12,
    "tie": 8,
    "cord": 6,
    "flap": 20,
}


def turn_limit(socket: str) -> int:
    return 12 if socket.startswith("limb-") else TURN.get(socket, 10)


def problems(rig: dict, clips: dict | None = None) -> list[str]:
    out = []
    ids = [p["id"] for p in rig["parts"]]
    if rig["v"] != 1:
        out.append("version")
    if not re.match(r"^AAW-\d\d$", rig["id"]):
        out.append("id")
    roots = [p for p in rig["parts"] if p["parent"] is None]
    if len(roots) != 1 or roots[0].get("socket") != "body":
        out.append("one root, socket body")
    if len(set(ids)) != len(ids):
        out.append("part ids repeat")
    for i, p in enumerate(rig["parts"]):
        if p["parent"] is not None and p["parent"] not in ids[:i]:
            out.append(f"{p['id']}: parent first")
        if p.get("socket") and p["range"] > turn_limit(p["socket"]):
            out.append(f"{p['id']}: range")
    for slot in rig["swaps"]:
        if slot["on"] not in ids:
            out.append(f"{slot['id']}: rides on no part")
        choices = [c["id"] for c in slot["choices"]]
        if slot["rest"] not in choices:
            out.append(f"{slot['id']}: no rest choice")
        if len(set(choices)) != len(choices):
            out.append(f"{slot['id']}: choices repeat")
        if any(p["id"] == slot["id"] or p.get("socket") == slot["id"] for p in rig["parts"]):
            out.append(f"{slot['id']}: drawn as a part and a slot")
    pup = rig.get("pupils")
    if pup:
        eyes = next((s for s in rig["swaps"] if s["id"] == "eyes"), None)
        if eyes is None:
            out.append("pupils without eyes")
        for pid in pup["ids"]:
            part = next((p for p in rig["parts"] if p["id"] == pid), None)
            if part is None or part["parent"] != (eyes or {}).get("on"):
                out.append(f"{pid}: not on the eyes' host")
        for c in pup["shownWith"]:
            if not eyes or not any(x["id"] == c for x in eyes["choices"]):
                out.append(f"pupils shown with missing {c}")
    fewest = 0 if rig["id"] == "AAW-01" else 1  # Amr's tap move plays only in the intros
    if not fewest <= len(rig["signature"]) <= 2:
        out.append("one or two signature moves")
    for sid in rig["signature"]:
        # Without the clips (the runtime not in the tree), only the id's form is checked.
        clip = clips["clips"].get(sid) if clips else {"ms": 0}
        too_long = clips is not None and clip is not None and clip["ms"] > clips["maxMs"]
        if clip is None or not sid.startswith("sig.") or too_long:
            out.append(f"signature {sid}")
    # The runtime reads both caps from the spec: a complex rig's is the larger.
    if rig["counts"]["nodes"] > node_cap(rig["id"]):
        out.append("nodes")
    if rig["counts"]["animated"] > 10:
        out.append("animated")
    if not (rig["ratio"] > 0 and rig["heightVsAmr"] > 0):
        out.append("proportions")
    if "translucent" in rig and not 0 < rig["translucent"] < 1:
        out.append("translucent")
    return out


# ---------- the runtime's moves, in the form clips.load() reads them ----------


def _clip(ms, tracks, swaps=(), first=None, armless=None):
    def lay(t, s=()):
        return {"tracks": list(t), "swaps": list(s)}

    return {
        "ms": ms,
        "main": lay(tracks, swaps),
        "first": lay(*first) if first else None,
        "armless": lay(*armless) if armless else None,
    }


# The idle and guess clips and some tap moves of src/lib/cast/clips.ts, so the
# builder's tests run without the runtime in the tree (test_cast_manifest.py holds
# them equal to clips.ts when it is).
CLIPS = {
    "maxMs": 900,
    "clips": {
        "idle.breathe": _clip(4000, ["body"]),
        "idle.blink": _clip(5400, [], ["eyes.closed"]),
        "guess.matched": _clip(900, ["head"], ["eyes.happy", "mouth.smile"], first=(["body"], ["arm-r.up", "arm-l.up"])),
        "guess.differed": _clip(700, ["body"], ["eyes.wide", "mouth.o"]),
        "guess.skipped": _clip(700, ["body"], ["arm-r.open", "arm-l.open"], armless=(["head"],)),
        "sig.tail": _clip(800, ["tail"]),
        "sig.ears": _clip(600, ["ear-r", "ear-l"]),
        "sig.hop": _clip(600, ["body"]),
        "sig.nod": _clip(700, ["head"]),
        "sig.wave": _clip(900, ["arm-r"], ["arm-r.wave"]),
        "sig.chin": _clip(900, ["head"], ["arm-l.chin"]),
        "sig.fan": _clip(900, ["body"], ["fan.open"]),
        "sig.ripple": _clip(900, [f"limb-{i}" for i in range(1, 9)]),
        "sig.flap": _clip(700, ["flap"]),
        "sig.eyes": _clip(900, ["pupils"]),
    },
}


# ---------- the runtime's synthetic fixtures, as far as the counts need them ----------

S = {"bg": [100, 100, 0, 0]}  # a sprite; where it sits in the atlas doesn't count here


def _part(pid, parent, z, socket=None, sprite=S, rng=0):
    p = {"id": pid, "parent": parent, "box": [0, 0, 10, 10], "pivot": [50, 50], "z": z, "sprite": sprite, "range": rng}
    if socket:
        p["socket"] = socket
    return p


def _choice(cid, sprite=S, z=None):
    c = {"id": cid, "box": [0, 0, 100, 100], "sprite": sprite}
    if z is not None:
        c["z"] = z
    return c


def _slot(sid, on, z, rest, choices):
    return {"id": sid, "on": on, "box": [0, 0, 10, 10], "pivot": [50, 50], "z": z, "rest": rest, "choices": choices}


TEST_PUPPET = {
    "v": 1,
    "id": "AAW-90",
    "name": "Test Puppet",
    "family": "biped",
    "ratio": 0.5,
    "heightVsAmr": 0.9,
    "floor": 97,
    "atlas": {"x1": "", "x2": "", "bytes1": 0, "bytes2": 0},
    "parts": [
        _part("torso", None, 0, "body", rng=4),
        _part("head", "torso", 2, "head", rng=10),
        _part("pupil-r", "head", 1),
        _part("pupil-l", "head", 1),
        _part("tail", "torso", -1, "tail", rng=15),
        _part("leg-r", "torso", -2, "leg-r", rng=10),
        _part("leg-l", "torso", -2, "leg-l", rng=10),
        _part("cord", "torso", 3, "cord", rng=6),
        {**_part("glint", "torso", 4), "decor": True},
    ],
    "swaps": [
        _slot("eyes", "head", 1, "open", [_choice("open", None), _choice("closed"), _choice("happy"), _choice("wide")]),
        _slot("mouth", "head", 1, "rest", [_choice("rest", None), _choice("smile"), _choice("o")]),
        _slot("arm-r", "torso", 1, "rest", [_choice(c) for c in ("rest", "wave", "up", "open", "point")]),
        _slot("arm-l", "torso", 1, "rest", [_choice("rest"), _choice("up"), _choice("open"), _choice("chin", z=5), _choice("sig")]),
    ],
    "pupils": {"ids": ["pupil-r", "pupil-l"], "travel": [30, 20], "shownWith": ["open", "wide"]},
    "signature": ["sig.tail", "sig.wave"],
    "counts": {"nodes": 42, "animated": 6},
}

ARMLESS_PUPPET = {
    **TEST_PUPPET,
    "id": "AAW-91",
    "name": "Armless Puppet",
    "family": "quadruped",
    "parts": [p for p in TEST_PUPPET["parts"] if p["id"] != "glint"],
    "swaps": [s for s in TEST_PUPPET["swaps"] if s["id"] in ("eyes", "mouth")],
    "signature": ["sig.nod"],
    "counts": {"nodes": 27, "animated": 6},
}
