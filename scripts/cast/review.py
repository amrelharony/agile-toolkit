"""Review output in the private folder: contact sheets and report.json per batch.

    master_sheet(report, extra, dest)   the cut master on light, dark and checker
                                         grounds with the guides, its checks and swatches
    write_report(folder, batch, mode, reports)   merge into review/<batch>/report.json

Everything here lands in <sources>/review/<batch>/, never in the repo: a sheet
shows the private swatches.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from . import ledger
from .spec import BUILDER_VERSION, TOL

LIGHT = (246, 242, 232)
DARK = (30, 30, 36)
CHECK = ((204, 204, 204), (255, 255, 255))
INK = (20, 20, 24)
COLOURS = {
    "pass": (40, 140, 60),
    "warn": (200, 130, 0),
    "fail": (200, 30, 30),
    "skip": (120, 120, 120),
}
GUIDE = {
    "fail": (230, 40, 40),
    "ask": (240, 160, 0),
    "box": (0, 170, 220),
    "target": (40, 180, 80),
    "speck": (230, 40, 40),
    "extra": (220, 0, 220),
}
SCALE = 0.5  # each ground at half size


def _font(size: int):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow without FreeType sizing
        return ImageFont.load_default()


def ground(kind: str, w: int, h: int, square: int = 16) -> Image.Image:
    if kind == "light":
        return Image.new("RGBA", (w, h), LIGHT + (255,))
    if kind == "dark":
        return Image.new("RGBA", (w, h), DARK + (255,))
    yy, xx = np.mgrid[0:h, 0:w]
    odd = ((yy // square + xx // square) % 2).astype(bool)
    a = np.zeros((h, w, 4), np.uint8)
    a[..., 3] = 255
    a[~odd, :3] = CHECK[0]
    a[odd, :3] = CHECK[1]
    return Image.fromarray(a, "RGBA")


def _guides(d: ImageDraw.ImageDraw, w: int, h: int, s: float, rep: dict, extra: dict) -> None:
    def rect(x0, y0, x1, y1, col, width=1):
        d.rectangle([x0 * s, y0 * s, x1 * s - 1, y1 * s - 1], outline=col, width=width)

    f, a = TOL["margin_fail_px"], TOL["margin_ask_px"]
    rect(f, f, w - f, h - f, GUIDE["fail"])
    rect(a, a, w - a, h - a, GUIDE["ask"])
    floor = h - TOL["sole_px"]
    top = floor - TOL["master_height_px"]
    for y in (floor, top):
        d.line([0, y * s, w * s, y * s], fill=GUIDE["target"], width=1)
    fig = extra.get("figure")
    if fig is not None:
        rect(*fig.box, GUIDE["box"], 2)
        cx = (fig.box[0] + fig.box[2]) / 2
        d.line([cx * s, fig.box[1] * s, cx * s, fig.box[3] * s], fill=GUIDE["box"], width=1)
    for sp in extra.get("specks", []):
        x0, y0, x1, y1 = sp["box"]
        cx, cy = (x0 + x1) / 2 * s, (y0 + y1) / 2 * s
        d.ellipse([cx - 8, cy - 8, cx + 8, cy + 8], outline=GUIDE["speck"], width=2)
    for ex in extra.get("extra", []):
        rect(*ex["box"], GUIDE["extra"], 2)


def master_sheet(report: dict, extra: dict, dest: Path) -> Path:
    """Write the master's contact sheet to dest (PNG) and return its path."""
    cut = Image.fromarray(extra["cutout"], "RGBA")
    W, H = cut.size
    w, h = int(W * SCALE), int(H * SCALE)
    small = cut.convert("RGBa").resize((w, h), Image.LANCZOS).convert("RGBA")
    pad = 16
    colours = report["checks"].get("C9", {}).get("colours", [])
    rows_h = 22 * 9
    sw_rows = (len(colours) + 2) // 3
    sheet_w = pad + 3 * (w + pad)
    sheet_h = pad + 28 + h + pad + rows_h + sw_rows * 26 + pad
    sheet = Image.new("RGBA", (sheet_w, sheet_h), (255, 255, 255, 255))
    d = ImageDraw.Draw(sheet)
    big, mid = _font(20), _font(15)
    status = report["status"]
    d.text((pad, pad), f"{report['id']} master - {report['file']} - {status.upper()}", fill=COLOURS[status], font=big)
    for i, kind in enumerate(("light", "dark", "checker")):
        x = pad + i * (w + pad)
        g = ground(kind, w, h)
        g.alpha_composite(small)
        gd = ImageDraw.Draw(g)
        _guides(gd, W, H, SCALE, report, extra)
        sheet.paste(g, (x, pad + 28))
    y = pad + 28 + h + pad
    for name, res in report["checks"].items():
        st = res.get("status", "skip")
        notes = "; ".join(res.get("notes", [])) or ""
        line = f"{name:7s} {st:5s} {_summary(name, res)} {notes}"
        d.text((pad, y), line[:220], fill=COLOURS[st], font=mid)
        y += 22
    d.text(
        (pad, y),
        "guides: red = margin_fail_px, amber = margin_ask_px, green = sole and master height targets, "
        "blue = figure box, red rings = specks, magenta = extra drawings",
        fill=INK,
        font=mid,
    )
    y += 30
    col_w = (sheet_w - 2 * pad) // 3
    for k, row in enumerate(colours):
        cx = pad + (k % 3) * col_w
        cy = y + (k // 3) * 26
        d.rectangle([cx, cy, cx + 20, cy + 20], fill=row["hex"], outline=INK)
        if row.get("cluster"):
            d.rectangle([cx + 22, cy, cx + 42, cy + 20], fill=row["cluster"], outline=INK)
        de = "-" if row.get("de00") is None else f"{row['de00']:.1f}"
        d.text(
            (cx + 50, cy + 2),
            f"{row['label'][:34]}  dE {de}  {row['status']}",
            fill=COLOURS[{"ok": "pass", "shift": "warn", "far": "fail"}[row["status"]]],
            font=mid,
        )
    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet.convert("RGB").save(dest, "PNG", optimize=True)
    return dest


def _summary(name: str, res: dict) -> str:
    if name == "C1":
        return f"{res['size'][0]}x{res['size'][1]} png={res['png']} name={res['name']}"
    if name == "C2":
        k = res.get("key")
        bits = [f"mode={res['mode']}", f"residue={res['residue']:.3%}", f"checker={res['checker']['score']}"]
        if k:
            bits += [f"key share={k['share']:.0%}", f"border p95={k['border_p95']}"]
        return " ".join(bits)
    if name == "C3" and res.get("margins"):
        return " ".join(f"{k}={v}" for k, v in res["margins"].items())
    if name == "C4":
        return f"figures={res['figures']} specks={len(res['specks'])}"
    if name == "height" and res.get("height_px"):
        return f"{res['height_px']} px ({res['ratio']:.0%} of {TOL['master_height_px']})"
    if name == "C9" and res.get("colours"):
        n = {s: sum(r["status"] == s for r in res["colours"]) for s in ("ok", "shift", "far")}
        return f"ok={n['ok']} shift={n['shift']} far={n['far']}"
    return ""


def review_dir(sources: Path, batch: str, root: Path | str | None = None) -> Path:
    return (Path(root) if root else Path(sources) / "review") / batch


def write_report(sources: Path, batch: str, mode: str, reports: list[dict], root=None) -> Path:
    """Merge these characters' reports into review/<batch>/report.json."""
    path = review_dir(sources, batch, root) / "report.json"
    data = {"batch": batch, "builder_version": BUILDER_VERSION, "characters": {}}
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    data["updated"] = ledger.now()
    data.setdefault("characters", {})
    for r in reports:
        data["characters"].setdefault(r["id"], {})[mode] = r
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    return path
