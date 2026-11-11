"""Registration onto the master (masked NCC by FFT), the warp it rests on, and the
joints: a Kasa circle on a cap."""

import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import cast_synth as cs  # noqa: E402
import numpy as np  # noqa: E402

from cast import key  # noqa: E402
from cast import register as rg  # noqa: E402
from cast.spec import TOL  # noqa: E402


def centroid(img):
    w = img[..., 3].astype(float)
    ys, xs = np.mgrid[0 : img.shape[0], 0 : img.shape[1]]
    return (w * (xs + 0.5)).sum() / w.sum(), (w * (ys + 0.5)).sum() / w.sum()


class Warp(unittest.TestCase):
    def test_a_point_lands_where_the_model_says(self):
        a = np.zeros((41, 61, 4), np.uint8)
        yy, xx = np.mgrid[0:41, 0:61]
        a[(xx + 0.5 - 40) ** 2 + (yy + 0.5 - 12) ** 2 < 25] = 255
        for m, th in ((1, 0), (2, 0), (1, 90), (0.5, 30)):
            out = rg.warp(a, m, th, (300, 300), (150, 150))
            c, s = np.cos(np.radians(th)), np.sin(np.radians(th))
            dx, dy = 40 - 30.5, 12 - 20.5
            want = (150 + m * (c * dx + s * dy), 150 + m * (-s * dx + c * dy))
            np.testing.assert_allclose(centroid(out), want, atol=0.15)

    def test_fast_len(self):
        self.assertEqual(rg.fast_len(1), 1)
        self.assertEqual(rg.fast_len(97), 100)
        self.assertEqual(rg.fast_len(513), 540)
        self.assertEqual(rg.fast_len(1024), 1024)


class Register(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.master, _ = key.cut(cs.master_png(), cs.MAGENTA)

    def check(self, piece, master, true_r, true_t, centre, **kw):
        reg = rg.register(piece, master, **kw)
        self.assertIsNotNone(reg)
        self.assertAlmostEqual(reg.r, true_r, delta=0.01 * true_r)
        self.assertAlmostEqual(reg.theta, true_t, delta=0.5)
        self.assertAlmostEqual(reg.cx, centre[0], delta=1.0)
        self.assertAlmostEqual(reg.cy, centre[1], delta=1.0)
        return reg

    def test_recovers_scale_turn_and_place_under_occlusion(self):
        torso = cs.torso(pupils=True)
        ys, xs = np.nonzero(torso[..., 3] > 0)
        centre = ((xs.min() + xs.max() + 1) / 2, (ys.min() + ys.max() + 1) / 2)
        piece = cs.scaled(cs.crop(torso), 0.8, 6.0)  # drawn at 80 %, tilted 6°
        master = self.master.copy()
        x0, x1 = int(xs.min()), int(xs.max())
        y0, y1 = int(ys.min()), int(ys.max())
        master[y0 : y0 + int(0.3 * (y1 - y0)), x0:x1] = (90, 140, 200, 255)  # 30 % hidden
        reg = self.check(piece, master, 0.8, 6.0, centre)
        self.assertGreater(reg.excluded, 0.2)
        self.assertGreater(reg.ncc, 0.9)

    def test_a_small_piece_at_its_own_scale(self):
        flap = cs.flap_layer()
        ys, xs = np.nonzero(flap[..., 3] > 0)
        centre = ((xs.min() + xs.max() + 1) / 2, (ys.min() + ys.max() + 1) / 2)
        self.check(cs.scaled(cs.crop(flap), 1.1), self.master, 1.1, 0.0, centre)

    def test_a_recoloured_piece_scores_high_but_is_unexplained(self):
        # The pieces over and under the torso in the master, as the candidate has them.
        others = np.zeros(self.master.shape[:2], bool)
        for layer in (cs.flap_layer(), cs.arm("arm-r"), cs.arm("arm-l"), cs.leg("leg-r"), cs.leg("leg-l")):
            others |= layer[..., 3] > 127
        torso = cs.crop(cs.torso())
        good = rg.register(cs.scaled(torso, 0.85), self.master)
        bad_art = torso.copy()
        body = np.all(np.abs(bad_art[..., :3].astype(int) - cs.BODY) < 40, axis=-1)
        bad_art[body, :3] = (60, 170, 160)  # the body drawn in another colour
        bad = rg.register(cs.scaled(bad_art, 0.85), self.master)
        self.assertGreater(bad.ncc, TOL["ncc_warn"])  # the second pass alone would pass it
        self.assertGreater(bad.excluded, 0.5)
        shape = self.master.shape
        odd_good = rg.unexplained(rg.bake(cs.scaled(torso, 0.85), good, shape), self.master, others)
        odd_bad = rg.unexplained(rg.bake(cs.scaled(bad_art, 0.85), bad, shape), self.master, others)
        self.assertLess(odd_good, TOL["reg_unexplained_max"] / 4)
        self.assertGreater(odd_bad, TOL["reg_unexplained_max"])
        self.assertGreater(good.coverage, TOL["reg_coverage_min"])

    def test_a_window_keeps_a_sided_piece_on_its_side(self):
        arm = cs.arm("arm-r")
        ys, xs = np.nonzero(arm[..., 3] > 0)
        centre = ((xs.min() + xs.max() + 1) / 2, (ys.min() + ys.max() + 1) / 2)
        piece = cs.scaled(cs.crop(arm), 0.85)
        self.check(piece, self.master, 0.85, 0.0, centre, near=(0, 0, cs.W / 2, cs.H))


class Joints(unittest.TestCase):
    def test_kasa_on_an_arc(self):
        t = np.linspace(0.2, 2.6, 60)
        xs, ys = 40 + 25 * np.cos(t), 70 + 25 * np.sin(t)
        cx, cy, r, resid = rg.kasa(xs, ys)
        self.assertAlmostEqual(cx, 40, delta=1e-6)
        self.assertAlmostEqual(cy, 70, delta=1e-6)
        self.assertAlmostEqual(r, 25, delta=1e-6)
        self.assertLess(resid, 1e-9)
        # trimming pulls a fit thrown by stray points back toward the arc
        xs2 = np.concatenate([xs, np.full(20, 40 + 25.0)])
        ys2 = np.concatenate([ys, np.linspace(40, 70, 20)])
        raw = rg.kasa(xs2, ys2)
        cut = rg.kasa(xs2, ys2, trim=3)
        self.assertLess(np.hypot(cut[0] - 40, cut[1] - 70), np.hypot(raw[0] - 40, raw[1] - 70))
        self.assertLess(cut[3], raw[3])

    def test_a_capped_limb_pivots_at_its_cap_centre(self):
        H, W = 300, 300
        yy, xx = np.mgrid[0:H, 0:W]
        body = (xx >= 100) & (xx < 220) & (yy >= 40) & (yy < 200)
        # A limb hanging from a joint at (130, 180): round cap r = 18 tucked in the body.
        cx, cy, r = 130.0, 180.0, 18.0
        limb = (np.hypot(xx + 0.5 - cx, yy + 0.5 - cy) <= r) | ((np.abs(xx + 0.5 - cx) <= r) & (yy + 0.5 >= cy) & (yy < 290))
        pv = rg.pivot(limb, body)
        self.assertEqual(pv["kind"], "cap")
        self.assertLess(np.hypot(pv["x"] - cx, pv["y"] - cy), 1.0)
        self.assertAlmostEqual(pv["r"], r, delta=1.0)
        far = np.zeros_like(body)
        far[250:280, 10:40] = True
        self.assertEqual(rg.pivot(far, body)["kind"], "no_cap")


if __name__ == "__main__":
    unittest.main()
