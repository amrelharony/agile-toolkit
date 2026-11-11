"""Packing and writing: MaxRects with gutters, 2x exactly twice 1x, WebP names
after their bytes, the same bytes every run, and the prettier-shaped JSON and TS
the builder writes."""

import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import cast_synth as cs  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from cast import atlas, fmt, rig, spec  # noqa: E402
from cast import imaging as im  # noqa: E402

ROOT = HERE.parents[1]


def sprites():
    out = []
    for layer in cs.part_layers().values():
        out.append(cs.scaled(cs.crop(layer), 0.4))
    return out


class Pack(unittest.TestCase):
    def test_maxrects_keeps_rects_apart_by_the_gutter(self):
        rng = np.random.default_rng(5)
        sizes = [(int(w), int(h)) for w, h in rng.integers(8, 120, (30, 2))]
        g = spec.PACK["gutter_1x_px"]
        pos, (W, H) = atlas.pack(sizes)
        rects = [(x, y, w, h) for (x, y), (w, h) in zip(pos, sizes)]
        grown = [(x - g, y - g, w + 2 * g, h + 2 * g) for x, y, w, h in rects]
        for i, a in enumerate(rects):
            self.assertGreaterEqual(a[0], g)
            self.assertGreaterEqual(a[1], g)
            self.assertLessEqual(a[0] + a[2] + g, W)
            self.assertLessEqual(a[1] + a[3] + g, H)
            for b in rects[i + 1 :]:
                # never closer than one gutter
                apart = a[0] + a[2] + g <= b[0] or b[0] + b[2] + g <= a[0] or a[1] + a[3] + g <= b[1] or b[1] + b[3] + g <= a[1]
                self.assertTrue(apart, (a, b))
        self.assertTrue(atlas.rects_ok(rects, (W, H)))
        self.assertFalse(atlas.rects_ok([(0, 0, 10, 10), (5, 5, 10, 10)], (40, 40)))
        self.assertFalse(atlas.rects_ok(grown[:1], (W, H)) and grown[0][0] < 0)

    def test_the_2x_atlas_is_exactly_twice_the_1x(self):
        a2, rects = atlas.compose_atlas(sprites())
        a1, _ = atlas.one_x(a2)
        self.assertEqual(a2.size, (2 * a1.size[0], 2 * a1.size[1]))
        self.assertTrue(atlas.rects_ok(rects, a1.size))
        arr = np.array(a2)
        for (x, y, w, h), s in zip(rects, sprites()):
            sh, sw = s.shape[:2]
            np.testing.assert_array_equal(arr[2 * y : 2 * y + sh, 2 * x : 2 * x + sw], s)

    def test_webp_names_are_their_sha_and_the_bytes_repeat(self):
        a2, _ = atlas.compose_atlas(sprites())
        a1, _ = atlas.one_x(a2)
        b1, q1, ok1 = atlas.webp(a1, 1e9)
        b2, _, _ = atlas.webp(a2)
        self.assertEqual(q1, spec.PACK["webp_quality"][0])
        n1, n2 = atlas.atlas_names("AAW-25", b1, b2)
        self.assertEqual(n1, f"aaw-25.{im.sha256_bytes(b1)[:8]}.webp")
        self.assertEqual(n2, f"aaw-25@2x.{im.sha256_bytes(b2)[:8]}.webp")
        again1, _, _ = atlas.webp(atlas.one_x(atlas.compose_atlas(sprites())[0])[0], 1e9)
        self.assertEqual(b1, again1)
        with Image.open(io.BytesIO(b2)) as img:
            self.assertEqual(img.format, "WEBP")
            self.assertEqual(img.size, a2.size)

    def test_an_over_budget_atlas_steps_down_the_qualities(self):
        a2, _ = atlas.compose_atlas(sprites())
        data, q, ok = atlas.webp(a2, 0.001)
        self.assertFalse(ok)
        self.assertEqual(q, spec.PACK["webp_quality"][-1])


class Format(unittest.TestCase):
    def test_the_spec_round_trips_byte_for_byte(self):
        text = (ROOT / "docs" / "cast" / "cast-rig.json").read_text(encoding="utf-8")
        self.assertEqual(fmt.json_text(json.loads(text)), text)

    def test_generated_ts_reads_back(self):
        rigs = {
            "AAW-25": {
                "v": 1,
                "id": "AAW-25",
                "name": "Agile Sticky",
                "parts": [{"id": "torso", "parent": None, "box": [1.5, 2, 97, 96.25], "sprite": {"bg": [100, 200, 0, 33.33]}}],
                "pupils": None,
                "signature": [],
            }
        }
        text = rig.ts_file(rigs)
        self.assertIn('export const RIGS = {\n  "AAW-25": {\n    v: 1,', text)
        self.assertTrue(text.endswith("} as const;\n"))
        self.assertNotIn("import", text.split("*/", 1)[1])
        tmp = Path(tempfile.mkdtemp(prefix="cast-ts-")) / "rigs.generated.ts"
        tmp.write_text(text, encoding="utf-8")
        self.assertEqual(rig.read_ts(tmp), rigs)
        for line in text.splitlines():
            self.assertLessEqual(len(line), fmt.WIDTH, line)


if __name__ == "__main__":
    unittest.main()
