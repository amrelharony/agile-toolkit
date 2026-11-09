import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** RAPID Decision Matrix: a gavel swinging down onto its sound block, the Decide role made final. */
const art: InkDrawing = {
  name: "rapid-decision",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 38, ry: 33, seed: 2777, tone: "warning" }],
  strokes: [
    {
      d: "M16 70Q15.8 73.6 16.2 76.4A22 6 0 0 0 59.8 76.4Q60.2 73.6 60 70",
      fill: "paper",
      fillD: "M16 70L16.2 76.4A22 6 0 0 0 59.8 76.4L60 70Z",
    },
    { d: ring(38, 70, 22, 6, -2.8), fill: "paper", fillD: disc(38, 70, 22, 6) },
    {
      d: "M53.9 52.8Q66.8 62 79.5 72Q82.6 77.4 76.5 76Q63.6 66.6 50.9 56.8",
      fill: "paper",
      fillD: "M53.9 52.8Q66.8 62 79.5 72Q82.6 77.4 76.5 76Q63.6 66.6 50.9 56.8Z",
    },
    { d: "M30 58Q39 44.7 49.2 32.4Q58 34 62 42Q53 55.3 42.8 67.6Q34 66 30 58Z", fill: "wood" },
    { d: "M33.2 54.2Q38.6 59.8 45.6 63.4M46.4 36.6Q52.2 42.2 58.8 45.8", w: 1.8 },
    { d: "M66 27.4Q73.4 31.6 74.4 40M70.4 21Q81 26 82.6 37.4", tone: "accent", w: 2.2 },
  ],
};

export default art;
