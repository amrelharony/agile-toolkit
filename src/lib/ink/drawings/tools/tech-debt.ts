import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Technical Debt Tracker: a ball and chain marked with a dollar sign, the debt the team drags along. */
const art: InkDrawing = {
  name: "tech-debt",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 52, rx: 38, ry: 32, seed: 2280, tone: "info" }],
  strokes: [
    { d: ring(60, 62, 20, 20, -2.3), fill: "paper", fillD: disc(60, 62, 20) },
    { d: "M66.6 46.6Q74.2 49.4 76.6 57", tone: "sub", w: 1.8 },
    { d: "M47.9 49.9L40.3 42.3M38 40L30.4 32.4", w: 3 },
    {
      d: "M42.8 44.8A5.2 3 45 1 1 35.5 37.5A5.2 3 45 1 1 43.4 44.4M32.9 34.9A5.2 3 45 1 1 25.6 27.6A5.2 3 45 1 1 33.5 34.5",
      w: 2.2,
    },
    { d: ring(20.6, 22.6, 9, 7, -2.6), w: 3, fill: "paper", fillD: disc(20.6, 22.6, 9, 7) },
    { d: ring(20.6, 22.6, 5, 3.4, -2), tone: "sub", w: 1.6 },
    { d: "M34 84.4Q60 85.6 86 84", tone: "sub", w: 1.6 },
    {
      d: "M67.6 55.4Q62.4 52.4 57.6 55Q53.8 58 57.8 61.4Q60 63 63.6 64.2Q68.6 66.4 66.8 70.4Q63.6 74.2 55.8 71.2M61.6 50.8L61.4 75.8",
      tone: "accent",
      w: 2.6,
    },
  ],
};

export default art;
