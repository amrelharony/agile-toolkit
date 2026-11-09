import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const vipArt: InkDrawing = {
  name: "vip",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 54, rx: 38, ry: 32, seed: 111, tone: "wood" }],
  strokes: [
    {
      d: "M17.6 66.4Q48 61.6 78.4 66.2",
      fill: "accent3",
      fillD: "M18 66.4Q48 61.6 78 66.2L78 82Q48 78 18 82Z",
    },
    { d: "M78 65.6L78.4 82.6" },
    { d: "M78.6 82.2Q48 77.6 17.4 82.4" },
    { d: "M18.2 83L17.8 65.8" },
    { d: "M20.6 70.4Q48 66 75.6 70.2", tone: "sub", w: 1.4 },
    {
      d: "M28 60.4L23.6 34.4L37.8 46.4L48 27.6L58.4 46.4L72.4 34.4L68 60.2",
      fill: "warning",
      fillD: "M28 60.4L23.6 34.4L37.8 46.4L48 27.6L58.4 46.4L72.4 34.4L68 60.2Q48 62.6 28 60.4Z",
    },
    { d: "M26.6 60.4Q48 63.2 69.4 60" },
    {
      d: ring(23.6, 31.8, 2.2, 2.2, -2),
      tone: "accent",
      fill: "accent",
      fillD: disc(23.6, 31.8, 2.2),
    },
    { d: ring(48, 25, 2.4, 2.4, -2), tone: "accent", fill: "accent", fillD: disc(48, 25, 2.4) },
    {
      d: ring(72.4, 31.8, 2.2, 2.2, -2),
      tone: "accent",
      fill: "accent",
      fillD: disc(72.4, 31.8, 2.2),
    },
    { d: "M36 54.4Q48 56.4 60 54.2", tone: "sub", w: 1.4 },
  ],
};
