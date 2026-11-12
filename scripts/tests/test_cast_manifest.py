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
import numpy as np  # noqa: E402

from cast import clips as cast_clips  # noqa: E402
from cast import rig  # noqa: E402
from cast import spec  # noqa: E402
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
        # TEST_PUPPET: the look turns the head, the body and a pupil in each of two
        # eye choices (rig-manifest.test.tsx: 6); no clip moves more.
        self.assertEqual(cast_clips.animated(contract.TEST_PUPPET, contract.CLIPS), 6)
        self.assertEqual(cast_clips.animated(contract.TEST_PUPPET, contract.CLIPS), contract.TEST_PUPPET["counts"]["animated"])
        # Eight limbs and ripple: eight, though fourteen parts have a range.
        octo = limbed()
        self.assertEqual(sum(1 for p in octo["parts"] if p["range"]), 14)
        self.assertEqual(cast_clips.animated(octo, contract.CLIPS), 8)
        # Pupils move in every eye choice that draws them.
        self.assertEqual(cast_clips.elements(contract.TEST_PUPPET)["pupils"], 4)
        # A slot with a choice drawn over its siblings is two spans with its socket.
        chin = copy.deepcopy(contract.TEST_PUPPET)
        chin["signature"] = ["sig.chin"]
        self.assertEqual(cast_clips.elements(chin)["arm-l"], 2)

    def test_a_clip_counts_with_its_first_and_armless_layers(self):
        # guess.matched with the first speaker's layer: the head and the body.
        bare = {**copy.deepcopy(contract.ARMLESS_PUPPET), "pupils": None, "swaps": []}
        self.assertEqual(cast_clips.animated(bare, contract.CLIPS), 2)
        self.assertEqual(cast_clips.animated(contract.ARMLESS_PUPPET, contract.CLIPS), 6)

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


def flat(box, rgb, size=80):
    a = np.zeros((size, size, 4), np.uint8)
    x0, y0, x1, y1 = box
    a[y0:y1, x0:x1] = (*rgb, 255)
    return a


class Stacking(unittest.TestCase):
    RED, BLUE, GREEN = (200, 40, 40), (40, 60, 200), (40, 160, 60)

    def test_overlapping_siblings_stack_as_the_master_shows(self):
        baked = {"leg": flat((10, 10, 60, 60), self.RED), "tie": flat((20, 20, 30, 30), self.BLUE)}
        # The master draws the big leg over the small tie, against the size rule.
        master = flat((20, 20, 30, 30), self.BLUE)
        master[10:60, 10:60] = (*self.RED, 255)
        self.assertEqual(rig.on_top("tie", "leg", baked, master), "leg")
        self.assertEqual(rig.stack(["tie", "leg"], baked, master), ["tie", "leg"])
        # With the tie over the leg, or with nothing to go on, the bigger is lower.
        master[20:30, 20:30] = (*self.BLUE, 255)
        self.assertEqual(rig.stack(["tie", "leg"], baked, master), ["leg", "tie"])
        apart = {"leg": baked["leg"], "badge": flat((65, 65, 75, 75), self.GREEN)}
        self.assertIsNone(rig.on_top("leg", "badge", apart, master))
        self.assertEqual(rig.stack(["badge", "leg"], apart, master), ["leg", "badge"])

    def test_three_siblings_keep_every_pair_the_master_shows(self):
        a, b, c = flat((0, 0, 40, 40), self.RED), flat((30, 0, 70, 40), self.BLUE), flat((15, 30, 55, 70), self.GREEN)
        baked = {"a": a, "b": b, "c": c}
        master = np.zeros_like(a)
        master[0:40, 0:40] = (*self.RED, 255)  # a over b where they meet...
        master[0:40, 30:70] = (*self.BLUE, 255)
        master[0:40, 30:40] = (*self.RED, 255)
        master[30:70, 15:55] = (*self.GREEN, 255)  # ...c over both
        got = rig.stack(["a", "b", "c"], baked, master)
        self.assertEqual(sorted(got), ["a", "b", "c"])
        self.assertEqual(got[-1], "c")
        self.assertLess(got.index("b"), got.index("a"))


class FacePiece(unittest.TestCase):
    """face_piece(): the face cells are laid on what the brief's face piece holds,
    so a head drawn with its ear pieces keeps them, one drawn without leaves them
    off, and a face cut above the lanyard never holds it."""

    def place(self, box, size=(400, 400)):
        a = np.zeros((*size, 4), np.uint8)
        x0, y0, x1, y1 = box
        a[y0:y1, x0:x1] = (120, 210, 200, 255)
        return a

    def test_the_face_piece_holds_what_the_cells_hold(self):
        baked = {
            "torso": self.place((100, 200, 300, 380)),
            "head": self.place((120, 80, 280, 200)),
            "ear-r": self.place((120, 20, 150, 90)),
            "ear-l": self.place((250, 20, 280, 90)),
            "cord": self.place((190, 200, 210, 396)),  # hanging below the body
            "flap": self.place((280, 180, 330, 230)),  # a folded corner past the body
        }
        tree = {"head": ["ear-r", "ear-l"], "torso": ["head", "cord", "flap"]}
        z = {"torso": 0, "head": 1, "ear-r": -1, "ear-l": -2, "cord": 2, "flap": 3}

        def mask(kind):
            got = rig.face_piece({"face_base": kind}, baked, tree, z, [])
            return got[..., 3] >= spec.SOLID_ALPHA

        on = lambda m, x, y: bool(m[y, x])  # noqa: E731
        self.assertTrue(on(mask("head+ears"), 135, 40))
        self.assertFalse(on(mask("head"), 135, 40))  # a face drawn without its ears
        self.assertFalse(on(mask("head"), 200, 250))
        self.assertTrue(on(mask("body"), 320, 200))  # the whole body, its folded corner too
        self.assertTrue(on(mask("body"), 200, 300))
        top = mask("body-top")
        self.assertFalse(on(top, 320, 200))
        self.assertTrue(on(top, 200, 250))
        self.assertFalse(on(top, 200, 390))  # no face cell holds the lanyard
        self.assertFalse(on(mask("body"), 200, 390))


class Slots(unittest.TestCase):
    """manifest() on made-up placed pieces: the fan and an octopus's front pair
    become slots that draw their own rest pieces, and no part repeats them."""

    def place(self, box, rgb, size=(600, 900)):
        a = np.zeros((*size, 4), np.uint8)
        x0, y0, x1, y1 = box
        a[y0:y1, x0:x1] = (*rgb, 255)
        return a

    def build(self, c, pieces, z, pinned):
        baked = {pid: self.place(box, rgb) for pid, (box, rgb) in pieces.items()}
        tree = {"torso": [p for p in pieces if p != "torso"]}
        pivots = {p: {"x": (b[0] + b[2]) / 2, "y": b[1], "r": None} for p, (b, _) in pieces.items() if p != "torso"}
        rest = rig.compose(baked, ["torso", *tree["torso"]])
        man, sprites = rig.manifest(c, baked, tree, z, pivots, {}, [], pinned, rest, Path("nowhere"), contract.CLIPS)
        return man, [k for k, _ in sprites]

    def test_the_fan_is_a_slot_open_at_rest(self):
        # The master shows the fan open: the open fan is the rest piece, registered
        # like any piece; the closed fan is pinned at its base.
        self.assertEqual(rig.FAN, {"slot": "fan", "rest": "open", "rest_piece": "fan-open", "pose": "closed", "pose_piece": "fan-closed"})
        self.assertEqual(rig.PINNED_ONLY, ("fan-closed",))
        c = {**spec.character("AAW-22"), "signature": ["sig.fan"]}
        pieces = {"torso": ((300, 300, 600, 700), (120, 210, 200)), "fan-open": ((150, 50, 750, 420), (60, 140, 150))}
        closed = self.place((350, 150, 550, 640), (60, 140, 150))
        pinned = {"fan": {"rest": "fan-open", "rest_id": "open", "poses": {"closed": closed}}}
        man, keys = self.build(c, pieces, {"torso": 0, "fan-open": -1}, pinned)
        self.assertEqual([p["id"] for p in man["parts"]], ["torso"])
        fan = next(s for s in man["swaps"] if s["id"] == "fan")
        self.assertEqual((fan["on"], fan["rest"], fan["z"]), ("torso", "open", -1))
        self.assertEqual([ch["id"] for ch in fan["choices"]], ["open", "closed"])
        self.assertTrue(all(ch["sprite"] for ch in fan["choices"]))
        self.assertIn("fan:open", keys)
        self.assertNotIn("part:fan-open", keys)
        self.assertEqual(contract.problems(man, contract.CLIPS), [])
        self.assertEqual(cast_clips.unplayable(man, contract.CLIPS), [])
        # sig.fan folds the fan: it shows the closed choice, never the rest one.
        self.assertEqual(contract.CLIPS["clips"]["sig.fan"]["main"]["swaps"], ["fan.closed"])

    def test_an_octopus_front_pair_are_its_arm_slots(self):
        c = {**spec.character("AAW-18"), "signature": ["sig.ripple"]}
        pieces = {"torso": ((300, 200, 600, 500), (120, 210, 200))}
        for i in range(1, 9):
            pieces[f"tentacle-{i}"] = ((280 + 30 * i, 450, 300 + 30 * i, 800), (98, 46, 88))
        z = {"torso": 0, **{f"tentacle-{i}": -i for i in range(1, 9)}}
        wave = self.place((180, 150, 320, 470), (98, 46, 88))
        pinned = {
            "arm-r": {"rest": "tentacle-1", "rest_id": "rest", "poses": {"wave": wave}},
            "arm-l": {"rest": "tentacle-2", "rest_id": "rest", "poses": {}},
        }
        man, _ = self.build(c, pieces, z, pinned)
        ids = [p["id"] for p in man["parts"]]
        self.assertNotIn("tentacle-1", ids)
        self.assertNotIn("tentacle-2", ids)
        self.assertEqual(len([i for i in ids if i.startswith("tentacle-")]), 6)
        slots = {s["id"]: s for s in man["swaps"]}
        self.assertEqual(slots["arm-r"]["z"], -1)
        self.assertEqual([ch["id"] for ch in slots["arm-r"]["choices"]], ["rest", "wave"])
        self.assertEqual(man["counts"]["animated"], 6)  # ripple turns the six tentacles that are parts
        self.assertEqual(contract.problems(man, contract.CLIPS), [])
        self.assertEqual(man["counts"]["nodes"], rig.count_nodes(man))


class RuntimeChecks(unittest.TestCase):
    def test_the_fixtures_are_sound(self):
        self.assertEqual(contract.problems(contract.TEST_PUPPET), [])
        self.assertEqual(contract.problems(contract.ARMLESS_PUPPET), [])

    def test_a_complex_rig_has_the_larger_node_cap(self):
        # rig-manifest.test.tsx reads both caps from the spec; the builder's rig check
        # and this port of the runtime's checks hold a rig to the same one.
        cap, big = spec.BUDGETS["rig_nodes_max"], spec.BUDGETS["rig_nodes_max_complex"]
        self.assertGreater(big, cap)
        self.assertNotIn(contract.TEST_PUPPET["id"], spec.BUDGETS["complex"])

        def nodes(cid, n):
            return {**contract.TEST_PUPPET, "id": cid, "counts": {**contract.TEST_PUPPET["counts"], "nodes": n}}

        plain = contract.TEST_PUPPET["id"]
        self.assertEqual(spec.node_cap(plain), cap)
        self.assertEqual(contract.problems(nodes(plain, cap)), [])
        self.assertEqual(contract.problems(nodes(plain, cap + 1)), ["nodes"])
        self.assertEqual(rig.rig_check(nodes(plain, cap + 1), contract.CLIPS)["notes"], [f"{cap + 1} nodes, over {cap}"])
        for cid in spec.BUDGETS["complex"]:
            self.assertEqual(spec.node_cap(cid), big, cid)
            self.assertEqual(contract.problems(nodes(cid, big)), [], cid)
            self.assertEqual(contract.problems(nodes(cid, big + 1)), ["nodes"], cid)
            self.assertEqual(rig.rig_check(nodes(cid, big), contract.CLIPS)["status"], "pass", cid)
            self.assertEqual(rig.rig_check(nodes(cid, big + 1), contract.CLIPS)["status"], "fail", cid)

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
