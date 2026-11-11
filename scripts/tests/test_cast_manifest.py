"""The manifest against the runtime's contract (src/lib/cast/rig-types.ts and
test/cast/rig-manifest.test.tsx): the node count is what CastFigure renders, and
the Python port of the runtime's checks passes its fixtures and catches a broken
rig."""

import copy
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import cast_contract as contract  # noqa: E402

from cast import clips as cast_clips  # noqa: E402
from cast import rig  # noqa: E402
from cast.spec import SPEC  # noqa: E402


class Nodes(unittest.TestCase):
    def test_the_count_is_what_the_figure_renders(self):
        # rig-fixture.ts: 42 and 27, as the runtime's "renders the nodes it counts" holds.
        self.assertEqual(rig.count_nodes(contract.TEST_PUPPET), 42)
        self.assertEqual(rig.count_nodes(contract.ARMLESS_PUPPET), 27)

    def test_pupils_count_inside_each_eye_that_shows_them(self):
        one = copy.deepcopy(contract.TEST_PUPPET)
        one["pupils"]["shownWith"] = ["open"]
        self.assertEqual(rig.count_nodes(one), 40)
        # With no eyes slot to draw them in, the pupils are plain parts.
        plain = copy.deepcopy(contract.ARMLESS_PUPPET)
        plain["swaps"] = [s for s in plain["swaps"] if s["id"] != "eyes"]
        plain["pupils"] = None
        self.assertEqual(rig.count_nodes(plain), 27 - 5 - 4 + 4)

    def test_a_bone_and_a_choice_drawn_over_its_siblings(self):
        bone = copy.deepcopy(contract.ARMLESS_PUPPET)
        bone["parts"][4]["sprite"] = None  # a part that only carries children: one span
        self.assertEqual(rig.count_nodes(bone), 26)
        # arm-l's chin choice has its own z, so its own wrapper: 2 spans + 5 choices.
        arm_l = next(s for s in contract.TEST_PUPPET["swaps"] if s["id"] == "arm-l")
        self.assertEqual(len({c.get("z", arm_l["z"]) for c in arm_l["choices"]}), 2)


def limbed(n=8, legs=True):
    """A made-up rig with n numbered limbs (an octopus-like body) and its tap move."""
    rig_ = copy.deepcopy(contract.ARMLESS_PUPPET)
    rig_["parts"] = [p for p in rig_["parts"] if not p["id"].startswith("leg-") or legs]
    rig_["parts"] += [contract._part(f"tentacle-{i}", "torso", -1, f"limb-{i}", rng=12) for i in range(1, n + 1)]
    rig_["signature"] = ["sig.ripple"]
    return rig_


class Animated(unittest.TestCase):
    def test_the_most_elements_one_clip_moves(self):
        # TEST_PUPPET: the first speaker's matched guess turns the head and the body.
        self.assertEqual(cast_clips.animated(contract.TEST_PUPPET, contract.CLIPS), 2)
        # Eight limbs and ripple: eight, though fourteen parts have a range.
        octo = limbed()
        self.assertEqual(sum(1 for p in octo["parts"] if p["range"]), 14)
        self.assertEqual(cast_clips.animated(octo, contract.CLIPS), 8)
        # Pupils move in every eye choice that draws them.
        eyes = copy.deepcopy(contract.TEST_PUPPET)
        eyes["signature"] = ["sig.eyes"]
        self.assertEqual(cast_clips.animated(eyes, contract.CLIPS), 4)
        # A slot with a choice drawn over its siblings is two spans with its socket.
        chin = copy.deepcopy(contract.TEST_PUPPET)
        chin["signature"] = ["sig.chin"]
        self.assertEqual(cast_clips.elements(chin)["arm-l"], 2)

    def test_an_armless_rig_plays_the_armless_layer(self):
        both = copy.deepcopy(contract.ARMLESS_PUPPET)
        self.assertEqual(cast_clips.animated(both, contract.CLIPS), 2)  # skipped: body + head

    def test_a_tap_move_that_moves_nothing_is_named(self):
        r = copy.deepcopy(contract.ARMLESS_PUPPET)
        r["signature"] = ["sig.ears", "sig.nope"]  # no ears on it
        self.assertEqual(cast_clips.unplayable(r, contract.CLIPS), ["sig.ears: moves nothing on this rig", "sig.nope: no such clip"])
        self.assertEqual(cast_clips.unplayable(limbed(), contract.CLIPS), [])
        self.assertEqual(cast_clips.unplayable(contract.TEST_PUPPET, contract.CLIPS), [])

    @unittest.skipUnless(cast_clips.CLIPS_TS.exists(), "the runtime (src/lib/cast/clips.ts) is not in this tree")
    def test_the_fixture_and_the_spec_agree_with_the_runtimes_clips(self):
        real = cast_clips.load()
        self.assertEqual(real["maxMs"], contract.CLIPS["maxMs"])
        for cid, clip in contract.CLIPS["clips"].items():
            self.assertEqual(real["clips"][cid], clip, cid)
        for c in SPEC["characters"]:
            for sid in c["signature"]:
                self.assertIn(sid, real["clips"], c["id"])
                self.assertLessEqual(real["clips"][sid]["ms"], real["maxMs"], sid)


class RuntimeChecks(unittest.TestCase):
    def test_the_fixtures_are_sound(self):
        self.assertEqual(contract.problems(contract.TEST_PUPPET), [])
        self.assertEqual(contract.problems(contract.ARMLESS_PUPPET), [])

    def test_a_broken_rig_is_caught(self):
        p = contract.TEST_PUPPET["parts"]
        broken = {
            **contract.TEST_PUPPET,
            "parts": [p[1], p[0], {**p[4], "range": 40}, {**p[5], "id": "arm-r", "socket": "arm-r"}],
            "signature": ["sig.nope", "nod", "sig.tail"],
        }
        got = contract.problems(broken)
        for want in ("head: parent first", "tail: range", "arm-r: drawn as a part and a slot", "pupil-r: not on the eyes' host", "signature nod", "one or two signature moves"):
            self.assertIn(want, got)


if __name__ == "__main__":
    unittest.main()
