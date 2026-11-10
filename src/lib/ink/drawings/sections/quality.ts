import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const qualityArt: InkDrawing = {
  name: "quality",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 46, cy: 50, rx: 38, ry: 36, seed: 81, tone: "info" }],
  strokes: [
    {
      d: "M40 12.6Q52.4 20.2 66.4 18.8Q68.4 52 40 82.6",
      fill: "info",
      fillD: "M40 13Q52.4 20.2 66 19Q68.4 52 40 82Q12 52 14 19Q27.6 20.2 40 13Z",
    },
    { d: "M40.4 82.4Q11.6 52 13.6 18.6Q27.6 20.4 40.6 12.4" },
    { d: "M27.4 46.2L36.6 55.4L53 35.8", tone: "success", w: 3 },
    { d: ring(66, 64.4, 12.4, 12.4, -2.4), fill: "paper", fillD: disc(66, 64.4, 12.4) },
    { d: "M60 59Q63 56 67 56", tone: "sub", w: 1.4 },
    { d: "M75 73.6L86.4 85", w: 4 },
  ],
};
