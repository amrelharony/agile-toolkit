import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Code Review Metrics: a pull request branching off and back towards main, its own commit a clock timing the review. */
const art: InkDrawing = {
  name: "code-review-metrics",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 50, rx: 38, ry: 34, seed: 2476, tone: "info" }],
  strokes: [
    { d: "M28 28.4Q27.4 48 28.2 67.6", w: 2.4 },
    { d: ring(28, 22, 6, 6, -2.2), fill: "paper", fillD: disc(28, 22, 6) },
    { d: ring(28, 74, 6, 6, -2.6), fill: "paper", fillD: disc(28, 74, 6) },
    {
      d: "M66 56.6Q66.6 44 66.2 34.6Q65.8 24.2 55.6 24.2L42 24.4M47.6 18.6L41.4 24.4L47.6 30.2",
      w: 2.4,
    },
    { d: ring(66, 70, 13, 13, -2.4), fill: "paper", fillD: disc(66, 70, 13) },
    { d: "M66 59L66 60.8M77 70L75.2 70M66 81L66 79.2M55 70L56.8 70", tone: "sub", w: 1.6 },
    { d: "M66 70L66 61.6M66 70L72.4 73.6", tone: "accent", w: 2.6 },
  ],
};

export default art;
