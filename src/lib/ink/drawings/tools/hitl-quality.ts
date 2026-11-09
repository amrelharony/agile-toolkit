import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Human-in-the-Loop Quality Tracker: a reviewer holding up a score paddle with a star rating. */
const art: InkDrawing = {
  name: "hitl-quality",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 34, seed: 2665, tone: "accent2" }],
  strokes: [
    {
      d: "M14.4 86.4Q14.8 60.4 34 60Q53.2 60.4 53.6 86.4",
      fill: "paper",
      fillD: "M14.4 86.4Q14.8 60.4 34 60Q53.2 60.4 53.6 86.4Z",
    },
    { d: ring(34, 40, 9.4), fill: "paper", fillD: disc(34, 40, 9.4) },
    { d: `${dot(30.6, 40.4)}${dot(37.4, 40.4)}`, w: 2.8 },
    { d: "M31.4 45Q34 46.8 36.6 45", w: 1.6 },
    { d: "M48.8 67.4Q57.6 63 61.4 55.6", w: 2.2 },
    { d: "M64.4 49.6L67.6 41.4", w: 2.4 },
    { d: ring(63, 52.6, 3.4, 3.4, -2), fill: "paper", fillD: disc(63, 52.6, 3.4) },
    { d: "M55.6 14.6L84.8 11.6L87.8 39.6L58.6 42.6Z", fill: "paper" },
    {
      d: "M71.8 18L74 23.9L80.4 24.2L75.4 28.2L77.1 34.3L71.8 30.8L66.5 34.3L68.2 28.2L63.2 24.2L69.6 23.9Z",
      w: 2,
      fill: "warning",
    },
  ],
};

export default art;
