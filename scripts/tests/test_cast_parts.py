"""Slicing a parts sheet, the gaps between pieces, and naming them: Hungarian
matching against brute force, the layout prior on a synthetic exploded sheet, and
the pieces any figure's parts can hold (ears, tails, a coat, a second pair of
legs) named on sheets of plain shapes laid out as imageParts says."""

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
from PIL import Image, ImageDraw  # noqa: E402

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


# ---------- sheets of plain shapes, for naming ----------
# Generic ids in a parts list's order (no character's): a figure with ears and a
# tail, one with neither, one with a coat behind it, and one with a second pair of legs.
EARED = ["head", "ear-r", "ear-l", "pupil-r", "pupil-l", "torso", "tie", "cord", "arm-r", "arm-l", "leg-r", "leg-l", "tail"]
TAILED = [i for i in EARED if not i.startswith("ear-")]
COATED = [i for i in TAILED if i != "tail"] + ["quills"]
SIX_LIMBS = ["head", "pupil-r", "pupil-l", "torso", "arm-r", "arm-l", "limb-mid-r", "limb-mid-l", "leg-r", "leg-l"]
# Where a tail can go "at the sides wherever there is room": the top corners, beside
# the head, outside each arm, the bottom corners.
SPOTS = [(150, 120), (1390, 120), (380, 150), (1160, 150), (150, 520), (1400, 520), (180, 880), (1380, 880)]


def drawn(draw) -> parts.Island:
    img = Image.new("L", (cs.W, cs.H), 0)
    draw(ImageDraw.Draw(img))
    ys, xs = np.nonzero(np.array(img))
    return parts.Island(ys, xs)


def oval(cx, cy, w, h) -> parts.Island:
    return drawn(lambda d: d.ellipse((cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), fill=255))


def bar(cx, cy, w, h) -> parts.Island:
    return drawn(lambda d: d.rounded_rectangle((cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), radius=min(w, h) // 3, fill=255))


def wave(cx, cy, h, thick) -> parts.Island:
    """A thin curve rising in an S."""
    t = np.linspace(0, 1, 60)
    pts = list(zip(cx + 40 * np.sin(2 * np.pi * t), cy + h / 2 - t * h))
    return drawn(lambda d: d.line(pts, fill=255, width=thick, joint="curve"))


def tufted(cx, cy, h, thick) -> parts.Island:
    """A thin line hanging down to a tuft."""

    def draw(d):
        d.line([(cx, cy - h / 2), (cx + 15, cy + h / 4)], fill=255, width=thick)
        d.ellipse((cx - 12, cy + h / 4 - 4, cx + 42, cy + h / 2), fill=255)

    return drawn(draw)


def lanyard(cx, cy) -> parts.Island:
    def draw(d):
        d.line([(cx - 55, cy - 110), (cx, cy + 37), (cx + 55, cy - 110), (cx - 55, cy - 110)], fill=255, width=8)
        d.rectangle((cx - 27, cy + 37, cx + 27, cy + 110), fill=255)

    return drawn(draw)


EARS = {"small": (80, 90, 110), "long": (85, 300, 170), "round": (170, 170, 130)}  # w, h, centre y


def figure(ids, ears="small", **pieces) -> dict:
    """{id: piece} for a big-headed figure laid out as imageParts says, with any
    piece given by keyword instead (a tail, a coat)."""
    w, h, y = EARS[ears]
    at = {
        "head": lambda: oval(768, 160, 300, 260),
        "ear-r": lambda: oval(768 - 208 - (w - 80) / 2, y, w, h),
        "ear-l": lambda: oval(768 + 208 + (w - 80) / 2, y, w, h),
        "pupil-r": lambda: oval(730, 340, 26, 26),
        "pupil-l": lambda: oval(806, 340, 26, 26),
        "torso": lambda: bar(768, 540, 260, 280),
        "tie": lambda: bar(950, 480, 50, 150),
        "cord": lambda: lanyard(1050, 560),
        "arm-r": lambda: bar(440, 540, 70, 300),
        "arm-l": lambda: bar(1200, 540, 70, 300),
        "leg-r": lambda: bar(700, 870, 80, 240),
        "leg-l": lambda: bar(836, 870, 80, 240),
    }
    return {pid: pieces[pid.replace("-", "_")] if pid.replace("-", "_") in pieces else at[pid]() for pid in ids}


def names(sheet: dict, ids, order=None) -> dict:
    """{each piece's true id: the id assign gives it}, the pieces handed over
    biggest first as islands() returns them, or in `order` (true ids)."""
    true = order or sorted(sheet, key=lambda k: -sheet[k].area)
    got, _, _ = parts.assign([sheet[k] for k in true], ids)
    given = {i: pid for pid, i in got.items()}
    return {k: given.get(n) for n, k in enumerate(true)}


class NamingTheBriefsPieces(unittest.TestCase):
    def assertNamed(self, sheet, ids, msg, order=None):
        got = names(sheet, ids, order)
        self.assertEqual({k: v for k, v in got.items() if k != v}, {}, msg)

    def test_every_id_a_parts_sheet_holds_has_a_place_and_a_shape(self):
        for c in spec.SPEC["characters"]:
            for pid in c["parts"]:
                places = [pid in parts.LAYOUT, pid in parts.SIDES, pid in parts.ANYWHERE]
                self.assertEqual(sum(places), 1, f"{c['id']} {pid}")
            for pid in [*c["parts"], *(c.get("parts2") or [])]:
                self.assertIsNotNone(parts.shape_of(pid), f"{c['id']} {pid}")
        for k, (typical, (a0, a1), (t0, t1), stands) in parts.SHAPES.items():
            self.assertTrue(typical > 0 and 0 < a0 < a1 <= 1 and 1 <= t0 < t1, k)
            self.assertIn(stands, (None, "tall", "wide"), k)

    def test_a_coat_bigger_than_the_body_is_named_the_coat(self):
        # A coat behind the whole figure, drawn whole at one side, outsizes the body.
        for x in (160, 1385):
            sheet = figure(COATED, quills=oval(x, 500, 300, 800))
            self.assertGreater(sheet["quills"].area, 2 * sheet["torso"].area)
            self.assertNamed(sheet, COATED, x)
            # And drawn whole, the coat is no fusion of two pieces.
            pieces = [sheet[k] for k in COATED]
            flagged = parts.fused(pieces, {k: n for n, k in enumerate(COATED)}, COATED, short=0)
            self.assertNotIn("quills", [pid for pid, _ in flagged], x)

    def test_ears_long_or_round_and_a_tail_of_any_size_keep_their_names(self):
        for ears, tail in (
            ("long", lambda x, y: oval(x, y, 90, 90)),  # long ears, a ball of a tail
            ("small", lambda x, y: oval(x, y, 80, 120)),  # small ears, a stub
            ("round", lambda x, y: wave(x, y, 300, 6)),  # big round ears, a thin tail
            ("round", lambda x, y: wave(x, y, 300, 24)),
            ("small", lambda x, y: oval(x, y, 170, 360)),  # small ears, a bushy tail
        ):
            for x, y in SPOTS:
                self.assertNamed(figure(EARED, ears, tail=tail(x, y)), EARED, (ears, x, y))

    def test_a_tail_like_an_arm_at_the_sides_keeps_its_name(self):
        for x, y in SPOTS:
            self.assertNamed(figure(TAILED, tail=tufted(x, y, 300, 12)), TAILED, (x, y))
            self.assertNamed(figure(TAILED, tail=oval(x, y, 300, 240)), TAILED, ("fan", x, y))

    def test_a_piece_with_no_place_of_its_own_keeps_its_name(self):
        # A neck laid by its own place, under the head, is still no tie or lanyard.
        ids = ["head", "pupil-r", "pupil-l", "neck", "torso", "load", "tie", "cord"]
        for neck, load in (((768, 400), (300, 700)), ((768, 400), (300, 250)), ((1300, 300), (300, 250))):
            sheet = {
                "head": oval(768, 130, 260, 200),
                "pupil-r": oval(730, 260, 26, 26),
                "pupil-l": oval(806, 260, 26, 26),
                "neck": bar(*neck, 90, 240),
                "torso": bar(768, 600, 400, 260),
                "load": bar(*load, 330, 260),
                "tie": bar(1050, 520, 50, 150),
                "cord": lanyard(1150, 640),
            }
            self.assertNamed(sheet, ids, (neck, load))

    def test_a_second_pair_of_legs_keeps_its_sides(self):
        rng = np.random.default_rng(3)
        legs = {"limb-mid-r": 560, "leg-r": 690, "leg-l": 846, "limb-mid-l": 976}  # from your left
        sheet = figure([i for i in SIX_LIMBS if i not in legs])
        sheet.update({pid: bar(x, 870, 80, 240) for pid, x in legs.items()})
        for _ in range(8):
            order = [str(k) for k in rng.permutation(list(sheet))]
            self.assertNamed(sheet, SIX_LIMBS, order, order=order)

    def test_a_tail_between_an_arm_and_the_body_keeps_its_name(self):
        # Laid where the arm's own point is, a tail is still no pair with the other arm.
        for x, y in ((560, 540), (560, 860)):
            for tail in (oval(x, y, 90, 90), oval(x, y, 80, 120), tufted(x, y, 300, 12)):
                self.assertNamed(figure(TAILED, tail=tail), TAILED, (x, y))
            self.assertNamed(figure(EARED, "long", tail=oval(x, y, 90, 90)), EARED, ("long ears", x, y))

    def test_a_pairs_right_piece_is_the_one_on_your_left(self):
        # A coat far out at one side stretches the sheet's box, so both legs sit to
        # one side of both leg points, and one leg drawn higher than the other is
        # then nearer the wrong point: the side decides.
        for x in (160, 1385):
            for high in ("leg-r", "leg-l"):
                sheet = figure(COATED, quills=oval(x, 500, 300, 800))
                sheet[high] = bar(700 if high == "leg-r" else 836, 790, 80, 240)
                self.assertNamed(sheet, COATED, (x, high))

if __name__ == "__main__":
    unittest.main()
