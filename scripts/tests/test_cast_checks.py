"""check --masters on synthetic masters: C1 names and canvas, C2 background, C3
margins, C4 one figure with specks listed, the height against master_height_px,
C9 against a private-block lookalike, the contact sheet and report.json."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import cast_synth as cs  # noqa: E402
import mascot_heads as heads  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from cast import checks, palette, review  # noqa: E402
from cast import imaging as im  # noqa: E402
from cast.spec import TOL, character  # noqa: E402

STICKY = character("AAW-25")
COLOURS = [("Body", cs.BODY), ("Flap", cs.FLAP), ("Limbs", cs.LIMB), ("Gloves", cs.GLOVE), ("Ink", cs.INK)]


def shifted(rgb, de: float, axes=((0, 0, -1), (0, 1, 0), (0, -1, 0), (-1, 0, 0), (0, 0, 1))) -> tuple[int, int, int]:
    """A colour `de` (CIEDE2000, to 0.3) from rgb, moved in Lab along the first
    axis that stays inside sRGB."""
    base = im.lab(np.array(rgb, float))
    for axis in axes:
        lo, hi = 0.0, 60.0
        for _ in range(40):
            mid = (lo + hi) / 2
            out = np.clip(heads.lab_to_srgb(base + mid * np.array(axis)) + 0.5, 0, 255).astype(int)
            if im.de00(im.lab(out.astype(float)), base) < de:
                lo = mid
            else:
                hi = mid
        if abs(float(im.de00(im.lab(out.astype(float)), base)) - de) < 0.3:
            return tuple(int(v) for v in out)
    raise AssertionError("no colour that far inside sRGB")


def block(tmp: Path, cid: str, colours) -> Path:
    p = tmp / "sources" / "blocks" / f"{cid}.txt"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(cs.block_text(colours), encoding="utf-8")
    return tmp


class MasterChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="cast-checks-"))
        cls.good = cs.save(cls.tmp / "AAW-25_master.png", cs.master_png(), "RGB")
        block(cls.tmp, "AAW-25", COLOURS)
        cls.colours = palette.block_colours(cls.tmp, "AAW-25")

    def test_a_good_master_passes_everything(self):
        rep, extra = checks.check_master(self.good, STICKY, self.colours)
        for name, res in rep["checks"].items():
            self.assertEqual(res["status"], "pass", (name, res.get("notes")))
        self.assertEqual(rep["status"], "pass")
        self.assertEqual(rep["checks"]["C2"]["mode"], "key")
        self.assertEqual(rep["checks"]["C4"]["figures"], 1)
        ratio = rep["checks"]["height"]["ratio"]
        self.assertTrue(TOL["scale_min"] <= ratio <= TOL["scale_max"], ratio)
        self.assertEqual(len(rep["sha256"]), 64)
        self.assertIsNotNone(extra["figure"])

    def test_real_alpha_passes_and_a_drawn_checkerboard_fails(self):
        alpha = cs.save(self.tmp / "alpha" / "AAW-25_master.png", cs.master_rgba())
        rep, _ = checks.check_master(alpha, STICKY, None)
        self.assertEqual(rep["checks"]["C2"]["status"], "pass")
        self.assertEqual(rep["checks"]["C2"]["mode"], "alpha")
        self.assertEqual(rep["checks"]["C9"]["status"], "skip")
        board = cs.over(cs.checkerboard(16), cs.master_rgba())
        bad = cs.save(self.tmp / "board" / "AAW-25_master.png", board, "RGB")
        rep, _ = checks.check_master(bad, STICKY, None)
        self.assertEqual(rep["checks"]["C2"]["status"], "fail")
        self.assertTrue(rep["checks"]["C2"]["checker"]["checker"])
        self.assertIn("checkerboard", " ".join(rep["checks"]["C2"]["notes"]))

    def test_a_non_key_background_fails(self):
        white = cs.save(self.tmp / "white" / "AAW-25_master.png", cs.on_key(cs.master_rgba(), (250, 250, 250)), "RGB")
        rep, _ = checks.check_master(white, STICKY, None)
        self.assertEqual(rep["checks"]["C2"]["status"], "fail")

    def test_name_format_and_canvas(self):
        wrong = cs.save(self.tmp / "AAW-25_master-final.png", cs.master_png(), "RGB")
        self.assertEqual(checks.c1_file(wrong, STICKY, "master")["status"], "fail")
        other = cs.save(self.tmp / "AAW-04_master.png", cs.master_png(), "RGB")
        self.assertEqual(checks.c1_file(other, STICKY, "master")["status"], "fail")
        small = self.tmp / "AAW-25_master-v2.png"
        Image.fromarray(cs.master_png()).convert("RGB").resize((1024, 683)).save(small)
        res = checks.c1_file(small, STICKY, "master")
        self.assertEqual(res["status"], "fail")
        self.assertEqual(res["size"], [1024, 683])
        jpeg = self.tmp / "AAW-25_master-v3.png"
        Image.fromarray(cs.master_png()).convert("RGB").save(jpeg, "JPEG")
        self.assertFalse(checks.c1_file(jpeg, STICKY, "master")["png"])
        self.assertEqual(checks.c1_file(self.good, STICKY, "master")["status"], "pass")

    def test_margins(self):
        img = cs.master_png().copy()
        img[TOL["margin_fail_px"] - 4 : TOL["margin_fail_px"] + 20, 700:740, :3] = cs.INK  # a mark near the top
        rgba = img.copy()
        path = cs.save(self.tmp / "margin" / "AAW-25_master.png", rgba, "RGB")
        rep, _ = checks.check_master(path, STICKY, None)
        self.assertEqual(rep["checks"]["C3"]["status"], "fail")
        self.assertLess(rep["checks"]["C3"]["margins"]["top"], TOL["margin_fail_px"])
        img = cs.master_png().copy()
        y = (TOL["margin_fail_px"] + TOL["margin_ask_px"]) // 2
        img[y : y + 20, 700:740, :3] = cs.INK
        path = cs.save(self.tmp / "margin2" / "AAW-25_master.png", img, "RGB")
        rep, _ = checks.check_master(path, STICKY, None)
        self.assertEqual(rep["checks"]["C3"]["status"], "warn")

    def test_specks_are_listed_and_a_second_figure_fails(self):
        img = cs.master_png().copy()
        s = TOL["speck_px"] - 4
        img[300 : 300 + s, 200 : 200 + s, :3] = cs.INK
        img[700 : 700 + 3, 1300 : 1300 + 3, :3] = cs.WHITE
        path = cs.save(self.tmp / "specks" / "AAW-25_master.png", img, "RGB")
        rep, extra = checks.check_master(path, STICKY, None)
        self.assertEqual(rep["checks"]["C4"]["status"], "pass")
        self.assertEqual(len(rep["checks"]["C4"]["specks"]), 2)
        self.assertEqual(int(extra["cutout"][300:300 + s, 200:200 + s, 3].max()), 0)  # dropped
        img[400:470, 150:220, :3] = cs.LIMB  # a stray drawing, bigger than a speck
        path = cs.save(self.tmp / "two" / "AAW-25_master.png", img, "RGB")
        rep, _ = checks.check_master(path, STICKY, None)
        self.assertEqual(rep["checks"]["C4"]["status"], "fail")
        self.assertEqual(rep["checks"]["C4"]["figures"], 2)
        self.assertEqual(len(rep["checks"]["C4"]["extra"]), 1)

    def test_a_small_figure_warns_on_height(self):
        small = Image.fromarray(cs.master_rgba()).resize((768, 512), Image.LANCZOS)
        canvas = Image.new("RGBA", (cs.W, cs.H), (0, 0, 0, 0))
        canvas.alpha_composite(small, (384, 400))
        path = cs.save(self.tmp / "small" / "AAW-25_master.png", cs.on_key(np.array(canvas)), "RGB")
        rep, _ = checks.check_master(path, STICKY, None)
        self.assertEqual(rep["checks"]["height"]["status"], "warn")

    def test_palette_per_colour(self):
        rep, _ = checks.check_master(self.good, STICKY, self.colours)
        rows = rep["checks"]["C9"]["colours"]
        self.assertEqual([r["label"] for r in rows], [n for n, _ in COLOURS])
        self.assertTrue(all(r["status"] == "ok" for r in rows), rows)
        off = [("Body", shifted(cs.BODY, (TOL["de00_fix"] + TOL["de00_regen"]) / 2))]
        far = [("Body", (60, 160, 230)), ("Tongue", (230, 80, 120))]  # drawn wrong, and not drawn
        tmp = Path(tempfile.mkdtemp(prefix="cast-c9-"))
        block(tmp, "AAW-25", off + COLOURS[1:])
        rep, _ = checks.check_master(self.good, STICKY, palette.block_colours(tmp, "AAW-25"))
        self.assertEqual(rep["checks"]["C9"]["colours"][0]["status"], "shift")
        self.assertEqual(rep["checks"]["C9"]["status"], "warn")
        block(tmp, "AAW-25", far + COLOURS[1:])
        rep, _ = checks.check_master(self.good, STICKY, palette.block_colours(tmp, "AAW-25"))
        rows = rep["checks"]["C9"]["colours"]
        self.assertEqual(rep["checks"]["C9"]["status"], "fail")
        self.assertEqual(rows[0]["status"], "far")
        self.assertEqual(rows[1]["status"], "far")
        self.assertTrue(all(r["status"] == "ok" for r in rows[2:]))

    def test_block_labels(self):
        tmp = Path(tempfile.mkdtemp(prefix="cast-block-"))
        p = tmp / "sources" / "blocks" / "AAW-99.txt"
        p.parent.mkdir(parents=True)
        p.write_text(
            "CHARACTER: X\nCOLOURS\n- Fur #112233, shade #445566. Nose #778899.\n"
            "- Eyes white #FFFFFF, eyebrows and outlines dark #000000.\nNEVER\n- Hat #ABCDEF.\n",
            encoding="utf-8",
        )
        got = palette.block_colours(tmp, "AAW-99")
        self.assertEqual(
            got,
            [
                ("Fur", "#112233"),
                ("Fur shade", "#445566"),
                ("Nose", "#778899"),
                ("Eyes white", "#FFFFFF"),
                ("eyebrows and outlines dark", "#000000"),
            ],
        )

    def test_contact_sheet_and_report(self):
        rep, extra = checks.check_master(self.good, STICKY, self.colours)
        out = self.tmp / "review"
        sheet = review.master_sheet(rep, extra, out / "A" / "AAW-25_master-check.png")
        with Image.open(sheet) as im_:
            self.assertGreater(im_.size[0], 3 * cs.W // 2)
        path = review.write_report(self.tmp, "A", "masters", [{"id": "AAW-25", "images": {"master": rep}}], out)
        review.write_report(self.tmp, "A", "masters", [{"id": "AAW-04", "images": {}}], out)
        data = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(sorted(data["characters"]), ["AAW-04", "AAW-25"])  # merged, not replaced
        self.assertEqual(data["characters"]["AAW-25"]["masters"]["images"]["master"]["status"], "pass")


if __name__ == "__main__":
    unittest.main()
