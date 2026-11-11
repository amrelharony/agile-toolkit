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

    def test_the_checks_compare_against_no_number_of_their_own(self):
        text = (CAST / "checks.py").read_text(encoding="utf-8")
        code = re.sub(r'"""[\s\S]*?"""|#.*', "", text)
        # A comparison with a bare number other than 0 or 1 would be a threshold.
        found = re.findall(r"(?:[<>]=?|==)\s*(-?\d+\.\d+|-?[2-9]\d*|1\d+)\b", code)
        self.assertEqual(found, [])

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

    def test_targets(self):
        self.assertEqual(spec.targets("A"), SPEC["batches"]["A"])
        self.assertEqual(spec.targets("AAW-04"), ["AAW-04"])
        self.assertEqual(len(spec.targets("all")), 30)
        with self.assertRaises(SystemExit):
            spec.targets("Z")


if __name__ == "__main__":
    unittest.main()
