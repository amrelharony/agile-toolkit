import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Hypothesis Tracker: a magnifying glass held over a question mark, with a green tick for the verdict. */
const art: InkDrawing = {
  name: "hypothesis-tracker",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 48, rx: 38, ry: 34, seed: 2245, tone: "accent" }],
  strokes: [
    { d: ring(42, 40, 24, 24, -2.6), fill: "paper", fillD: disc(42, 40, 24) },
    { d: "M24.8 36Q26 27.4 33.2 22.6", tone: "sub", w: 1.6 },
    {
      d: "M34.4 32.6Q34.6 25.8 42.2 25.6Q49.8 25.8 49.8 32.4Q49.6 37.4 44.4 39.6Q42 40.8 42 45.6",
      w: 3,
    },
    { d: dot(41.8, 52.4), w: 4.4 },
    { d: "M56.9 59.1L61.1 54.9L66.1 59.9L61.9 64.1Z", fill: "paper", w: 2 },
    {
      d: "M67.7 59.5Q76.2 67.6 85.1 76.9Q88.4 80.6 85 84Q81.6 87 78.9 83.1Q70.4 74.8 61.5 65.7Z",
      fill: "accent",
    },
    { d: "M71.6 19.4L76.8 25.2L86.6 12", tone: "success", w: 2.8 },
  ],
};

export default art;
