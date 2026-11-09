import { dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Async Standup Digest: two written updates in chat bubbles, and one teammate still typing. */
const art: InkDrawing = {
  name: "async-standup",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 34, seed: 2532, tone: "accent" }],
  strokes: [
    {
      d: "M16 14.4Q10.4 14.4 10.4 20L10.6 36Q10.6 41.6 16.4 41.6L19 41.8L15.4 50.4L26 41.6L52.4 41.4Q58 41.4 58 35.8L57.8 20Q57.8 14.2 52 14.2Z",
      fill: "paper",
    },
    { d: "M17 23.4L49 23M17 31.6L40 31.2", tone: "sub", w: 1.8 },
    {
      d: "M40 50.4Q34.4 50.4 34.4 56L34.6 72Q34.6 77.6 40.4 77.6L70 77.6L80.6 86.4L77 77.6L80.4 77.6Q86 77.6 86 72L85.8 56Q85.8 50.2 80 50.2Z",
      fill: "accent",
    },
    { d: "M41.6 59.4L77 59M41.6 67.6L66 67.2", tone: "sub", w: 1.8 },
    { d: ring(76.4, 27.4, 11, 8.6, -2.2), w: 2 },
    { d: `${dot(70.6, 27.6)}${dot(76.4, 27.6)}${dot(82.2, 27.6)}`, tone: "accent", w: 3.4 },
  ],
};

export default art;
