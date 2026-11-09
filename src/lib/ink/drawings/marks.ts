import { mulberry32, r1 } from "../rng";
import { dot, ring, turn } from "../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../types";

/**
 * Small marks the interface draws: the tick a finished moment gets, the
 * scribble a loading placeholder writes over and over, the wash Amr stands on
 * in an empty state, the empty chart a tool shows before it has data, and the
 * ink moments (components/ink/ink-moment.tsx): a Done stamp, a heart, a
 * flourish and a star, each drawn once in place when something gets finished.
 */

export const TICK: InkDrawing = {
  name: "tick",
  viewBox: "0 0 24 24",
  pen: 3,
  strokes: [{ d: "M3.6 13.2Q6.6 15.4 9.4 18.6Q13.4 10.6 20.6 4.8", tone: "success" }],
};

export const SCRIBBLE: InkDrawing = {
  name: "scribble",
  viewBox: "0 0 96 24",
  pen: 2.4,
  strokes: [
    {
      d: "M5 15.4C11 4.6 17.4 4.4 19.6 13.4S27.6 22.6 31.6 12.4S41.2 4 45.4 13.6S55.4 21.6 59.4 11.2S70.6 5.4 73 13.4S82.4 19.6 90.6 9.6",
      tone: "accent",
    },
    { d: "M14 20.6Q40 18.6 72 20", tone: "sub", w: 1.4 },
  ],
};

export const PUDDLE: InkDrawing = {
  name: "puddle",
  viewBox: "0 0 96 24",
  washes: [{ cx: 48, cy: 13, rx: 44, ry: 8, seed: 401, tone: "accent2" }],
  strokes: [],
};

export const NO_DATA: InkDrawing = {
  name: "no-data",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 32, seed: 411, tone: "accent2" }],
  strokes: [
    { d: "M18.4 15.6L18.2 78.4L84.4 78.2", w: 2.4 },
    { d: "M18.6 62.4L80.4 62M18.6 46.4L80.4 46M18.6 30.4L80.4 30", tone: "sub", w: 1 },
    {
      d: `${dot(26.4, 70.4)}${dot(34.4, 66.6)}${dot(42.4, 64.2)}${dot(50.4, 58.6)}`,
      tone: "accent",
      w: 3.6,
    },
    { d: "M58.6 60.4L74.4 42.4L80.6 48L64.6 66Z", tone: "ink", fill: "wood", w: 2 },
    { d: "M58.6 60.4L55.4 69.4L64.6 66", w: 2 },
    { d: "M74.4 42.4L77.6 38.8L83.6 44.4L80.6 48", tone: "accent", w: 2 },
  ],
};

/** A stamp pressed on by hand sits a little askew: its right side up. */
const STAMP_TILT = -7;
const askew = (d: string) => turn(d, STAMP_TILT, 36, 20);

/**
 * "Done" in an inked oval, the stamp a finished sprint gets. Lettered by hand
 * in sentence case, a capital D and three small letters, written square on a
 * baseline at y 27.2 and then set askew with the oval.
 */
export const DONE_STAMP: InkDrawing = {
  name: "done-stamp",
  viewBox: "0 0 72 40",
  pen: 2,
  strokes: [
    { d: ring(36, 20, 30, 15, -2.6, 0.35, STAMP_TILT), tone: "success", w: 2.4 },
    { d: askew("M17.4 13.2L17 27.2M16.4 13.6C27.6 11.6 29.4 27 16.8 27.4"), tone: "success" },
    {
      d: askew(
        "M31.6 18.4C29.2 18.4 28.2 20.8 28.2 22.8S29.4 27.2 31.6 27.2S35 24.8 35 22.8S33.8 18.2 31 18.8"
      ),
      tone: "success",
    },
    {
      d: askew("M38.6 18.4L38.4 27.2M38.5 21.8C39.6 18.2 44 17.8 44.2 21.6L44.4 27.2"),
      tone: "success",
    },
    {
      d: askew("M48.6 23L55.2 22.6C55.6 18.8 49.8 17.8 48.8 22.2C48 26.4 52.8 28.8 56 25.6"),
      tone: "success",
    },
  ],
};

/** One stroke from the point, up round both lobes and back past where it began. */
const HEART_D =
  "M12 20.6C7.4 17.4 3.4 13.8 3.6 9.4C3.8 5.6 9 4.2 11.8 8.6C14.4 4.2 19.8 5 20.4 9C21 13.4 16.8 17 11.6 20.9";

export const HEART: InkDrawing = {
  name: "heart",
  viewBox: "0 0 24 24",
  pen: 2.4,
  strokes: [{ d: HEART_D, tone: "plum", fill: "plum" }],
};

/** A swash under a line of text: a looped start, a long rising sweep that flicks up, and a short echo under it. */
export const FLOURISH: InkDrawing = {
  name: "flourish",
  viewBox: "0 0 96 16",
  pen: 2.2,
  strokes: [
    {
      d: "M10.4 12.4C14.8 9.6 16.4 3.6 11.6 3.6C6.8 3.6 5.4 11.6 14.4 12.2C30 13.2 48 8.4 64 7.6S84 8.4 91 4.6",
      tone: "accent",
    },
    { d: "M28 14.8Q46 13.4 62 11.6", tone: "accent", w: 1.2 },
  ],
};

/**
 * Five points, drawn the way a pen draws a star: each tip and notch a little
 * off where a ruler would put it (seeded, so server and browser agree), each
 * edge bowed a touch, and the last edge running on past the first tip.
 */
function star(cx: number, cy: number, outer: number, inner: number, seed: number): string {
  const rnd = mulberry32(seed);
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = (i % 2 ? inner : outer) * (0.95 + rnd() * 0.1);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
  });
  const [x0, y0] = pts[0];
  const [x1, y1] = pts[1];
  const path = [...pts, pts[0], [x0 + (x1 - x0) * 0.2, y0 + (y1 - y0) * 0.2] as const];
  let d = `M${r1(x0)} ${r1(y0)}`;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const bow = (rnd() - 0.5) * 0.8;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const qx = (ax + bx) / 2 - ((by - ay) / len) * bow;
    const qy = (ay + by) / 2 + ((bx - ax) / len) * bow;
    d += `Q${r1(qx)} ${r1(qy)} ${r1(bx)} ${r1(by)}`;
  }
  return d;
}

export const STAR: InkDrawing = {
  name: "star",
  viewBox: "0 0 24 24",
  pen: 2,
  strokes: [{ d: star(12, 12.8, 10, 4.3, 421), tone: "warning", fill: "warning" }],
};

export const MARKS = { TICK, SCRIBBLE, PUDDLE, NO_DATA, DONE_STAMP, HEART, FLOURISH, STAR };
