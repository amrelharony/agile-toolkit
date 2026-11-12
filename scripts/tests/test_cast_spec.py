"""The builder reads every threshold from docs/cast/cast-rig.json and keeps none of
its own; the counts and layout it relies on are the brief's own words.

    python -I -m unittest discover -s scripts/tests -p "test_cast_*.py"
"""

import json
import re
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

from cast import checks, parts, spec  # noqa: E402

ROOT = HERE.parents[1]
CAST = ROOT / "scripts" / "cast"
SPEC = json.loads((ROOT / "docs" / "cast" / "cast-rig.json").read_text(encoding="utf-8"))
BRIEF = (CAST / "brief-blocks.mjs").read_text(encoding="utf-8")
SOURCES = [p for p in [*sorted(CAST.glob("*.py")), ROOT / "scripts" / "build-cast-rigs.py"] if p.exists()]


class Tolerances(unittest.TestCase):
    def test_checks_use_the_spec_unchanged(self):
        self.assertEqual(checks.TOL, SPEC["tolerances"])
        self.assertIs(checks.TOL, spec.TOL)

    def test_every_threshold_named_in_the_code_is_in_the_spec(self):
        used = set()
        for p in SOURCES:
            used |= set(re.findall(r"TOL\[[\"']([a-z0-9_]+)[\"']\]", p.read_text(encoding="utf-8")))
        self.assertTrue(used)
        self.assertEqual(sorted(used - set(SPEC["tolerances"])), [])

    # Comparisons with a bare number that are no threshold: maths, counts the
    # format fixes, and the alpha scale's top. Anything else must be a TOL key.
    NOT_THRESHOLDS = {
        "imaging.py": ["if r <= 2:", "<= 180", "h1p + h2p < 360"],  # a helper's switch; CIEDE2000's hue
        "key.py": [">= 255 - k", "< 255 - k", "len(r) <= 2 * smax"],  # alpha's top; autocorrelation lags
        "palette.py": ["len(label.split()) <= 2", ">= 255 - TOL"],  # reading a block's label
        "publish.py": ["len(sizes) == 2"],  # the 1x and the 2x atlas
        "register.py": ["if n < 4:", "axis == 2", "len(g) < 5", "len(xs) < 3"],  # NCC, the 5-point step, a circle
        "rig.py": ["len(pupil_ids) == 2"],  # a pair
        "spec.py": ["fewest <= len(sig) <= 2"],  # the contract's one or two tap moves
        "swaps.py": ["ring.sum() < 4"],  # a mean needs a few pixels
    }

    def test_the_builder_compares_against_no_number_of_its_own(self):
        cmp = re.compile(r"(?<![<>])(?:[<>]=?|==)(?![<>=])\s*(-?\d+\.\d+|-?[2-9]\d*|1\d+)\b")
        found = []
        for p in SOURCES:
            code = re.sub(r'"""[\s\S]*?"""|#.*', "", p.read_text(encoding="utf-8"))
            allowed = self.NOT_THRESHOLDS.get(p.name, [])
            for line in code.splitlines():
                if cmp.search(line) and not any(a in line for a in allowed):
                    found.append(f"{p.name}: {line.strip()}")
        # A comparison with a bare number other than 0 or 1 would be a threshold.
        self.assertEqual(found, [])
        self.assertIn(CAST / "checks.py", SOURCES)

    def test_a_mask_is_cut_at_one_named_alpha(self):
        for p in SOURCES:
            code = re.sub(r'"""[\s\S]*?"""|#.*', "", p.read_text(encoding="utf-8"))
            self.assertNotRegex(code, r"(?<![\w.])(?:> 127|>= 128|< 128)\b", p.name)
        self.assertEqual(spec.SOLID_ALPHA, 128)

    def test_each_tolerance_means_one_thing(self):
        # A white is at least white_l_min light, a dark pixel at most dark_l_max:
        # one key once served both, as 100 - L for one and L for the other.
        self.assertGreater(spec.TOL["white_l_min"], spec.TOL["dark_l_max"])
        # speck_px is a length (an island's long side), speck_area_px a pixel count.
        self.assertIn("speck_area_px", spec.TOL)

    def test_chatgpt_sees_only_asks_and_what_the_site_absorbs(self):
        for k in SPEC["shown_to_chatgpt"]:
            self.assertIn(k, SPEC["tolerances"])

    def test_ranges_and_pack_settings_are_in_the_spec(self):
        self.assertEqual(spec.range_for("head"), SPEC["ranges"]["head"])
        self.assertEqual(spec.range_for("arm-r"), SPEC["ranges"]["arm"])
        self.assertEqual(spec.range_for("leg-hl"), SPEC["ranges"]["leg"])
        self.assertEqual(spec.range_for("tentacle-3"), SPEC["ranges"]["tentacle"])
        self.assertEqual(spec.range_for("limb-mid-r"), SPEC["ranges"]["limb"])
        self.assertEqual(spec.range_for("pupil-r"), 0)
        self.assertEqual(spec.PACK, SPEC["pack"])


class TapMovesAndRenderSettings(unittest.TestCase):
    # What each tap move needs on the rig (src/lib/cast/clips.ts: the sockets its
    # tracks turn, the swaps it shows).
    NEEDS = {
        "tail": {"tail"},
        "ears": {"ear-r", "ear-l"},
        "flap": {"flap"},
        "quills": {"quills"},
        "load": {"load"},
        "fan": {"fan-open", "fan-closed"},
    }
    POSES = {"prop": [("arm-l", "sig")], "chin": [("arm-l", "chin")], "wave": [("arm-r", "wave")], "point": [("arm-r", "point")], "open": [("arm-r", "open"), ("arm-l", "open")]}

    def test_every_character_has_one_or_two_moves_its_rig_can_play(self):
        for c in SPEC["characters"]:
            self.assertIsNone(spec.signature_problem(c.get("signature"), c["id"]), c["id"])
            pieces = {*c["parts"], *(c.get("parts2") or [])}
            poses = set(spec.arm_poses(c)) if "arms" in c["images"] else set()
            for sid in c["signature"]:
                name = sid.split(".", 1)[1]
                if name in self.NEEDS:
                    self.assertLessEqual(self.NEEDS[name], pieces, (c["id"], sid))
                if name in self.POSES:
                    self.assertLessEqual(set(self.POSES[name]), poses, (c["id"], sid))
                if name == "ripple":
                    self.assertGreaterEqual(sum(p.startswith(("tentacle-", "limb-")) for p in pieces), 8, c["id"])
        self.assertEqual(spec.signature_problem(["sig.hop", "sig.hop"]), "the same tap move twice")
        self.assertIsNotNone(spec.signature_problem([], "AAW-04"))
        self.assertIsNone(spec.signature_problem([], "AAW-01"))  # Amr's plays only in the intros
        self.assertIsNotNone(spec.signature_problem(["sig.a", "sig.b", "sig.c"], "AAW-01"))
        self.assertIsNotNone(spec.signature_problem(["hop"]))
        self.assertEqual(spec.character("AAW-01")["signature"], [])

    def test_arm_parts_name_a_front_pair_of_the_characters_own_pieces(self):
        for c in SPEC["characters"]:
            arm_parts = c.get("arm_parts")
            if not arm_parts:
                continue
            self.assertIn("arms", c["images"], c["id"])
            self.assertEqual(sorted(arm_parts), ["arm-l", "arm-r"], c["id"])
            self.assertLessEqual(set(arm_parts.values()), {*c["parts"], *(c.get("parts2") or [])}, c["id"])
            self.assertNotIn("arm-r", c["parts"], c["id"])

    def test_every_face_base_names_pieces_the_character_has(self):
        # face_base says what the face cells hold, from each brief's FACE PIECE: the
        # head (ears drawn on it or left off), the head with its ear pieces, the
        # whole body, or the top of the body. The builder lays the cells on exactly that.
        from cast import rig

        self.assertEqual(sorted(rig.FACE_BASE), ["body", "body-top", "head", "head+ears"])
        for c in SPEC["characters"]:
            kind = c.get("face_base")
            self.assertIn(kind, rig.FACE_BASE, c["id"])
            pieces = {*c["parts"], *(c.get("parts2") or [])}
            self.assertIn(rig.FACE_BASE[kind][0], pieces, c["id"])
            self.assertEqual(kind.startswith("body"), "head" not in pieces, c["id"])
            if kind == "head+ears":
                self.assertLessEqual({"ear-r", "ear-l"}, pieces, c["id"])
        for host, extras in rig.FACE_BASE.values():
            for pid in ("tie", "cord", "collar"):  # no face cell holds them
                self.assertFalse(pid.startswith(extras), (host, pid))

    def test_translucency_is_an_opacity(self):
        for c in SPEC["characters"]:
            if "translucent" in c:
                self.assertTrue(0 < c["translucent"] < 1, c["id"])

    def test_no_part_turns_past_what_a_clip_may_turn_it(self):
        import cast_contract as contract
        from cast import rig

        for c in SPEC["characters"]:
            for pid in [*c["parts"], *(c.get("parts2") or [])]:
                sock = rig.socket_of(pid)
                if sock:
                    self.assertLessEqual(spec.range_for(pid), contract.turn_limit(sock), (c["id"], pid))
        self.assertGreater(spec.range_for("load"), 0)  # sig.load turns it, so C7 sweeps it


class BriefAgreement(unittest.TestCase):
    def test_the_image_names_regex_is_the_contracts(self):
        doc = (ROOT / "docs" / "cast" / "CAST-BUILD.md").read_text(encoding="utf-8")
        self.assertIn(spec.NAME_RE.pattern, doc)
        self.assertTrue(spec.NAME_RE.match("AAW-04_master.png"))
        self.assertTrue(spec.NAME_RE.match("AAW-30_parts2-v3.png"))
        self.assertFalse(spec.NAME_RE.match("AAW-31_master.png"))
        self.assertFalse(spec.NAME_RE.match("AAW-04_master.jpg"))
        self.assertFalse(spec.NAME_RE.match("../AAW-04_master.png"))
        self.assertEqual(spec.parse_image_name("AAW-04_parts-v2.png"), ("AAW-04", "parts", 2))

    def test_cell_counts_are_the_briefs(self):
        self.assertIn("eight times, in two rows of four", BRIEF)
        self.assertIn("His head two times in one row", BRIEF)
        self.assertIn("Eight whole arms in two rows of four", BRIEF)
        self.assertIn("His four whole arms in one row", BRIEF)
        self.assertEqual((spec.FACE_CELLS, spec.FACE2_CELLS, spec.ARM_CELLS, spec.AMR_ARM_CELLS), (8, 2, 8, 4))
        amr, beaver = spec.character("AAW-01"), spec.character("AAW-04")
        self.assertEqual(spec.cell_count(amr, "arms"), 4)
        self.assertEqual(spec.cell_count(beaver, "arms"), 8)
        self.assertEqual(spec.cell_count(beaver, "parts"), len(beaver["parts"]))

    def test_face_and_arm_cells_follow_the_briefs_order(self):
        self.assertRegex(BRIEF, r"1 eyes open.*2 eyes shut in a blink.*3 happy.*4 surprised")
        self.assertRegex(BRIEF, r"5 the master's own mouth; 6 a big, warm smile; 7 open wide.*8 a small round")
        self.assertRegex(BRIEF, r"1 waving.*2 straight up.*3 the forearm forward.*4 pointing")
        self.assertRegex(BRIEF, r"5 straight up.*6 the forearm forward.*7 the hand lightly at the chin.*8 the SIGNATURE ARM")
        self.assertEqual([p for _, p in spec.ARM_POSES], ["wave", "up", "open", "point", "up", "open", "chin", "sig"])
        self.assertEqual([s for s, _ in spec.ARM_POSES[:4]], ["arm-r"] * 4)

    def test_the_layout_prior_is_the_parts_briefs(self):
        for words in (
            "the head at the top in the middle",
            "the pupils just below it",
            "the body in the middle, with the tie and the lanyard just to your right of it",
            "the character's right arm on your left of the body and its left arm on your right",
            "the legs below the body, the right leg on your left",
            "a tail and anything else at the sides wherever there is room",
            "hanging straight down",
            "in tidy rows from left to right in the order of the list",
        ):
            self.assertIn(words, BRIEF)
        L = parts.LAYOUT
        self.assertLess(L["head"][1], L["torso"][1])
        self.assertLess(L["head"][1], L["pupil-r"][1])
        self.assertGreater(L["tie"][0], L["torso"][0])
        self.assertLess(L["arm-r"][0], L["torso"][0])
        self.assertGreater(L["arm-l"][0], L["tie"][0])
        self.assertGreater(L["leg-r"][1], L["torso"][1])
        self.assertLess(L["leg-r"][0], L["leg-l"][0])
        # A second pair of legs is legs: below the body, each on its own side.
        self.assertLess(L["limb-mid-r"][0], L["leg-r"][0])
        self.assertLess(L["leg-l"][0], L["limb-mid-l"][0])
        self.assertGreater(min(L["limb-mid-r"][1], L["limb-mid-l"][1]), L["torso"][1])
        self.assertIn("tail", parts.SIDES)
        self.assertFalse(set(parts.SIDES) & set(L))
        # Arms and legs hang straight down: taller than wide.
        for pid in ("arm-r", "leg-r", "limb-mid-r"):
            self.assertGreater(parts.shape_of(pid)[2][0], 1, pid)

    def test_targets(self):
        self.assertEqual(spec.targets("A"), SPEC["batches"]["A"])
        self.assertEqual(spec.targets("AAW-04"), ["AAW-04"])
        self.assertEqual(len(spec.targets("all")), 30)
        with self.assertRaises(SystemExit):
            spec.targets("Z")


class Custody(unittest.TestCase):
    def test_private_output_never_lands_in_a_git_work_tree(self):
        import tempfile

        from cast import review, rig

        for inside in (ROOT, ROOT / "review", ROOT / "docs" / "cast" / "new", ROOT.parent):
            with self.assertRaises(SystemExit, msg=str(inside)):
                spec.private_dir(inside)
        with self.assertRaises(SystemExit):
            review.review_dir(Path(tempfile.mkdtemp()), "A", ROOT / "review")
        with self.assertRaises(SystemExit):
            rig.candidate("AAW-25", Path(tempfile.mkdtemp()), review_root=ROOT / "review", clips={"clips": {}, "maxMs": 900})
        self.assertFalse((ROOT / "review").exists())
        outside = Path(tempfile.mkdtemp(prefix="cast-private-"))
        self.assertEqual(spec.private_dir(outside / "review"), outside / "review")
        repo_like = outside / "other-repo"
        (repo_like / ".git").mkdir(parents=True)
        with self.assertRaises(SystemExit):
            spec.private_dir(repo_like / "review")

    @unittest.skipUnless(
        (spec.DEFAULT_SOURCES / "sources" / "blocks" / "AAW-25.txt").exists(), "the private sources are not on this machine"
    )
    def test_the_synthetic_puppet_is_painted_far_from_the_real_one(self):
        # Distances only: no swatch is printed, even when this fails.
        import numpy as np

        import cast_synth as cs
        from cast import imaging as im
        from cast import palette

        swatches = [im.hex_lab(h) for _, h in palette.block_colours(spec.DEFAULT_SOURCES, "AAW-25")]
        self.assertTrue(swatches)
        for name, rgb in cs.PALETTE.items():
            near = min(float(im.de00(im.lab(np.array(rgb, float)), s)) for s in swatches)
            self.assertTrue(near > spec.TOL["de00_regen"], f"cast_synth's {name} is within de00_regen of a swatch")


if __name__ == "__main__":
    unittest.main()
