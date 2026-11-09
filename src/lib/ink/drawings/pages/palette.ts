import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const paletteArt: InkDrawing = {
  name: "palette",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 44, cy: 48, rx: 38, ry: 34, seed: 251, tone: "accent3" }],
  strokes: [
    {
      d: "M44 15.8Q14.4 18 12.2 46.2Q12 74.2 40.2 78Q50 79 50.2 70.2Q50.4 62 58.4 62.2Q70 63 74.2 54Q78.2 36 62.2 22.2Q54.2 15.8 44 15.8",
      fill: "paper",
    },
    { d: ring(36.2, 62.4, 5, 5, -2), w: 2 },
    { d: ring(30, 34, 4.4, 4.4, -2), tone: "accent", fill: "accent", fillD: disc(30, 34, 4.4) },
    { d: ring(45, 28, 4.4, 4.4, -2.4), tone: "accent2", fill: "accent2", fillD: disc(45, 28, 4.4) },
    {
      d: ring(25.6, 49.6, 4.4, 4.4, -1.8),
      tone: "moss",
      fill: "moss",
      fillD: disc(25.6, 49.6, 4.4),
    },
    { d: ring(60, 38, 4.4, 4.4, -2.2), tone: "accent3", fill: "accent3", fillD: disc(60, 38, 4.4) },
    { d: "M57.4 86.4L79.4 56.6", tone: "wood", w: 3.4 },
    { d: "M79 56.8L83.4 50.4", w: 3.4 },
    {
      d: "M83.4 50.4Q90.4 41.4 88.4 35.6Q82 39.6 81.6 47.6",
      tone: "accent",
      fill: "accent",
      w: 2,
    },
  ],
};
