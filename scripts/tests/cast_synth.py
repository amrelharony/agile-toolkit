"""Synthetic cast art for the builder's tests: simple shapes drawn with Pillow, no
canon. A made-up sticky-note puppet with the piece ids of an object-family rig
(torso, flap, pupils, arms, legs), its master, parts, face and arms sheets, on a
flat key or real alpha, plus loose helpers (specks, a checkerboard, margins).

Every drawing is supersampled twice and halved, so edges are antialiased the way
real art is.
"""

from __future__ import annotations

import io
import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

W, H = 1536, 1024
MAGENTA = (255, 0, 255)
GREEN = (0, 255, 0)
INK = (34, 26, 22)
BODY = (238, 196, 52)
FLAP = (205, 160, 34)
LIMB = (52, 52, 58)
GLOVE = (250, 250, 246)
WHITE = (252, 252, 250)
MOUTH = (150, 40, 40)
SS = 2  # supersampling


class Pen:
    """A supersampled RGBA layer: draw in final coordinates, get an antialiased image."""

    def __init__(self, w=W, h=H):
        self.w, self.h = w, h
        self.img = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)

    def _s(self, pts):
        return [v * SS for v in pts]

    def ellipse(self, box, fill, outline=INK, width=6):
        self.d.ellipse(self._s(box), fill=fill + (255,), outline=(outline + (255,)) if outline else None, width=width * SS)

    def rect(self, box, fill, outline=INK, width=6, radius=0):
        self.d.rounded_rectangle(self._s(box), radius=radius * SS, fill=fill + (255,), outline=(outline + (255,)) if outline else None, width=width * SS)

    def poly(self, pts, fill, outline=INK, width=6):
        flat = [(x * SS, y * SS) for x, y in pts]
        self.d.polygon(flat, fill=fill + (255,), outline=(outline + (255,)) if outline else None, width=width * SS)

    def line(self, pts, fill=INK, width=6):
        self.d.line([(x * SS, y * SS) for x, y in pts], fill=fill + (255,), width=width * SS, joint="curve")

    def capsule(self, a, b, r, fill, outline=INK, width=6):
        """A stroke from a to b, r wide each side, round at both ends."""
        self.line([a, b], fill=outline, width=int(2 * r))
        for p in (a, b):
            self.ellipse((p[0] - r, p[1] - r, p[0] + r, p[1] + r), outline, outline=None)
        self.line([a, b], fill=fill, width=int(2 * r - 2 * width))
        for p in (a, b):
            q = r - width
            self.ellipse((p[0] - q, p[1] - q, p[0] + q, p[1] + q), fill, outline=None)

    def arc(self, box, start, end, fill=INK, width=6):
        self.d.arc(self._s(box), start, end, fill=fill + (255,), width=width * SS)

    def done(self) -> np.ndarray:
        return np.array(self.img.resize((self.w, self.h), Image.LANCZOS))


def over(*layers: np.ndarray) -> np.ndarray:
    out = Image.new("RGBA", (layers[0].shape[1], layers[0].shape[0]), (0, 0, 0, 0))
    for layer in layers:
        out.alpha_composite(Image.fromarray(layer))
    return np.array(out)


def on_key(rgba: np.ndarray, key=MAGENTA) -> np.ndarray:
    bg = Image.new("RGBA", (rgba.shape[1], rgba.shape[0]), key + (255,))
    bg.alpha_composite(Image.fromarray(rgba))
    return np.array(bg)


def png_bytes(rgba: np.ndarray, mode="RGBA") -> bytes:
    buf = io.BytesIO()
    Image.fromarray(rgba).convert(mode).save(buf, "PNG")
    return buf.getvalue()


def save(path: Path, rgba: np.ndarray, mode="RGBA") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png_bytes(rgba, mode))
    return path


# ---------- the puppet, at rest in master coordinates ----------

TORSO = (578, 150, 958, 600)
EYES = ((690, 300), (846, 300))
EYE_R = 46
PUPIL_R = 16
SHOULDER = {"arm-r": (606, 330), "arm-l": (930, 330)}
HAND = {"arm-r": (470, 560), "arm-l": (1066, 560)}
HIP = {"leg-r": (700, 572), "leg-l": (836, 572)}
FOOT = {"leg-r": (690, 900), "leg-l": (846, 900)}
ARM_R, LEG_R = 22, 26


def torso(eyes="open", mouth="rest", pupils=False, flap=False) -> np.ndarray:
    p = Pen()
    p.rect(TORSO, BODY, radius=18)
    for i, (x, y) in enumerate(EYES):
        if eyes in ("open", "wide"):
            r = EYE_R if eyes == "open" else EYE_R + 12
            p.ellipse((x - r, y - r, x + r, y + r), WHITE, width=5)
            if pupils:
                d = 8 if i == 0 else -8
                p.ellipse((x + d - PUPIL_R, y + 4 - PUPIL_R, x + d + PUPIL_R, y + 4 + PUPIL_R), INK, outline=None)
        elif eyes == "closed":
            p.line([(x - 36, y + 6), (x + 36, y + 6)], width=7)
        elif eyes == "happy":
            p.arc((x - 38, y - 20, x + 38, y + 40), 200, 340, width=8)
    mx, my = 768, 460
    if mouth == "rest":
        p.arc((mx - 70, my - 40, mx + 70, my + 30), 20, 160, width=8)
    elif mouth == "smile":
        p.ellipse((mx - 90, my - 20, mx + 90, my + 60), MOUTH, width=6)
        p.rect((mx - 90, my - 24, mx + 90, my + 16), BODY, outline=None)
        p.line([(mx - 90, my + 16), (mx + 90, my + 16)], width=6)
    elif mouth == "open":
        p.ellipse((mx - 50, my - 40, mx + 50, my + 70), MOUTH, width=6)
    elif mouth == "o":
        p.ellipse((mx - 26, my - 6, mx + 26, my + 46), MOUTH, width=6)
    out = p.done()
    if flap:
        out = over(out, flap_layer())
    return out


def flap_layer() -> np.ndarray:
    p = Pen()
    x1, y0 = TORSO[2], TORSO[1]
    p.poly([(x1 - 96, y0 + 4), (x1 + 8, y0 + 4), (x1 + 8, y0 + 108)], FLAP)
    return p.done()


def pupils_layer() -> np.ndarray:
    p = Pen()
    for i, (x, y) in enumerate(EYES):
        d = 8 if i == 0 else -8
        p.ellipse((x + d - PUPIL_R, y + 4 - PUPIL_R, x + d + PUPIL_R, y + 4 + PUPIL_R), INK, outline=None)
    return p.done()


def pupil_piece() -> np.ndarray:
    p = Pen(60, 60)
    p.ellipse((30 - PUPIL_R, 30 - PUPIL_R, 30 + PUPIL_R, 30 + PUPIL_R), INK, outline=None)
    return p.done()


def arm(side: str, angle: float = 0.0) -> np.ndarray:
    """The arm in master coordinates, turned by `angle` degrees about its shoulder
    (counter-clockwise as the eye sees it)."""
    sx, sy = SHOULDER[side]
    hx, hy = HAND[side]
    t = math.radians(angle)
    dx, dy = hx - sx, hy - sy
    ex, ey = sx + dx * math.cos(t) + dy * math.sin(t), sy - dx * math.sin(t) + dy * math.cos(t)
    p = Pen()
    p.capsule((sx, sy), (ex, ey), ARM_R, LIMB)
    p.ellipse((ex - 34, ey - 34, ex + 34, ey + 34), GLOVE)
    if side == "arm-l":  # a band, so the two arms are not mirror images
        mx, my = sx + 0.6 * (ex - sx), sy + 0.6 * (ey - sy)
        p.ellipse((mx - 12, my - 12, mx + 12, my + 12), (210, 60, 60), outline=None)
    return p.done()


def leg(side: str) -> np.ndarray:
    hx, hy = HIP[side]
    fx, fy = FOOT[side]
    p = Pen()
    p.capsule((hx, hy), (fx, fy), LEG_R, LIMB)
    p.ellipse((fx - 64, fy - 8, fx + 64, fy + 48), GLOVE)
    return p.done()


def master_rgba() -> np.ndarray:
    """The rest pose: legs and arms tucked under the body, the flap and pupils over it."""
    return over(leg("leg-r"), leg("leg-l"), arm("arm-r"), arm("arm-l"), torso(), flap_layer(), pupils_layer())


def master_png(key=MAGENTA) -> np.ndarray:
    return on_key(master_rgba(), key)


def crop(rgba: np.ndarray) -> np.ndarray:
    ys, xs = np.nonzero(rgba[..., 3] > 0)
    return rgba[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


def scaled(rgba: np.ndarray, s: float, angle: float = 0.0) -> np.ndarray:
    img = Image.fromarray(rgba).convert("RGBa")
    img = img.resize((max(1, round(img.size[0] * s)), max(1, round(img.size[1] * s))), Image.LANCZOS)
    if angle:
        img = img.rotate(angle, resample=Image.BICUBIC, expand=True)
    return np.array(img.convert("RGBA"))


def place(canvas: np.ndarray, piece: np.ndarray, cx: float, cy: float) -> tuple[int, int]:
    h, w = piece.shape[:2]
    x0, y0 = int(round(cx - w / 2)), int(round(cy - h / 2))
    out = Image.fromarray(canvas)
    out.alpha_composite(Image.fromarray(piece), (x0, y0))
    canvas[:] = np.array(out)
    return x0, y0


PARTS_R = 0.85  # pieces drawn at 85% of their master size
PARTS_AT = {  # where each piece goes on the parts sheet (centre), after imageParts
    "pupil-r": (720, 70),
    "pupil-l": (810, 70),
    "flap": (1060, 160),
    "torso": (768, 360),
    "arm-r": (300, 420),
    "arm-l": (1250, 420),
    "leg-r": (680, 800),
    "leg-l": (860, 800),
}


def part_layers() -> dict:
    return {
        "torso": torso(eyes="open", pupils=False),
        "flap": flap_layer(),
        "pupil-r": pupil_piece(),
        "pupil-l": pupil_piece(),
        "arm-r": arm("arm-r"),
        "arm-l": arm("arm-l"),
        "leg-r": leg("leg-r"),
        "leg-l": leg("leg-l"),
    }


def parts_sheet(r=PARTS_R, tilt: dict | None = None, key=MAGENTA) -> tuple[np.ndarray, dict]:
    """(the parts sheet on the key, {id: (r, tilt)})."""
    canvas = np.zeros((H, W, 4), np.uint8)
    truth = {}
    for pid, layer in part_layers().items():
        t = (tilt or {}).get(pid, 0.0)
        s = r if not pid.startswith("pupil") else 1.0
        piece = scaled(crop(layer), s, t)
        place(canvas, piece, *PARTS_AT[pid])
        truth[pid] = (s, t)
    return on_key(canvas, key), truth


FACE_CELLS = [
    {"eyes": "open", "mouth": "rest"},
    {"eyes": "closed", "mouth": "rest"},
    {"eyes": "happy", "mouth": "rest"},
    {"eyes": "wide", "mouth": "rest"},
    {"eyes": "open", "mouth": "rest"},
    {"eyes": "open", "mouth": "smile"},
    {"eyes": "open", "mouth": "open"},
    {"eyes": "open", "mouth": "o"},
]


def face_sheet(key=MAGENTA, cells=None, s=0.62) -> np.ndarray:
    canvas = np.zeros((H, W, 4), np.uint8)
    for k, cfg in enumerate(cells or FACE_CELLS):
        head = crop(torso(pupils=cfg["eyes"] in ("open", "wide"), flap=True, **cfg))
        piece = scaled(head, s)
        place(canvas, piece, (k % 4 + 0.5) * W / 4, (k // 4 + 0.5) * H / 2)
    return on_key(canvas, key)


ARM_ANGLES = {"wave": -110, "up": -165, "open": -60, "point": -80, "chin": 120, "sig": 40}


def arm_pose(side: str, pose: str) -> np.ndarray:
    a = ARM_ANGLES[pose]
    return arm(side, a if side == "arm-r" else -a)


def arms_sheet(poses, r=PARTS_R, key=MAGENTA) -> np.ndarray:
    canvas = np.zeros((H, W, 4), np.uint8)
    rows = 2 if len(poses) == 8 else 1
    cols = len(poses) // rows
    for k, (side, pose) in enumerate(poses):
        piece = scaled(crop(arm_pose(side, pose)), r)
        place(canvas, piece, (k % cols + 0.5) * W / cols, (k // cols + 0.5) * H / rows)
    return on_key(canvas, key)


# ---------- loose helpers ----------


def checkerboard(square=16, light=(255, 255, 255), dark=(204, 204, 204)) -> np.ndarray:
    yy, xx = np.mgrid[0:H, 0:W]
    odd = ((yy // square + xx // square) % 2).astype(bool)
    out = np.zeros((H, W, 4), np.uint8)
    out[..., 3] = 255
    out[~odd, :3] = light
    out[odd, :3] = dark
    return out


def disc_on_key(key=MAGENTA, centre=(768, 512), r=200, colour=(40, 120, 200), blend=2) -> tuple[np.ndarray, np.ndarray]:
    """(a disc on the key with a `blend`-px linear edge, its true alpha)."""
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.hypot(xx + 0.5 - centre[0], yy + 0.5 - centre[1])
    a = np.clip((r - d) / blend + 0.5, 0, 1)
    rgb = a[..., None] * np.array(colour) + (1 - a[..., None]) * np.array(key)
    out = np.zeros((H, W, 4), np.uint8)
    out[..., :3] = np.clip(rgb + 0.5, 0, 255).astype(np.uint8)
    out[..., 3] = 255
    return out, a


def block_text(colours: list[tuple[str, tuple[int, int, int]]]) -> str:
    """A private-block lookalike for the tests (made-up words and colours)."""
    hexes = ", ".join(f"{name} #{r:02X}{g:02X}{b:02X}" for name, (r, g, b) in colours)
    return (
        "CHARACTER: TEST STICKY\nA made-up test puppet.\nWHO IT IS\n- A square note.\n"
        f"COLOURS\n- {hexes}.\nCLOTHES AND THINGS IT ALWAYS HAS\n- Nothing.\nNEVER\n- Nothing.\n"
    )
