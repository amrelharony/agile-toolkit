"""Key-out: alpha unmixing on the flat key, despill that leaves a key-hued drawing
alone, real alpha (filled at 250-254, as ChatGPT's transparent PNGs are), the
drawn checkerboard, and the colour and mask helpers it rests on."""

import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import cast_synth as cs  # noqa: E402
import mascot_heads as heads  # noqa: E402
import numpy as np  # noqa: E402

from cast import imaging as im  # noqa: E402
from cast import key  # noqa: E402
from cast.spec import TOL  # noqa: E402


class Helpers(unittest.TestCase):
    def test_vectorised_de00_is_heads_de2000(self):
        rng = np.random.default_rng(7)
        a = im.lab(rng.integers(0, 256, (200, 3)).astype(float))
        b = im.lab(rng.integers(0, 256, (200, 3)).astype(float))
        b[:20] = a[:20]  # equal pairs
        b[20:40, 1:] = 0  # greys
        mine = im.de00(a, b)
        ref = np.array([heads.de2000(x, y) for x, y in zip(a, b)])
        np.testing.assert_allclose(mine, ref, atol=1e-9)

    def test_dilate_and_erode_match_heads_without_wrapping(self):
        rng = np.random.default_rng(3)
        m = rng.random((60, 80)) > 0.93
        for r in (1, 2, 3, 5):
            pad = np.pad(m, r)
            ref = heads.dilate(pad, r)[r:-r, r:-r]
            np.testing.assert_array_equal(im.dilate(m, r), ref)
            ref_e = heads.erode(np.pad(m, r, constant_values=True), r)[r:-r, r:-r]
            np.testing.assert_array_equal(im.erode(m, r), ref_e)
        edge = np.zeros((20, 20), bool)
        edge[:, 0] = True
        self.assertFalse(im.dilate(edge, 3)[:, -1].any())  # nothing wraps to the far side

    def test_distance_in(self):
        m = np.zeros((30, 30), bool)
        m[5:25, 5:25] = True
        d = im.distance_in(m, 20)
        self.assertEqual(d[5, 5], 1)
        self.assertEqual(d.max(), 10)
        self.assertEqual(d[0, 0], 0)


class KeyCut(unittest.TestCase):
    def test_a_blended_disc_comes_back_with_its_alpha(self):
        img, truth = cs.disc_on_key(blend=2)
        out, info = key.cut(img, cs.MAGENTA)
        self.assertEqual(info["mode"], "key")
        a = out[..., 3] / 255
        np.testing.assert_allclose(a, truth, atol=0.05 + 1e-9)
        self.assertLessEqual(info["residue"], TOL["despill_residue_max"])
        inner = truth > 0.99
        self.assertLess(np.abs(out[inner, :3].astype(float) - (40, 120, 200)).max(), 2)

    def test_a_key_hued_drawing_keeps_its_hue(self):
        purple = (130, 40, 170)  # near the magenta key's hue, yet key_de00_min from it
        img, truth = cs.disc_on_key(colour=purple, blend=2)
        out, info = key.cut(img, cs.MAGENTA)
        edge = (truth > 0.6) & (truth < 0.99)
        inner = truth > 0.99
        d_in = im.de00(im.lab(out[inner, :3].astype(float)), im.lab(np.array(purple, float)))
        self.assertLess(float(np.median(d_in)), 1.0)
        d_edge = im.de00(im.lab(out[edge, :3].astype(float)), im.lab(np.array(purple, float)))
        self.assertLess(float(np.median(d_edge)), TOL["key_flat_de00"])
        self.assertLessEqual(info["residue"], TOL["despill_residue_max"])

    def spilled(self, amount, colour=(40, 120, 200), blend=2, reach=2):
        """A blended disc whose rim (`reach` px in from the edge) is pulled toward
        the key's hue by `amount` in a*b* on top of the blend: the non-linear spill
        a real render leaves, which unmixing alone can't undo."""
        img, truth = cs.disc_on_key(colour=colour, blend=blend)
        yy, xx = np.mgrid[0 : cs.H, 0 : cs.W]
        d = np.hypot(xx + 0.5 - 768, yy + 0.5 - 512)
        rim = (truth > 0.05) & (200 - d <= reach)
        klab = im.lab(np.array(cs.MAGENTA, float))
        u = klab[1:] / np.hypot(*klab[1:])
        lab = im.lab(img[rim, :3].astype(float))
        lab[:, 1:] += amount * truth[rim, None] * u
        img[rim, :3] = np.clip(heads.lab_to_srgb(lab) + 0.5, 0, 255).astype(np.uint8)
        return img, truth, rim

    def test_despill_takes_the_spill_out_of_the_rim(self):
        colour = (40, 120, 200)
        img, truth, rim = self.spilled(12, colour)
        out, info = key.cut(img, cs.MAGENTA)
        solid_rim = rim & (truth > 0.5)
        d = im.de00(im.lab(out[solid_rim, :3].astype(float)), im.lab(np.array(colour, float)))
        self.assertLess(float(np.median(d)), TOL["key_flat_de00"])
        self.assertLessEqual(info["residue"], TOL["despill_residue_max"])

    def test_c2s_residue_catches_spill_past_what_despill_takes(self):
        # A wide soft edge spilled deep into the band: despill takes only part of it
        # at the band's inner edge, and what is left is the residue C2 fails on.
        band = TOL["despill_band_px"]
        _, info = key.cut(self.spilled(12, blend=6, reach=band)[0], cs.MAGENTA)
        self.assertLessEqual(info["residue"], TOL["despill_residue_max"])
        _, info = key.cut(self.spilled(48, blend=6, reach=band)[0], cs.MAGENTA)
        self.assertGreater(info["residue"], TOL["despill_residue_max"])

    def test_green_key(self):
        img, truth = cs.disc_on_key(key=cs.GREEN, colour=(200, 60, 40))
        out, info = key.cut(img, cs.GREEN)
        np.testing.assert_allclose(out[..., 3] / 255, truth, atol=0.05 + 1e-9)

    def test_real_alpha_filled_short_of_255_is_made_solid(self):
        rgba = cs.master_rgba()
        rgba[..., 3] = np.where(rgba[..., 3] > 250, 253, rgba[..., 3]).astype(np.uint8)
        info = key.alpha_info(rgba)
        self.assertTrue(info["has_alpha"])
        self.assertTrue(info["soft_edge"])
        out, kinfo = key.cut(rgba, cs.MAGENTA)
        self.assertEqual(kinfo["mode"], "alpha")
        self.assertEqual(int(np.median(out[out[..., 3] > 127, 3])), 255)

    def test_a_hard_cut_alpha_has_no_soft_edge(self):
        rgba = cs.master_rgba()
        rgba[..., 3] = np.where(rgba[..., 3] > 127, 255, 0).astype(np.uint8)
        self.assertFalse(key.alpha_info(rgba)["soft_edge"])

    def test_a_drawn_checkerboard_is_caught_and_a_flat_key_is_not(self):
        for square in (TOL["checker_square_min"], 16, TOL["checker_square_max"]):
            board = cs.checkerboard(square)
            board = cs.over(board, cs.master_rgba())
            got = key.drawn_checker(board)
            self.assertTrue(got["checker"], square)
            self.assertEqual(got["square_px"], square)
        self.assertFalse(key.drawn_checker(cs.master_png())["checker"])
        self.assertFalse(key.drawn_checker(cs.master_rgba())["checker"])

    def test_key_info_reads_flatness_and_share(self):
        flat = key.key_info(cs.master_png(), cs.MAGENTA)
        self.assertTrue(flat["flat"] and flat["enough"])
        self.assertLess(flat["measured_de00"], 1)
        ramp = cs.master_png().copy()
        ramp[..., 1] = np.linspace(0, 160, ramp.shape[1]).astype(np.uint8)[None, :]
        bad = key.key_info(ramp, cs.MAGENTA)
        self.assertFalse(bad["flat"])
        white = cs.on_key(cs.master_rgba(), (255, 255, 255))
        self.assertFalse(key.key_info(white, cs.MAGENTA)["enough"])


if __name__ == "__main__":
    unittest.main()
