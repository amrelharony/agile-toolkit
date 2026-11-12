"""Writing JSON and TypeScript data the way prettier (.prettierrc.json) prints it,
so the builder's writes need no formatting pass and leave clean diffs.

    json_text(value)       docs/cast/cast-rig.json style: objects always expanded,
                           arrays on one line when they fit in printWidth
    ts_value(value)        the same as a TS literal: bare identifier keys, double
                           quotes, trailing commas (es5)

test_cast_fmt.py holds json_text(load(cast-rig.json)) equal to the file itself.
"""

from __future__ import annotations

import json
import math
import re

WIDTH = 100  # .prettierrc.json printWidth
IDENT = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")


def _num(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if not math.isfinite(v):
        raise ValueError(f"not a finite number: {v}")
    if v == int(v) and abs(v) < 1e15:
        return str(int(v)) if v != 0 else "0"
    return repr(float(v))


def _scalar(v) -> str | None:
    if v is None:
        return "null"
    if isinstance(v, (bool, int, float)):
        return _num(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    return None


def _key(k: str, ts: bool) -> str:
    return k if ts and IDENT.match(k) else json.dumps(k, ensure_ascii=False)


def _inline(v) -> str | None:
    s = _scalar(v)
    if s is not None:
        return s
    if isinstance(v, (list, tuple)):
        parts = [_inline(x) for x in v]
        if any(p is None for p in parts):
            return None
        return "[" + ", ".join(parts) + "]"
    if isinstance(v, dict) and not v:
        return "{}"
    return None


def _render(v, ind: int, head: int, tail: int, ts: bool) -> str:
    """v printed at indentation `ind`, with `head` characters before it on its
    first line and `tail` after its last."""
    pad = " " * ind
    inner = " " * (ind + 2)
    if isinstance(v, dict):
        if not v:
            return "{}"
        items = list(v.items())
        lines = []
        for i, (k, x) in enumerate(items):
            last = i == len(items) - 1
            comma = "," if (not last or ts) else ""
            key = _key(k, ts) + ": "
            lines.append(inner + key + _render(x, ind + 2, ind + 2 + len(key), len(comma), ts) + comma)
        return "{\n" + "\n".join(lines) + "\n" + pad + "}"
    if isinstance(v, (list, tuple)):
        if not v:
            return "[]"
        one = _inline(v)
        if one is not None and head + len(one) + tail <= WIDTH:
            return one
        lines = []
        for i, x in enumerate(v):
            last = i == len(v) - 1
            comma = "," if (not last or ts) else ""
            lines.append(inner + _render(x, ind + 2, ind + 2, len(comma), ts) + comma)
        return "[\n" + "\n".join(lines) + "\n" + pad + "]"
    s = _scalar(v)
    if s is None:
        raise TypeError(f"cannot print {type(v)}")
    return s


def json_text(value) -> str:
    return _render(value, 0, 0, 0, ts=False) + "\n"


def ts_value(value, head: int = 0, tail: int = 0) -> str:
    return _render(value, 0, head, tail, ts=True)
