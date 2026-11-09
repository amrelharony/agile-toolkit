import { getStroke } from "perfect-freehand";
import { svgPathFromStroke } from "@/lib/whiteboard/freehand";
import { mulberry32, r1 } from "./rng";

type Point = [number, number];

export type HighlightKind = "underline" | "circle";

/**
 * A hand-drawn mark for a phrase: a marker underline or a loose circle.
 *
 * This is the generator: the marks the site uses are drawn from their recipes
 * ahead of time into lib/ink/highlight-marks.ts (test/ink/highlight-marks
 * keeps them equal), so perfect-freehand never ships to the browser.
 *
 * `outline` is the filled, pressure-tapered ink (perfect-freehand), and
 * `centre` is the pen's path, which `InkHighlight` strokes wide inside a mask
 * so the ink appears to be drawn along it. Both come from a seed, so the server
 * and the browser draw the same mark.
 */
export interface HighlightShape {
  viewBox: string;
  outline: string;
  centre: string;
  /** Mask stroke width that covers the whole outline. */
  reveal: number;
}

/** Points along an open Catmull-Rom curve through `knots`. */
function sampleOpen(knots: Point[], perSegment = 8): Point[] {
  const out: Point[] = [];
  const at = (i: number) => knots[Math.max(0, Math.min(knots.length - 1, i))];
  for (let i = 0; i < knots.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    for (let s = 0; s < perSegment; s++) {
      const t = s / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1[0] +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y =
        0.5 *
        (2 * p1[1] +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, y]);
    }
  }
  out.push(knots[knots.length - 1]);
  return out;
}

function underlineKnots(rand: () => number, passes: 1 | 2): Point[] {
  const j = () => (rand() - 0.5) * 2.2;
  const knots: Point[] = [
    [1.5, 7.2 + j()],
    [26, 6.4 + j()],
    [52, 6.8 + j()],
    [78, 5.8 + j()],
    [98.5, 5.2 + j() * 0.5],
  ];
  if (passes === 2) {
    // The quick return stroke a marker makes: back along, a little lower,
    // stopping short of where the first pass began.
    knots.push([84, 8.6 + j() * 0.6], [52, 9.4 + j() * 0.6], [16, 9.8 + j() * 0.6]);
  }
  return knots;
}

function circleKnots(rand: () => number): Point[] {
  const knots: Point[] = [];
  const count = 9;
  const start = Math.PI * (0.92 + rand() * 0.12);
  const sweep = Math.PI * 2 * (1.07 + rand() * 0.05);
  for (let i = 0; i <= count; i++) {
    const a = start + (i / count) * sweep;
    // The hand drifts outwards as it comes round, so the loop doesn't close.
    const drift = 1 + (i / count) * 0.05 + (rand() - 0.5) * 0.05;
    knots.push([50 + Math.cos(a) * 46 * drift, 20 + Math.sin(a) * 16.5 * drift]);
  }
  return knots;
}

const memo = new Map<string, HighlightShape>();

export function highlightShape(kind: HighlightKind, seed = 1, passes: 1 | 2 = 1): HighlightShape {
  const key = `${kind}:${seed}:${passes}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const rand = mulberry32(seed);
  const circle = kind === "circle";
  const points = sampleOpen(circle ? circleKnots(rand) : underlineKnots(rand, passes), 4);
  const size = circle ? 3.4 : 3.2;
  const outline = svgPathFromStroke(
    getStroke(
      points.map(([x, y], i) => [x, y, 0.35 + 0.3 * Math.sin((i / points.length) * Math.PI)]),
      {
        size,
        thinning: 0.6,
        smoothing: 0.6,
        streamline: 0.3,
        simulatePressure: false,
        start: { taper: circle ? 18 : 10 },
        end: { taper: circle ? 26 : 18 },
        last: true,
      }
    )
  );
  const centre = points.map(([x, y], i) => `${i ? "L" : "M"}${r1(x)} ${r1(y)}`).join("");
  // A tenth of a unit is under a pixel at any size a mark is drawn, and it
  // halves the data the marks ship as (lib/ink/highlight-marks.ts).
  const compact = outline.replace(/-?\d+\.\d+/g, (n) => r1(Number(n)));
  const shape: HighlightShape = {
    viewBox: circle ? "0 0 100 40" : "0 0 100 12",
    outline: compact,
    centre,
    reveal: Math.round(size * 22) / 10,
  };
  memo.set(key, shape);
  return shape;
}
