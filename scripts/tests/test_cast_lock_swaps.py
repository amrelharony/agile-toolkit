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
from cast import checks, key, palette, parts, spec, swaps  # noqa: E402
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

    def test_a_sheet_drawn_far_from_the_master_fails_c9(self):
        master, _ = key.cut(cs.master_png(), cs.MAGENTA)  # as the candidate has it
        seeds = np.array([im.lab(np.array(c, float)) for c in (cs.BODY, cs.FLAP, cs.LIMB, cs.GLOVE, cs.INK)])
        targets, named = palette.sheet_targets(master, seeds)
        self.assertTrue(named[:5].all())
        sheet, _ = key.cut(cs.parts_sheet()[0], cs.MAGENTA)
        _, rows = palette.lock(sheet, targets)
        self.assertEqual(checks.c9_sheet("parts", rows, named)["status"], "pass")
        self.assertGreater(rows[0]["share"], TOL["lock_share_min"])  # the body is no edge blend
        for de in (11, 15):  # past de00_regen: moved by the lock, or too far for it to move
            off = shifted(cs.BODY, de, axes=((1, 0, 0), (0, 1, 0), (0, 0, -1)))
            _, rows = palette.lock(recolour(sheet, cs.BODY, off), targets)
            res = checks.c9_sheet("parts", rows, named)
            self.assertEqual(res["status"], "fail", (de, rows[0]))
            self.assertIn("regenerate", " ".join(res["notes"]))
        off = shifted(cs.BODY, 9, axes=((1, 0, 0), (0, 1, 0)))
        _, rows = palette.lock(recolour(sheet, cs.BODY, off), targets)
        self.assertEqual(checks.c9_sheet("parts", rows, named)["status"], "warn")

    def test_a_colour_the_sheet_lacks_never_takes_one_it_holds(self):
        master, _ = key.cut(cs.master_png(), cs.MAGENTA)
        # A face sheet has no limbs: the limbs' nearest cluster is the ink, which is
        # nearer the ink's own target, so it stays the ink's (the limbs listed
        # first once took it, and the face's outlines went limb grey).
        seeds = np.array([im.lab(np.array(c, float)) for c in (cs.BODY, cs.FLAP, cs.LIMB, cs.GLOVE, cs.INK)])
        targets, _ = palette.sheet_targets(master, seeds)
        face, _ = key.cut(cs.face_sheet(), cs.MAGENTA)
        out, rows = palette.lock(face, targets)
        self.assertFalse(rows[2]["moved"])
        self.assertIn(rows[2]["why"], ("taken", "clamped", "far"))
        self.assertTrue(rows[4]["moved"])
        self.assertLess(rows[4]["after"], 1)

    def test_clusters_are_deterministic(self):
        lab, _ = palette._pixels(cs.master_rgba())
        seeds = np.array([im.lab(np.array(cs.BODY, float))])
        a = palette.clusters(lab, seeds)
        b = palette.clusters(lab, seeds)
        np.testing.assert_array_equal(a[0], b[0])


class Face(unittest.TestCase):
    STATES = tuple(spec.FACE_STATES)

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

    def test_a_rig_with_no_pupils_keeps_its_drawn_wide_eyes(self):
        # Amr's eyes are drawn whole in his head, with no pupil pieces to show in an
        # emptied white: his wide eyes keep the iris and pupil they are drawn with.
        states = (("eyes", "open"), ("eyes", "closed"), ("eyes", "happy"), ("eyes", "wide"),
                  ("mouth", "rest"), ("mouth", "smile"), ("mouth", "open"), ("mouth", "o"))
        got = swaps.face_patches(self.cells(cs.FACE_CELLS), states, self.base, empty_whites=False)
        wide = got["eyes"]["choices"]["wide"]
        ys, xs = np.nonzero(wide[..., 3] > 200)
        L = im.lab(wide[ys, xs, :3].astype(float))[:, 0]
        for i, (x, y) in enumerate(cs.EYES):
            d = 8 if i == 0 else -8  # where cast_synth draws each pupil
            near = np.hypot(xs - (x + d), ys - (y + 4)) < cs.PUPIL_R - 4
            self.assertTrue(near.any())
            self.assertLess(L[near].max(), TOL["dark_l_max"])
        area = (self.base[..., 3] >= spec.SOLID_ALPHA).sum()
        self.assertEqual(len(swaps.drawn_pupils(wide, got["eyes"]["box"], area=area)), 2)

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

    def test_the_bands_follow_the_eyes_under_a_tall_crest(self):
        # A face piece with a crest as tall as the head above it (an antenna, a
        # crest, tall ears): its eyes sit below the fixed eyes band's share of the
        # box, so only bands read from the cells keep them.
        drop = 380

        def head(**cfg):
            img = np.zeros_like(cs.torso())
            img[drop:] = cs.torso(**cfg)[:-drop]
            p = cs.Pen()
            p.line([(768, cs.TORSO[1] + drop + 4), (768, 44)], width=6)
            p.ellipse((752, 24, 784, 56), cs.FLAP)
            return cs.over(img, p.done())

        base = head(pupils=True)
        cells = [cs.scaled(cs.crop(head(pupils=cfg["eyes"] in ("open", "wide"), **cfg)), 0.62) for cfg in cs.FACE_CELLS]
        hb = im.mask_bbox(base[..., 3] >= spec.SOLID_ALPHA)
        eye_rows = (cs.EYES[0][1] - cs.EYE_R + drop - hb[1]) / (hb[3] - hb[1])
        self.assertGreater(eye_rows, TOL["face_eyes_bottom"])  # the whole eye is below the fixed band
        got = swaps.face_patches(cells, self.STATES, base)
        self.assertEqual(got["report"]["notes"], [])
        for row in got["report"]["cells"]:
            self.assertEqual(row["status"], "pass", row)
        self.assertEqual(sorted(got["eyes"]["choices"]), ["closed", "happy", "wide"])
        ex0, ey0, ex1, ey1 = got["eyes"]["box"]
        y = cs.EYES[0][1] + drop
        self.assertLessEqual(ey0, y - cs.EYE_R - 12)  # the wide eye, whole
        self.assertGreaterEqual(ey1, y + cs.EYE_R + 12)
        self.assertLess(got["bands"]["eyes"][1], got["bands"]["mouth"][1])
        # The fixed shares of the box would refuse every eye state.
        fixed = swaps.face_patches(cells, self.STATES, base, bands=swaps.head_bands(hb))
        self.assertTrue(all(r["status"] == "fail" for r in fixed["report"]["cells"] if r["slot"] == "eyes" and r["state"] != "open"))

    def test_a_face_cell_finds_its_place_on_a_piece_that_carries_more(self):
        # The face cells hold the head; the piece they are laid on goes on below them:
        # a narrower neck past the chin, or the body under a face cut below the mouth
        # that widens toward its hem.
        def neck():
            p = cs.Pen()
            p.rect((700, cs.TORSO[3] - 10, 836, 960), cs.FLAP)
            return p.done()

        def hem():
            p = cs.Pen()
            x0, y0, x1, y1 = cs.TORSO
            p.poly([(x0, y1 - 60), (x1, y1 - 60), (x1 + 110, 990), (x0 - 110, 990)], cs.BODY)
            return p.done()

        cut = cs.TORSO[3] - 70  # a little below the mouth
        for name, under in (("neck", neck()), ("hem", hem())):
            base = cs.over(under, cs.torso(pupils=True))
            cell = cs.torso(pupils=True)
            if name == "hem":
                cell[cut:] = 0
            cell = cs.scaled(cs.crop(cell), 0.62)
            hb = im.mask_bbox(base[..., 3] >= spec.SOLID_ALPHA)
            # The boxes' height ratio alone starts the search far off the cell's scale.
            self.assertLess(cell.shape[0] / (hb[3] - hb[1]), 0.62 * (1 - TOL["face_scale_search"]), name)
            self.assertAlmostEqual(swaps.seed_scale(cell, base[..., 3] >= spec.SOLID_ALPHA, hb), 0.62, delta=0.62 * TOL["face_scale_search"])
            reg = swaps.register_head(cell, base)
            self.assertIsNotNone(reg, name)
            self.assertAlmostEqual(reg.r, 0.62, delta=0.01, msg=name)
            self.assertGreaterEqual(reg.ncc, TOL["face_ncc_min"], name)
            top = cs.TORSO[1] + (cs.crop(cell).shape[0] / reg.r) / 2
            self.assertAlmostEqual(reg.cy, top, delta=6, msg=name)

    def test_a_face_cut_below_the_mouth_patches_the_top_of_its_body(self):
        # The face cells are the top of a tall body (cut a little below the mouth);
        # they are laid on its top, and what a state may change outside its band is
        # a share of the face they show, not of the whole body.
        p = cs.Pen()
        x0, y0, x1, y1 = cs.TORSO
        p.poly([(x0, y1 - 60), (x1, y1 - 60), (x1 + 110, 990), (x0 - 110, 990)], cs.BODY)
        hem = p.done()
        cut = y1 - 70

        def top(**cfg):
            img = cs.torso(pupils=cfg.get("eyes", "open") in ("open", "wide"), **cfg)
            img[cut:] = 0
            return cs.scaled(cs.crop(img), 0.62)

        base = cs.over(hem, cs.torso(pupils=True))
        cells = [top(**cfg) for cfg in cs.FACE_CELLS]
        cells[1] = top(eyes="closed", mouth="open")  # a blink that opened the mouth too
        got = swaps.face_patches(cells, self.STATES, base)
        self.assertEqual(got["report"]["notes"], [])
        rows = got["report"]["cells"]
        for n, row in enumerate(rows):
            self.assertEqual(row["status"], "fail" if n == 1 else "pass", row)
        self.assertGreater(rows[1]["outside"], TOL["face_outside_max"])
        self.assertEqual(sorted(got["mouth"]["choices"]), ["o", "open", "smile"])
        self.assertEqual(sorted(got["eyes"]["choices"]), ["happy", "wide"])

    def test_an_open_jaw_may_drop_over_the_neck_its_piece_carries(self):
        # A head piece that carries its neck past the chin: the open mouth's jaw
        # drops below the chin the cells show, over the neck, and is still the mouth's.
        p = cs.Pen()
        p.rect((700, cs.TORSO[3] - 10, 836, 960), cs.FLAP)
        neck = p.done()

        def cell(**cfg):
            img = cs.torso(pupils=cfg["eyes"] in ("open", "wide"), **cfg)
            if cfg["mouth"] == "open":
                q = cs.Pen()
                q.ellipse((668, cs.TORSO[3] - 40, 868, cs.TORSO[3] + 60), cs.BODY)
                img = cs.over(q.done(), img)
            return cs.scaled(cs.crop(img), 0.62)

        base = cs.over(neck, cs.torso(pupils=True))
        got = swaps.face_patches([cell(**cfg) for cfg in cs.FACE_CELLS], self.STATES, base)
        for row in got["report"]["cells"]:
            self.assertEqual(row["status"], "pass", row)
        self.assertGreater(got["mouth"]["box"][3], cs.TORSO[3] + 40)

    def test_bands_stand_in_from_the_hosts_box_when_the_cells_cant_show_them(self):
        def rows(a, b):
            m = np.zeros((400, 300), bool)
            m[a:b, 100:200] = True
            return m

        box, host = (0, 0, 300, 400), (0, 100, 300, 400)
        eyes = {("eyes", s): rows(100, 140) for s in ("closed", "happy", "wide")}
        mouth = {("mouth", s): rows(240, 280) for s in ("smile", "open", "o")}
        bands, why = swaps.face_bands({**eyes, **mouth}, box, host)
        self.assertIsNone(why)
        self.assertEqual(bands["eyes"][0], 0)
        self.assertLess(bands["eyes"][1], 240)
        self.assertGreater(bands["mouth"][0], 140)
        self.assertEqual(bands["mouth"][1], 400)
        # One state per slot (face2 alone), or cores that overlap: the fixed shares
        # of the host's own box (no ears), with the reason.
        bands, why = swaps.face_bands({("eyes", "curious"): rows(100, 140), ("mouth", "talk"): rows(240, 280)}, box, host)
        self.assertIn("eyes: 1 state(s)", why)
        self.assertEqual(bands, swaps.head_bands(host))
        bands, why = swaps.face_bands({**eyes, **{k: rows(110, 150) for k in mouth}}, box, host)
        self.assertIn("overlap", why)
        # A single state's stray change (a blink that also opened the mouth) is no core.
        stray = {**eyes, ("eyes", "closed"): rows(100, 140) | rows(240, 290)}
        bands, why = swaps.face_bands({**stray, **mouth}, box, host)
        self.assertIsNone(why)
        self.assertLess(bands["eyes"][1], 240)

    def test_fill_whites(self):
        img = cs.torso(pupils=True)
        x0, y0 = cs.EYES[0][0] - 60, cs.EYES[0][1] - 60
        box = (x0, y0, x0 + 120, y0 + 120)
        out = swaps.fill_whites(img, box)
        x, y = cs.EYES[0]
        white = im.lab(np.array(cs.WHITE, float))[0]
        self.assertAlmostEqual(im.lab(out[y + 4, x + 8, :3].astype(float))[0], white, delta=3)
        np.testing.assert_array_equal(out[:, x0 + 200 :], img[:, x0 + 200 :])  # nothing else
        # C10 reads the same: a pupil drawn into the eye, and none once painted out.
        self.assertEqual(len(swaps.drawn_pupils(img, box)), 1)
        self.assertEqual(swaps.drawn_pupils(out, box), [])
        self.assertEqual(swaps.drawn_pupils(cs.torso(pupils=False), box), [])


# A made-up face for the eye tests, in colours of its own (no character's): a pale
# near-grey fur and a cream blaze both pass the generic white test, as a pale
# yellow eye white does not.
FUR = (196, 192, 204)
CREAM = (236, 232, 214)
EYE = (250, 250, 250)
YELLOW_EYE, YELLOW_LOW = (246, 232, 150), (236, 190, 90)
GREENISH = (128, 168, 120)
IRIS = (150, 96, 40)  # L* about 45: above dark_l_max
TEAL_IRIS = (40, 170, 120)  # L* about 61, strongly coloured
BLUSH = (210, 120, 160)
EYES_AT, EYE_R2, IRIS_R, CENTRE_R = ((140, 160), (280, 160)), 44, 24, 10
EYES_BOX = (70, 70, 350, 230)


def lab_of(*rgbs):
    return np.array([im.lab(np.array(c, float)) for c in rgbs])


def eye_head(skin, white, lower=None, blaze=None, pupils=None, iris=None, brows=True, size=(420, 360)):
    """The test face: a round head in `skin` (a blaze between the eyes when given),
    two ink-outlined eyes in `white` (their lower part in `lower`), ink brows and
    whiskers on the skin, a mouth; pupils "dark" (an ink disc), "iris" (an `iris`
    disc round an ink centre with a white highlight) or "blob" (an `iris` disc, no
    dark core)."""
    p = cs.Pen(*size)
    p.ellipse((20, 20, size[0] - 20, size[1] - 20), skin)
    if blaze:
        p.ellipse((180, 110, 240, 300), blaze, outline=None)
    for x, y in EYES_AT:
        r = EYE_R2
        p.ellipse((x - r, y - r, x + r, y + r), white, width=5)
        if lower:
            p.d.chord([v * cs.SS for v in (x - r + 5, y - r + 5, x + r - 5, y + r - 5)], 30, 150, fill=lower + (255,))
        if pupils in ("iris", "blob"):
            p.ellipse((x - IRIS_R, y - IRIS_R, x + IRIS_R, y + IRIS_R), iris, outline=None)
        if pupils in ("dark", "iris"):
            p.ellipse((x - CENTRE_R, y - CENTRE_R, x + CENTRE_R, y + CENTRE_R), cs.INK, outline=None)
        if pupils == "iris":
            p.ellipse((x + 4, y - 9, x + 10, y - 3), EYE, outline=None)
        if brows:
            p.arc((x - 40, y - 86, x + 40, y - 40), 200, 340, width=8)
        p.line([(x - 70 if x < 210 else x + 40, y + 70), (x - 30 if x < 210 else x + 80, y + 64)], width=4)
    p.arc((170, 230, 250, 290), 20, 160, width=8)
    return p.done()


class EyeColours(unittest.TestCase):
    def block(self, text):
        root = Path(self.tmp.name)
        path = palette.block_path(root, "AAW-25")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return root

    def setUp(self):
        import tempfile

        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_the_block_names_its_eye_whites_and_pupils(self):
        hx = ["#%06X" % (0x101010 * k + 0x0A0B0C) for k in range(1, 11)]
        src = self.block(
            "CHARACTER: TEST\nCOLOURS\n"
            f"- Fur {hx[0]}, shade {hx[1]}.\n"
            f"- Eye whites {hx[2]}, the lower part of each eye shaded {hx[3]}.\n"
            f"- Pupils: plum iris {hx[4]} around a black {hx[5]} centre, with a white highlight.\n"
            f"- Eyebrows {hx[6]}. Highlights white {hx[7]}.\n"
            f"- Eyespot rings {hx[8]} around a navy centre {hx[9]}.\nNEVER\n- Nothing.\n"
        )
        self.assertEqual(len(palette.block_colours(src, "AAW-25")), 10)
        self.assertEqual(palette.eye_roles(src, "AAW-25"), {"white": [2, 3], "pupil": [4, 5]})
        src = self.block(f"COLOURS\n- Eyes white {hx[0]}. Pupils, eyebrows and outlines near-black {hx[1]}.\n")
        self.assertEqual(palette.eye_roles(src, "AAW-25"), {"white": [0], "pupil": [1]})
        src = self.block(f"COLOURS\n- Irises {hx[0]}, pupils {hx[1]}, eye whites {hx[2]}. Shirt white {hx[3]}.\n")
        self.assertEqual(palette.eye_roles(src, "AAW-25"), {"white": [2], "pupil": [0, 1]})
        src = self.block(f"COLOURS\n- Body {hx[0]}, shade {hx[1]}.\n")
        self.assertEqual(palette.eye_roles(src, "AAW-25"), {"white": [], "pupil": []})
        self.assertIsNone(swaps.Eyes.of(lab_of(cs.BODY, cs.INK), [], [1]))

    def test_tinted_whites_are_found_by_the_characters_own_colour(self):
        # Pale yellow whites, shaded deeper below: no generic white at all.
        head = eye_head(GREENISH, YELLOW_EYE, lower=YELLOW_LOW)
        master = eye_head(GREENISH, YELLOW_EYE, lower=YELLOW_LOW, pupils="dark")
        self.assertEqual(swaps.pupils_from_master(master, head), [])
        eyes = swaps.Eyes.of(lab_of(GREENISH, YELLOW_EYE, YELLOW_LOW, cs.INK), [1, 2], [3])
        got = swaps.pupils_from_master(master, head, eyes)
        self.assertEqual(len(got), 2)
        for p, (x, y) in zip(got, EYES_AT):
            self.assertGreaterEqual(p["diameter"], TOL["pupil_min_px"])
            self.assertTrue(p["mask"][y, x])
        self.assertEqual(swaps.drawn_pupils(head, EYES_BOX, eyes), [])
        self.assertEqual(len(swaps.drawn_pupils(master, EYES_BOX, eyes)), 2)
        light = swaps.whites(head, eyes)
        self.assertTrue(light[EYES_AT[0][1] + 30, EYES_AT[0][0]])  # the shaded lower part too
        for p in got:
            self.assertNotIn(0, swaps.pupil_travel(p["mask"], light))

    def test_pale_fur_brows_and_outlines_are_no_pupils(self):
        # The fur and the blaze both pass the generic white test.
        self.assertTrue(swaps._light(lab_of(FUR, CREAM)).all())
        eyes = swaps.Eyes.of(lab_of(FUR, CREAM, EYE, cs.INK), [2], [3])
        empty = eye_head(FUR, EYE, blaze=CREAM)
        drawn = eye_head(FUR, EYE, blaze=CREAM, pupils="dark")
        for e in (None, eyes):  # by its own colours, and by size where it has none
            self.assertEqual(swaps.drawn_pupils(empty, EYES_BOX, e), [], e)
            np.testing.assert_array_equal(swaps.fill_whites(empty, EYES_BOX, e), empty)
            self.assertEqual(len(swaps.drawn_pupils(drawn, EYES_BOX, e)), 2)
            filled = swaps.fill_whites(drawn, EYES_BOX, e)
            self.assertEqual(swaps.drawn_pupils(filled, EYES_BOX, e), [])
            x, y = EYES_AT[0]
            np.testing.assert_array_equal(filled[y - 70 : y - 40, x - 40 : x + 40], drawn[y - 70 : y - 40, x - 40 : x + 40])  # the brow
            got = swaps.pupils_from_master(drawn, empty, e)
            self.assertEqual([bool(p["mask"][y, x]) for p, (x, y) in zip(got, EYES_AT)], [True, True])

    def test_a_near_white_fur_the_eye_white_shares_is_no_eye(self):
        # Fur within eye_same_de00 of the eye white: colour can't tell them apart, so
        # the fur, one big patch, is left out by its size.
        fur = (246, 244, 240)
        self.assertLess(float(im.de00(lab_of(fur)[0], lab_of(EYE)[0])), TOL["eye_same_de00"])
        eyes = swaps.Eyes.of(lab_of(fur, EYE, cs.INK), [1], [2])
        empty, drawn = eye_head(fur, EYE), eye_head(fur, EYE, pupils="dark")
        self.assertEqual(swaps.drawn_pupils(empty, EYES_BOX, eyes), [])
        self.assertEqual(len(swaps.drawn_pupils(drawn, EYES_BOX, eyes)), 2)
        light = swaps.whites(empty, eyes)
        self.assertFalse(light[60, 210])  # the fur on the forehead
        self.assertTrue(light[EYES_AT[0][1], EYES_AT[0][0]])

    def test_brows_raised_onto_a_pale_glass_band_stay(self):
        # A body host whose pale glass passes the generic test, a coloured band below
        # it holding the eyes, and the brows raised up onto the glass.
        glass, tea = (226, 228, 224), (150, 90, 50)
        p = cs.Pen(420, 360)
        p.rect((20, 20, 400, 340), glass, radius=10)
        p.rect((26, 120, 394, 334), tea, outline=None)
        p.line([(26, 120), (394, 120)], width=5)
        for x, y in EYES_AT:
            p.ellipse((x - 30, y - 10, x + 30, y + 50), EYE, width=5)
            p.arc((x - 30, y - 80, x + 30, y - 40), 200, 340, width=8)  # on the glass
        cup = p.done()
        eyes = swaps.Eyes.of(lab_of(glass, tea, EYE, cs.INK), [2], [3])
        np.testing.assert_array_equal(swaps.fill_whites(cup, (60, 60, 360, 230), eyes), cup)
        self.assertEqual(swaps.drawn_pupils(cup, (60, 60, 360, 230), eyes), [])

    def test_an_iris_lighter_than_the_dark_cut_comes_whole(self):
        for iris in (IRIS, TEAL_IRIS):
            self.assertGreater(lab_of(iris)[0][0], TOL["dark_l_max"])
            eyes = swaps.Eyes.of(lab_of(FUR, EYE, cs.INK, iris), [1], [2, 3])
            head, master = eye_head(FUR, EYE), eye_head(FUR, EYE, pupils="iris", iris=iris)
            for e in (None, eyes):
                got = swaps.pupils_from_master(master, head, e)
                self.assertEqual(len(got), 2, (iris, e))
                for p, (x, y) in zip(got, EYES_AT):
                    disc = np.pi * IRIS_R**2
                    self.assertGreater(p["mask"].sum(), 0.85 * disc, (iris, e))  # the iris, not its centre
                    self.assertTrue(p["mask"][y - 6, x + 7])  # the highlight moves with it
                    self.assertEqual(int(p["sprite"][y, x + IRIS_R - 4, 3]), 255)
                    self.assertGreaterEqual(p["diameter"], 2 * IRIS_R)
                # The wide eyes' iris and centre are painted out together.
                self.assertEqual(len(swaps.drawn_pupils(master, EYES_BOX, e)), 2)
                filled = swaps.fill_whites(master, EYES_BOX, e)
                self.assertEqual(swaps.drawn_pupils(filled, EYES_BOX, e), [])
                x, y = EYES_AT[0]
                ring = filled[y - IRIS_R + 3 : y + IRIS_R - 3, x - IRIS_R + 3 : x + IRIS_R - 3]
                self.assertTrue(swaps._light(im.lab(ring[..., :3].reshape(-1, 3).astype(float))).all())
        # A coloured mark with no dark core in an eye is no pupil.
        blob = eye_head(FUR, EYE, pupils="blob", iris=BLUSH)
        self.assertEqual(swaps.drawn_pupils(blob, EYES_BOX), [])

    @unittest.skipUnless((spec.DEFAULT_SOURCES / "sources" / "blocks").is_dir(), "the private sources are not on this machine")
    def test_every_private_block_names_its_eye_colours(self):
        # Counts only: no label or swatch is printed, even when this fails.
        missing = []
        for c in spec.SPEC["characters"]:
            cid = c["id"]
            colours = palette.block_colours(spec.DEFAULT_SOURCES, cid)
            roles = palette.eye_roles(spec.DEFAULT_SOURCES, cid)
            print(f"{cid}: {len(roles['white'])} eye-white and {len(roles['pupil'])} pupil colour(s) of {len(colours)}")
            if not roles["white"] or not roles["pupil"]:
                missing.append(cid)
                continue
            lab = np.array([im.hex_lab(h) for _, h in colours])
            eyes = swaps.Eyes.of(lab, roles["white"], roles["pupil"])
            self.assertTrue(swaps.white_px(lab[roles["white"]], eyes).all(), f"{cid}: its own eye white is no white")
            self.assertTrue(swaps.pupil_px(lab[roles["pupil"]], eyes).all(), f"{cid}: its own pupil is no pupil")
        self.assertEqual(missing, [], "these blocks name no eye white or no pupil: the generic tests stand in")


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
