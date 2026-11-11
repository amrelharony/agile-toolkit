"""Intake: the return archived untouched, only PNG images read (nothing from a zip
is ever written under its own path or run), names by the regex, loose PNGs sorted
by what they hold, the ledger, the accepted copies and a repeat recognised."""

import io
import json
import sys
import tempfile
import unittest
import zipfile
from unittest import mock
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import cast_synth as cs  # noqa: E402

from cast import imaging as im  # noqa: E402
from cast import intake, ledger, parts, spec  # noqa: E402

STICKY = spec.character("AAW-25")
QUIET = lambda *a, **k: None  # noqa: E731


def sheets():
    return {
        "master": cs.png_bytes(cs.master_png(), "RGB"),
        "parts": cs.png_bytes(cs.parts_sheet()[0], "RGB"),
        "face": cs.png_bytes(cs.face_sheet(), "RGB"),
        "arms": cs.png_bytes(cs.arms_sheet(spec.ARM_POSES), "RGB"),
    }


class Intake(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.art = sheets()

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cast-intake-"))
        self.sources = self.tmp / "sources"

    def zip_of(self, members: dict, name="AAW-25.zip") -> Path:
        p = self.tmp / "in" / name
        p.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(p, "w") as z:
            for n, data in members.items():
                z.writestr(n, data)
        return p

    def test_a_named_zip(self):
        src = self.zip_of(
            {
                "AAW-25/AAW-25_master.png": self.art["master"],
                "AAW-25/AAW-25_face.png": self.art["face"],
                "AAW-25_parts2.png": self.art["parts"],  # Sticky has no parts2
                "run_me.py": b"print('never')",
                "../../escape.png": self.art["master"],
                "notes.txt": b"hello",
                "fake.png": b"not a png at all",
            }
        )
        got = intake.intake(src, self.sources, date="2026-11-11", out=QUIET)
        folder = self.sources / "returns" / "2026-11-11-AAW-25"
        self.assertEqual(got["folder"], folder.name)
        # Archived untouched, byte for byte.
        self.assertEqual((folder / "original" / "AAW-25.zip").read_bytes(), src.read_bytes())
        # Only the named images of this character, under their own names.
        made = sorted(p.relative_to(folder / "extracted").as_posix() for p in (folder / "extracted").rglob("*") if p.is_file())
        self.assertEqual(made, sorted(["AAW-25_face.png", "AAW-25_master.png", "AAW-25_master-v2.png"]))
        self.assertFalse(list(self.tmp.rglob("run_me.py")))
        self.assertFalse(list(self.tmp.rglob("escape.png")))
        self.assertFalse((self.tmp / "escape.png").exists())
        why = dict(got["extra"])
        self.assertIn("run_me.py", why)
        self.assertIn("fake.png", why)
        self.assertIn("AAW-25_parts2.png", why)
        # The loose 'escape.png' was sorted by content: one figure, so a master.
        self.assertEqual([(s[0], s[1]) for s in got["sorted"]], [("../../escape.png", "AAW-25_master-v2.png")])
        rows = ledger.read(ledger.received_path(self.sources))
        images = [r for r in rows if r["kind"] == "image"]
        self.assertEqual(sorted(r["file"] for r in images), made)
        for r in images:
            data = (folder / "extracted" / r["file"]).read_bytes()
            self.assertEqual(r["sha256"], im.sha256_bytes(data))
            self.assertEqual(r["bytes"], len(data))
            self.assertEqual(r["size"], [cs.W, cs.H])
            self.assertEqual(r["brief_version"], spec.SPEC["brief_version"])
        self.assertEqual([r["kind"] for r in rows].count("return"), 1)
        # Accepted copies; the highest -vN is the current master.
        self.assertEqual(ledger.accepted_file(self.sources, "AAW-25", "master").name, "AAW-25_master-v2.png")
        self.assertEqual(got["per"]["AAW-25"]["missing"], ["parts", "arms"])

    def test_the_same_return_twice_is_taken_once(self):
        src = self.zip_of({"AAW-25_master.png": self.art["master"]})
        intake.intake(src, self.sources, date="2026-11-11", out=QUIET)
        again = intake.intake(src, self.sources, date="2026-11-12", out=QUIET)
        self.assertTrue(again["repeat"])
        self.assertEqual(len(list((self.sources / "returns").iterdir())), 1)

    def test_a_changed_image_supersedes_the_accepted_copy(self):
        intake.intake(self.zip_of({"AAW-25_master.png": self.art["master"]}, "a.zip"), self.sources, cid="AAW-25", out=QUIET)
        other = cs.png_bytes(cs.on_key(cs.master_rgba(), cs.MAGENTA)[:, ::-1].copy(), "RGB")
        intake.intake(self.zip_of({"AAW-25_master.png": other}, "b.zip"), self.sources, cid="AAW-25", out=QUIET)
        cur = ledger.accepted_file(self.sources, "AAW-25", "master")
        self.assertEqual(cur.read_bytes(), other)
        old = list((ledger.accepted_dir(self.sources, "AAW-25") / "_old").rglob("*.png"))
        self.assertEqual(len(old), 1)
        self.assertEqual(old[0].read_bytes(), self.art["master"])

    def test_loose_pngs_in_a_folder_are_sorted_by_content(self):
        folder = self.tmp / "in" / "AAW-25"
        folder.mkdir(parents=True)
        names = {"one.png": "master", "two.png": "parts", "three.png": "face", "four.png": "arms"}
        for n, img in names.items():
            (folder / n).write_bytes(self.art[img])
        got = intake.intake(folder, self.sources, date="2026-11-11", out=QUIET)
        mapping = {s[0]: s[1] for s in got["sorted"]}
        self.assertEqual(mapping, {n: f"AAW-25_{img}.png" for n, img in names.items()})
        self.assertEqual(got["per"]["AAW-25"]["missing"], [])
        archived = self.sources / "returns" / "2026-11-11-AAW-25" / "original" / "AAW-25"
        self.assertEqual(sorted(p.name for p in archived.iterdir()), sorted(names))

    def test_loose_pngs_need_an_owner(self):
        folder = self.tmp / "in" / "batch"
        folder.mkdir(parents=True)
        (folder / "image.png").write_bytes(self.art["master"])
        got = intake.intake(folder, self.sources, out=QUIET)
        self.assertEqual(got["images"], [])
        self.assertIn("--id", dict(got["extra"])["image.png"])
        got = intake.intake(folder / "image.png", self.sources, cid="AAW-25", out=QUIET)
        self.assertEqual(got["images"], ["AAW-25_master.png"])

    def test_sorting_rules(self):
        def sort(img):
            return parts.sort_image(STICKY, im.load_rgba(io.BytesIO(self.art[img]))[0], spec.key_rgb(STICKY))

        self.assertEqual(sort("master")[:2], ("master", "1 figure"))
        self.assertEqual(sort("face")[:2], ("face", "8 heads"))
        self.assertEqual(sort("arms")[:2], ("arms", "8 arms"))
        self.assertEqual(sort("parts")[0], "parts")
        amr = spec.character("AAW-01")
        two = cs.face_sheet(cells=cs.FACE_CELLS[:2])  # two heads on the first row's grid
        got = parts.sort_image(amr, two, spec.key_rgb(amr))
        self.assertEqual(got[0], "face2")

    def test_an_unreadable_member_is_skipped_not_fatal(self):
        src = self.tmp / "in" / "AAW-25.zip"
        src.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(src, "w", zipfile.ZIP_STORED) as z:
            z.writestr("AAW-25_master.png", self.art["master"])
            z.writestr("AAW-25_face.png", self.art["face"])
        raw = bytearray(src.read_bytes())
        at = raw.find(self.art["master"][100:132])  # inside the stored master: its CRC no longer holds
        raw[at] ^= 0xFF
        src.write_bytes(bytes(raw))
        got = intake.intake(src, self.sources, date="2026-11-11", out=QUIET)
        self.assertEqual(got["images"], ["AAW-25_face.png"])
        self.assertIn("unreadable member (BadZipFile)", dict(got["extra"])["AAW-25_master.png"])

    def test_a_zip_that_cannot_be_opened_leaves_nothing_behind(self):
        src = self.tmp / "in" / "AAW-25.zip"
        src.parent.mkdir(parents=True, exist_ok=True)
        good = self.zip_of({"AAW-25_master.png": self.art["master"]})
        raw = bytearray(good.read_bytes())
        cd = raw.rfind(b"PK\x01\x02")
        raw[cd : cd + 4] = b"XXXX"  # the central directory's signature: the end record still reads
        src.write_bytes(bytes(raw))
        if not zipfile.is_zipfile(src):
            self.skipTest("this Python's is_zipfile already refuses it")
        with self.assertRaises(SystemExit):
            intake.intake(src, self.sources, date="2026-11-11", out=QUIET)
        self.assertFalse((self.sources / "returns").exists())
        self.assertEqual(ledger.read(ledger.received_path(self.sources)), [])

    def test_a_return_is_read_within_its_caps(self):
        members = {f"AAW-25/loose-{i}.png": self.art["master"] for i in range(3)}
        with mock.patch.dict(spec.INTAKE, {"max_members": 2}):
            got = intake.intake(self.zip_of(members), self.sources, date="2026-11-11", out=QUIET)
        self.assertIn("more than 2 images in one return", dict(got["extra"])["AAW-25/loose-2.png"])
        with mock.patch.dict(spec.INTAKE, {"max_canvases": 0.5}):
            got = intake.intake(self.zip_of({"AAW-25_face.png": self.art["face"]}, "b.zip"), self.sources, out=QUIET)
        self.assertEqual(got["images"], [])
        self.assertIn("more than 0.5 canvases", dict(got["extra"])["AAW-25_face.png"])
        with mock.patch.dict(spec.INTAKE, {"max_total_mb": 0}):
            got = intake.intake(self.zip_of({"AAW-25_arms.png": self.art["arms"]}, "c.zip"), self.sources, out=QUIET)
        self.assertIn("past the 0 MB", dict(got["extra"])["AAW-25_arms.png"])

    def test_the_cli_takes_a_return_in(self):
        import subprocess

        src = self.zip_of({"AAW-25_master.png": self.art["master"]})
        cli = Path(__file__).resolve().parents[1] / "build-cast-rigs.py"
        res = subprocess.run(
            [sys.executable, "-I", str(cli), "--sources", str(self.sources), "intake", str(src)],
            capture_output=True,
            text=True,
            timeout=300,
        )
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn("AAW-25_master.png", json.dumps(ledger.read(ledger.received_path(self.sources))))
        self.assertIn("still missing parts, face, arms", res.stdout)


if __name__ == "__main__":
    unittest.main()
