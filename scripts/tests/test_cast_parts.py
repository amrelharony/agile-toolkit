"""Slicing a parts sheet, the gaps between pieces, and naming them: Hungarian
matching against brute force, the layout prior on a synthetic exploded sheet."""

import itertools
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import cast_synth as cs  # noqa: E402
import numpy as np  # noqa: E402

from cast import key, parts, spec  # noqa: E402
from cast.spec import TOL  # noqa: E402

STICKY = spec.character("AAW-25")


class Slicing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sheet, cls.truth = cs.parts_sheet()
        cls.cut, _ = key.cut(sheet, cs.MAGENTA)

    def test_one_island_per_piece_and_specks_apart(self):
        pieces, specks = parts.islands(self.cut)
        self.assertEqual(len(pieces), len(STICKY["parts"]))
        self.assertEqual(specks, [])
        dotted = self.cut.copy()
        dotted[20:25, 20:25] = (0, 0, 0, 255)
        p2, s2 = parts.islands(dotted)
        self.assertEqual(len(p2), len(pieces))
        self.assertEqual(len(s2), 1)
        self.assertEqual(int(parts.drop(dotted, s2)[20:25, 20:25, 3].max()), 0)

    def test_a_satellite_within_the_closing_joins_its_piece(self):
        img = np.zeros((200, 200, 4), np.uint8)
        img[50:150, 50:100] = (40, 40, 40, 255)
        img[50:150, 100 + 2 * TOL["close_px"] - 1 : 160] = (40, 40, 40, 255)  # a hairline gap
        pieces, _ = parts.islands(img)
        self.assertEqual(len(pieces), 1)

    def test_gaps(self):
        pieces, _ = parts.islands(self.cut)
        r, close = parts.min_gap(pieces, self.cut.shape)
        self.assertEqual(r, TOL["gap_fail_px"])
        self.assertEqual(close, [])
        img = np.zeros((200, 300, 4), np.uint8)
        img[50:150, 20:100] = (40, 40, 40, 255)
        img[50:150, 100 + TOL["gap_fail_px"] - 2 : 200] = (40, 40, 40, 255)
        pieces, _ = parts.islands(img)
        _, close = parts.min_gap(pieces, img.shape)
        self.assertEqual(len(close), 1)
        img[50:150, 100 + TOL["gap_fail_px"] - 2 : 200] = 0
        img[50:150, 100 + TOL["gap_fail_px"] + 1 : 200] = (40, 40, 40, 255)
        pieces, _ = parts.islands(img)
        self.assertEqual(parts.min_gap(pieces, img.shape)[1], [])


class Naming(unittest.TestCase):
    def test_hungarian_matches_brute_force(self):
        rng = np.random.default_rng(11)
        for n, m in ((4, 4), (5, 7), (6, 3)):
            C = rng.random((n, m))
            got = parts.hungarian(C)
            best = None
            if n <= m:
                for cols in itertools.permutations(range(m), n):
                    s = sum(C[i, c] for i, c in enumerate(cols))
                    best = s if best is None or s < best else best
            else:
                for rows in itertools.permutations(range(n), m):
                    s = sum(C[r, j] for j, r in enumerate(rows))
                    best = s if best is None or s < best else best
            self.assertAlmostEqual(sum(C[r, c] for r, c in got), best, places=9)
            self.assertEqual(len(got), min(n, m))
            self.assertEqual(len({r for r, _ in got}), len(got))
            self.assertEqual(len({c for _, c in got}), len(got))

    def test_the_layout_names_every_piece(self):
        sheet, _ = cs.parts_sheet()
        cut, _ = key.cut(sheet, cs.MAGENTA)
        pieces, _ = parts.islands(cut)
        got, spare, _ = parts.assign(pieces, STICKY["parts"])
        self.assertEqual(spare, [])
        for pid, i in got.items():
            cx, cy = pieces[i].centroid
            ex, ey = cs.PARTS_AT[pid]
            self.assertLess(np.hypot(cx - ex, cy - ey), 60, pid)

    def test_a_fusion_with_the_biggest_piece_is_named(self):
        sticky = spec.character("AAW-25")
        intact, _ = parts.islands(key.cut(cs.parts_sheet()[0], cs.MAGENTA)[0])
        got, _, _ = parts.assign(intact, sticky["parts"])
        self.assertEqual(parts.fused(intact, got, sticky["parts"], short=0), [])
        # The right arm drawn touching the body: one drawing where two should be.
        canvas = np.zeros((cs.H, cs.W, 4), np.uint8)
        layers = cs.part_layers()
        for pid, (x, y) in cs.PARTS_AT.items():
            if pid == "arm-r":
                x = 768 - 0.85 * (cs.TORSO[2] - cs.TORSO[0]) / 2 - 40  # against the torso's left side
            s = 1.0 if pid.startswith("pupil") else cs.PARTS_R
            cs.place(canvas, cs.scaled(cs.crop(layers[pid]), s), x, y)
        pieces, _ = parts.islands(key.cut(cs.on_key(canvas), cs.MAGENTA)[0])
        self.assertEqual(len(pieces), len(sticky["parts"]) - 1)
        got, _, _ = parts.assign(pieces, sticky["parts"])
        named = parts.fused(pieces, got, sticky["parts"], short=1)
        self.assertEqual(named[0][0], "torso")

    def test_reading_order(self):
        def piece(x, y, w=40, h=40):
            ys, xs = np.mgrid[y : y + h, x : x + w]
            return parts.Island(ys.ravel(), xs.ravel())

        ps = [piece(500, 100), piece(100, 110), piece(300, 400), piece(100, 380)]
        self.assertEqual(parts.reading_order(ps), [1, 0, 3, 2])


if __name__ == "__main__":
    unittest.main()
