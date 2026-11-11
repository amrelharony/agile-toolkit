"""The palette lock (a colour drawn a little off comes onto its swatch, one past
the gate stays), and the swaps: face patches refused when a state changes the
head outside its band, pupils painted out of an eye, the grid order of a sheet."""

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
from test_cast_checks import shifted  # noqa: E402

from cast import imaging as im  # noqa: E402
from cast import key, palette, parts, swaps  # noqa: E402
from cast.spec import TOL  # noqa: E402


def recolour(rgba, old, new):
    """rgba with every pixel within ΔE00 4 of `old` (its soft edges too) set to `new`."""
    out = rgba.copy()
    ys, xs = np.nonzero(out[..., 3] > 0)
    d = im.de00(im.lab(out[ys, xs, :3].astype(float)), im.lab(np.array(old, float)))
    sel = d <= 4
    out[ys[sel], xs[sel], :3] = new
    return out


class Lock(unittest.TestCase):
    def test_a_colour_drawn_off_comes_onto_its_swatch(self):
        master = cs.master_rgba()
        # Lighter by about ΔE00 9 (darker would read as the flap): inside the lock's
        # clamp (lock_clamp_de76) in Lab.
        off = shifted(cs.BODY, 9, axes=((1, 0, 0), (0, 1, 0)))
        self.assertLess(np.linalg.norm(im.lab(np.array(off, float)) - im.lab(np.array(cs.BODY, float))), TOL["lock_clamp_de76"])
        drawn = recolour(master, cs.BODY, off)
        targets = np.array([im.lab(np.array(c, float)) for c in (cs.BODY, cs.FLAP, cs.LIMB, cs.GLOVE, cs.INK)])
        before = heads.de2000(im.lab(np.array(off, float)), targets[0])
        self.assertGreater(before, TOL["de00_fix"])
        out, rep = palette.lock(drawn, targets)
        self.assertTrue(rep[0]["moved"])
        self.assertLessEqual(rep[0]["after"], 1.5)
        mid = out[375, 768, :3].astype(float)  # inside the body, away from the face
        self.assertLess(heads.de2000(im.lab(mid), targets[0]), 1.5)

    def test_a_colour_past_the_gate_is_left_alone(self):
        master = cs.master_rgba()
        blue = (60, 120, 220)
        drawn = recolour(master, cs.BODY, blue)
        targets = np.array([im.lab(np.array(cs.BODY, float))])
        out, rep = palette.lock(drawn, targets)
        self.assertFalse(rep[0]["moved"])
        np.testing.assert_array_equal(out[375, 768, :3], blue)

    def test_clusters_are_deterministic(self):
        lab, _ = palette._pixels(cs.master_rgba())
        seeds = np.array([im.lab(np.array(cs.BODY, float))])
        a = palette.clusters(lab, seeds)
        b = palette.clusters(lab, seeds)
        np.testing.assert_array_equal(a[0], b[0])


class Face(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = cs.torso(pupils=True, flap=True)

    def cells(self, states, **draw):
        sheet = cs.face_sheet(cells=states)
        cut, _ = key.cut(sheet, cs.MAGENTA)
        pieces, _ = parts.islands(cut)
        order = swaps.grid_order(pieces, 2, 4, cut.shape)
        return [pieces[i].crop(cut)[0] if i is not None else None for i in order]

    def test_patches_for_the_brief_states(self):
        states = (("eyes", "open"), ("eyes", "closed"), ("eyes", "happy"), ("eyes", "wide"),
                  ("mouth", "rest"), ("mouth", "smile"), ("mouth", "open"), ("mouth", "o"))
        got = swaps.face_patches(self.cells(cs.FACE_CELLS), states, self.base)
        for row in got["report"]["cells"]:
            self.assertEqual(row["status"], "pass", row)
        self.assertEqual(sorted(got["eyes"]["choices"]), ["closed", "happy", "wide"])
        self.assertEqual(sorted(got["mouth"]["choices"]), ["o", "open", "smile"])
        ex0, ey0, ex1, ey1 = got["eyes"]["box"]
        mx0, my0, mx1, my1 = got["mouth"]["box"]
        self.assertLess(ey1, my1)
        self.assertLess(ey0, my0)
        for ring in [*got["eyes"]["ring"].values(), *got["mouth"]["ring"].values()]:
            self.assertLessEqual(ring, TOL["ring_de00_fail"])
        # The wide eyes' whites come back empty: the moving pupils show there.
        wide = got["eyes"]["choices"]["wide"]
        ys, xs = np.nonzero(wide[..., 3] > 200)
        L = im.lab(wide[ys, xs, :3].astype(float))[:, 0]
        for (x, y) in cs.EYES:
            near = np.hypot(xs - x, ys - y) < cs.PUPIL_R - 2
            self.assertTrue(near.any())
            self.assertGreater(L[near].min(), TOL["white_l_min"])

    def test_a_state_that_redraws_the_head_outside_its_band_is_refused(self):
        bad = [dict(c) for c in cs.FACE_CELLS]
        cells = self.cells(bad)
        # Cell 2 (a blink) comes back with the mouth changed too.
        blink_and_mouth = cs.crop(cs.torso(eyes="closed", mouth="open", flap=True))
        cells[1] = cs.scaled(blink_and_mouth, 0.62)
        states = (("eyes", "open"), ("eyes", "closed"), ("eyes", "happy"), ("eyes", "wide"),
                  ("mouth", "rest"), ("mouth", "smile"), ("mouth", "open"), ("mouth", "o"))
        got = swaps.face_patches(cells, states, self.base)
        row = got["report"]["cells"][1]
        self.assertEqual(row["status"], "fail")
        self.assertGreater(row["outside"], TOL["face_outside_max"])
        self.assertNotIn("closed", got["eyes"]["choices"])

    def test_fill_whites(self):
        img = cs.torso(pupils=True)
        x0, y0 = cs.EYES[0][0] - 60, cs.EYES[0][1] - 60
        box = (x0, y0, x0 + 120, y0 + 120)
        out = swaps.fill_whites(img, box)
        x, y = cs.EYES[0]
        self.assertGreater(im.lab(out[y + 4, x + 8, :3].astype(float))[0], 90)
        np.testing.assert_array_equal(out[:, x0 + 200 :], img[:, x0 + 200 :])  # nothing else


class Grid(unittest.TestCase):
    def test_grid_order_reads_rows_then_columns(self):
        sheet = cs.arms_sheet([("arm-r", "wave")] * 8)
        cut, _ = key.cut(sheet, cs.MAGENTA)
        pieces, _ = parts.islands(cut)
        order = swaps.grid_order(pieces, 2, 4, cut.shape)
        self.assertNotIn(None, order)
        xs = [pieces[i].centroid[0] for i in order]
        ys = [pieces[i].centroid[1] for i in order]
        self.assertEqual(xs[:4], sorted(xs[:4]))
        self.assertLess(max(ys[:4]), min(ys[4:]))


if __name__ == "__main__":
    unittest.main()
