import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const outcomesArt: InkDrawing = {
  name: "outcomes",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 46, cy: 52, rx: 38, ry: 34, seed: 71, tone: "accent" }],
  strokes: [
    { d: ring(43, 53, 30, 29, -2.8), fill: "paper", fillD: disc(43, 53, 30, 29) },
    { d: ring(43, 53, 19.6, 19, -2.2), tone: "accent" },
    { d: ring(43, 53, 9.4, 9.2, -1.6), fill: "accent", fillD: disc(43, 53, 9.4, 9.2) },
    { d: dot(43, 53), w: 4.4, tone: "accent" },
    { d: "M84.6 13L45.6 51.2", w: 2.6 },
    {
      d: "M79.4 11.6L84.4 6M86.6 18.6L91.6 13.2M76 15L81 9.4M83 22L88 16.6",
      tone: "accent",
      w: 1.8,
    },
  ],
};
