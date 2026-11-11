"""The whole road on a synthetic puppet: accepted images → candidate (C1–C11) →
approvals bound to sha256 → build (atlases, rigs.generated.ts, C16), and every
way build refuses. Everything is written to temporary folders: the repo's
public/cast, rigs.generated.ts and cast-rig.json are never touched."""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import cast_synth as cs  # noqa: E402
from PIL import Image  # noqa: E402

from cast import fmt, ledger, publish, rig, spec  # noqa: E402
from cast import imaging as im  # noqa: E402
from cast.spec import BUDGETS, TOL  # noqa: E402

CID = "AAW-25"
COLOURS = [("Body", cs.BODY), ("Flap", cs.FLAP), ("Limbs", cs.LIMB), ("Gloves", cs.GLOVE), ("Ink", cs.INK)]


def sources_with_art(root: Path) -> Path:
    src = root / "sources"
    acc = ledger.accepted_dir(src, CID)
    cs.save(acc / f"{CID}_master.png", cs.master_png(), "RGB")
    cs.save(acc / f"{CID}_parts.png", cs.parts_sheet()[0], "RGB")
    cs.save(acc / f"{CID}_face.png", cs.face_sheet(), "RGB")
    cs.save(acc / f"{CID}_arms.png", cs.arms_sheet(spec.ARM_POSES), "RGB")
    blocks = src / "sources" / "blocks"
    blocks.mkdir(parents=True)
    (blocks / f"{CID}.txt").write_text(cs.block_text(COLOURS), encoding="utf-8")
    (src / "sources" / "cast-private.json").write_text(
        json.dumps({"characters": {CID: {"height_vs_amr": 0.7}}}), encoding="utf-8"
    )
    return src


class Pipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(tempfile.mkdtemp(prefix="cast-pipeline-"))
        cls.src = sources_with_art(cls.root)
        cls.report = rig.candidate(CID, cls.src, out=lambda *a: None)
        cls.folder = cls.src / "review" / spec.batch_of(CID) / CID
        cls.spec_path = cls.root / "cast-rig.json"
        shutil.copy2(spec.SPEC_PATH, cls.spec_path)

    def approve_all(self, by="owner"):
        for img in spec.character(CID)["images"]:
            publish.approve(CID, self.src, by, f"approve {CID} {img}", image=img, spec_path=self.spec_path, out=lambda *a: None)
        publish.approve(CID, self.src, by, f"approve {CID} rig", rig_=True, spec_path=self.spec_path, out=lambda *a: None)

    def test_1_the_candidate_passes_its_checks(self):
        r = self.report
        self.assertEqual(r["missing"], [])
        for name in ("C5", "C6", "C8", "C10"):
            self.assertEqual(r["checks"][name]["status"], "pass", (name, r["checks"][name]))
        for name in ("C7", "C9", "C11"):
            self.assertIn(r["checks"][name]["status"], ("pass", "warn"), (name, r["checks"][name]))
        self.assertGreaterEqual(r["checks"]["C6"]["iou_rest"], TOL["iou_rest"])
        for pid, part in r["checks"]["C6"]["parts"].items():
            self.assertAlmostEqual(part["r"], cs.PARTS_R, delta=0.02, msg=pid)
            self.assertLessEqual(abs(part["tilt"]), 1.0, pid)
        for pid in ("arm-r", "arm-l", "leg-r", "leg-l"):
            self.assertEqual(r["checks"]["C7"]["joints"][pid]["kind"], "cap", pid)
        self.assertLessEqual(r["counts"]["nodes"], BUDGETS["rig_nodes_max"])
        self.assertLessEqual(r["counts"]["animated"], BUDGETS["rig_animated_max"])
        self.assertTrue((self.folder / "atlas@2x.png").exists())
        self.assertTrue((self.folder / "candidate.json").exists())

    def test_2_the_manifest_has_the_designs_shape(self):
        cand = json.loads((self.folder / "candidate.json").read_text(encoding="utf-8"))
        man = cand["manifest"]
        self.assertEqual(man["v"], 1)
        self.assertEqual(man["id"], CID)
        self.assertEqual(man["name"], spec.character(CID)["name"])
        self.assertEqual(man["family"], "object")
        self.assertEqual(man["heightVsAmr"], 0.7)
        roots = [p for p in man["parts"] if p["parent"] is None]
        self.assertEqual([p["id"] for p in roots], ["torso"])
        self.assertEqual(roots[0]["socket"], "body")
        seen = set()
        for p in man["parts"]:  # parents first
            self.assertTrue(p["parent"] is None or p["parent"] in seen, p["id"])
            seen.add(p["id"])
            self.assertEqual(len(p["box"]), 4)
            self.assertEqual(len(p["sprite"]["bg"]), 4)
        self.assertEqual(sorted(seen), sorted(spec.character(CID)["parts"]))
        slots = {s["id"]: s for s in man["swaps"]}
        self.assertEqual(sorted(slots), ["arm-l", "arm-r", "eyes", "mouth"])
        self.assertEqual([c["id"] for c in slots["eyes"]["choices"]], ["open", "closed", "happy", "wide"])
        self.assertEqual([c["id"] for c in slots["mouth"]["choices"]], ["rest", "smile", "open", "o"])
        self.assertEqual([c["id"] for c in slots["arm-r"]["choices"]], ["rest", "wave", "up", "open", "point"])
        self.assertEqual([c["id"] for c in slots["arm-l"]["choices"]], ["rest", "up", "open", "chin", "sig"])
        self.assertIsNone(slots["eyes"]["choices"][0]["sprite"])
        self.assertEqual(man["pupils"]["ids"], ["pupil-r", "pupil-l"])
        self.assertTrue(all(t > 0 for t in man["pupils"]["travel"]))
        self.assertNotRegex(json.dumps(man), r"#[0-9A-Fa-f]{6}")

    def test_3_build_refuses_without_every_approval(self):
        with self.assertRaises(SystemExit) as e:
            publish.build(CID, self.src, self.root / "public", self.root / "rigs.generated.ts", spec_path=self.spec_path)
        self.assertIn("has no approval", str(e.exception))
        self.assertFalse((self.root / "public").exists())
        with self.assertRaises(SystemExit):
            publish.approve("AAW-01", self.src, "opus", "looks fine", image="master", spec_path=self.spec_path)
        with self.assertRaises(SystemExit):
            publish.approve(CID, self.src, "owner", "  ", image="master", spec_path=self.spec_path)

    def test_4_approved_it_builds_and_passes_c16(self):
        self.approve_all("opus")
        why, _ = publish.refusals(CID, self.src)
        self.assertEqual(why, ["rig " + json.loads((self.folder / "candidate.json").read_text())["rig_sha256"][:12] + " has no owner approval"])
        self.approve_all("owner")
        # The approvals are mirrored into the (copied) spec, which keeps its format.
        mirrored = json.loads(self.spec_path.read_text(encoding="utf-8"))
        appr = next(c for c in mirrored["characters"] if c["id"] == CID)["approved"]
        self.assertEqual(sorted(appr), sorted([*spec.character(CID)["images"], "rig"]))
        self.assertEqual(fmt.json_text(mirrored), self.spec_path.read_text(encoding="utf-8"))
        public, ts = self.root / "public", self.root / "rigs.generated.ts"
        res = publish.build(CID, self.src, public, ts, spec_path=self.spec_path, out=lambda *a: None)
        self.assertEqual(res["status"], "pass", res["notes"])
        files = sorted(p.name for p in public.iterdir())
        self.assertEqual(len(files), 2)
        rigs = rig.read_ts(ts)
        man = rigs[CID]
        for k, bk in (("x1", "bytes1"), ("x2", "bytes2")):
            f = public / Path(man["atlas"][k]).name
            self.assertTrue(f.name.endswith(f".{im.sha256_bytes(f.read_bytes())[:8]}.webp"))
            self.assertEqual(f.stat().st_size, man["atlas"][bk])
        with Image.open(public / Path(man["atlas"]["x1"]).name) as a1, Image.open(public / Path(man["atlas"]["x2"]).name) as a2:
            self.assertEqual(a2.size, (2 * a1.size[0], 2 * a1.size[1]))
        self.assertNotIn("import", ts.read_text(encoding="utf-8").split("*/", 1)[1])
        # A second build keeps one pair of files, the same bytes.
        publish.build(CID, self.src, public, ts, spec_path=self.spec_path, out=lambda *a: None)
        self.assertEqual(sorted(p.name for p in public.iterdir()), files)
        # C16 catches a renamed atlas and a stray file.
        stray = public / "aaw-99.deadbeef.webp"
        stray.write_bytes(b"x")
        bad = publish.check_published([CID], public, ts)
        self.assertEqual(bad[-1]["status"], "fail")
        stray.unlink()

    def test_5_a_changed_source_voids_its_approval(self):
        acc = ledger.accepted_file(self.src, CID, "face")
        keep = acc.read_bytes()
        try:
            img = cs.face_sheet()
            img[10, 10] = (250, 0, 250, 255)
            cs.save(acc, img, "RGB")
            why, _ = publish.refusals(CID, self.src)
            self.assertTrue(any("face" in w and "no approval" in w for w in why), why)
            self.assertTrue(any("changed since the candidate" in w for w in why), why)
        finally:
            acc.write_bytes(keep)


if __name__ == "__main__":
    unittest.main()
