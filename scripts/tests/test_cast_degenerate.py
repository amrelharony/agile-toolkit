"""Bad returns stop one character, never the batch: an empty parts sheet, a rig
with no torso, and an unexpected error in one character's run."""

import contextlib
import importlib.util
import json
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import cast_contract as contract  # noqa: E402
import cast_synth as cs  # noqa: E402
import numpy as np  # noqa: E402

from cast import ledger, parts, rig, spec  # noqa: E402

CID = "AAW-25"


def load_cli():
    path = HERE.parent / "build-cast-rigs.py"
    sp = importlib.util.spec_from_file_location("build_cast_rigs", path)
    mod = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(mod)
    return mod


class Degenerate(unittest.TestCase):
    def setUp(self):
        self.src = Path(tempfile.mkdtemp(prefix="cast-degenerate-")) / "sources"
        acc = ledger.accepted_dir(self.src, CID)
        cs.save(acc / f"{CID}_master.png", cs.master_png(), "RGB")

    def test_an_empty_sheet_names_nothing(self):
        self.assertEqual(parts.assign([], ["torso", "flap"]), ({}, [], 0.0))
        pieces, _ = parts.islands(cs.master_rgba())
        got, spare, cost = parts.assign(pieces, [])
        self.assertEqual((got, spare, cost), ({}, list(range(len(pieces))), 0.0))

    def test_an_all_background_parts_sheet_stops_the_character(self):
        blank = np.zeros((cs.H, cs.W, 4), np.uint8)
        cs.save(ledger.accepted_dir(self.src, CID) / f"{CID}_parts.png", cs.on_key(blank), "RGB")
        with self.assertRaises(SystemExit) as e:
            rig.candidate(CID, self.src, out=lambda *a: None, clips=contract.CLIPS)
        self.assertIn("the torso was not placed", str(e.exception))

    def test_one_characters_crash_never_stops_the_batch(self):
        cli = load_cli()
        seen = []

        def fake(cid, sources, review=None, **kw):
            seen.append(cid)
            if cid == spec.SPEC["batches"]["A"][0]:
                raise ValueError("a bad drawing")
            raise SystemExit(f"{cid}: no accepted master; take one in first")

        buf = io.StringIO()
        with mock.patch.object(cli.rig, "candidate", fake), contextlib.redirect_stdout(buf):
            code = cli.main(["--sources", str(self.src), "candidate", "A"])
        self.assertEqual(code, 1)
        self.assertEqual(seen, spec.SPEC["batches"]["A"])
        self.assertIn(f"FAIL {spec.SPEC['batches']['A'][0]}: ValueError: a bad drawing", buf.getvalue())


class CheckOneFile(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cast-check-"))
        self.src = self.tmp / "sources"
        self.cli = load_cli()

    def run_cli(self, *argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = self.cli.main(["--sources", str(self.src), *argv])
        return code, buf.getvalue()

    def test_a_file_is_checked_as_the_image_its_name_says(self):
        face = cs.save(self.tmp / "AAW-25_face.png", cs.face_sheet(), "RGB")
        code, text = self.run_cli("check", CID, "--file", str(face), "--no-sheets")
        report = json.loads((self.src / "review" / "A" / "report.json").read_text(encoding="utf-8"))
        self.assertEqual(list(report["characters"][CID]["check"]["images"]), ["face"], text)
        loose = cs.save(self.tmp / "sheet.png", cs.face_sheet(), "RGB")
        code, text = self.run_cli("check", CID, "--file", str(loose), "--no-sheets")
        self.assertEqual(code, 1)
        self.assertIn("--image", text)
        code, text = self.run_cli("check", CID, "--file", str(loose), "--image", "face", "--no-sheets")
        self.assertIn("AAW-25 face sheet.png", text)

    def test_strict_fails_a_master_with_no_private_block(self):
        cs.save(ledger.accepted_dir(self.src, CID) / f"{CID}_master.png", cs.master_png(), "RGB")
        code, text = self.run_cli("check", CID, "--masters", "--no-sheets")
        self.assertEqual(code, 0, text)  # C9 skips without the block
        code, text = self.run_cli("check", CID, "--masters", "--no-sheets", "--strict")
        self.assertEqual(code, 1)
        self.assertIn("no private block", text)


if __name__ == "__main__":
    unittest.main()
