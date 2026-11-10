import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Sprint Comparison: a six-score radar web with two sprints' shapes laid over each other. */
const art: InkDrawing = {
  name: "sprint-compare",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 38, ry: 36, seed: 2126, tone: "success" }],
  strokes: [
    { d: "M48 15.6L77.6 32.8L77.2 67.2L48 84.4L18.4 67L18.8 32.6Z", fill: "paper" },
    { d: "M48 33L62.7 41.5L62.7 58.5L48 67L33.3 58.5L33.3 41.5Z", tone: "sub", w: 1.4 },
    {
      d: "M48 50L48 16M48 50L77.4 33M48 50L77.4 67M48 50L48 84M48 50L18.6 67M48 50L18.6 33",
      tone: "sub",
      w: 1.4,
    },
    { d: "M48 22.1L66.3 39.5L74.5 65.3L48 68.7L25.9 62.8L28 38.5Z", fill: "success", w: 2 },
    { d: "M48 31.3L74.5 34.7L65.7 60.2L48 78.9L33.3 58.5L22.1 35.1Z", tone: "accent", w: 2.6 },
  ],
};

export default art;
