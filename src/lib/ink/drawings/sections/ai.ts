import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const aiArt: InkDrawing = {
  name: "ai",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 44, cy: 56, rx: 38, ry: 32, seed: 91, tone: "accent2" }],
  strokes: [
    {
      d: "M19.6 88.6Q20 76.4 42 76.2Q64 76.4 64.4 88.6",
      fill: "paper",
      fillD: "M19.6 88Q20 76.4 42 76.2Q64 76.4 64.4 88Z",
    },
    { d: "M32.4 68.4L32.6 76.6M51.6 68.4L51.4 76.6", w: 2 },
    {
      d: "M22 40.6Q22 34 28.6 34.2L55.6 33.8Q62.2 34 62.2 40.4L62 61.6Q62 68.2 55.4 68.2L28.4 68.4Q22 68.2 21.8 61.8Z",
      fill: "accent2",
    },
    { d: "M21.8 46.2L17.8 46.4L18 56.4L21.8 56.2M62.2 46L66.2 46.2L66 56.2L62.2 56.4", w: 2 },
    { d: ring(34, 50, 3.8, 3.8, -2), fill: "paper", fillD: disc(34, 50, 3.8) },
    { d: ring(50.2, 50, 3.8, 3.8, -2.2), fill: "paper", fillD: disc(50.2, 50, 3.8) },
    { d: "M34.4 60.2Q42 63.4 50 60", w: 2 },
    { d: "M42 33.8L42 24.6", w: 2 },
    { d: ring(42, 21.4, 3, 3, -2), tone: "accent", fill: "accent", fillD: disc(42, 21.4, 3) },
    {
      d: "M68 31.4Q62.8 27.4 63.4 22Q64.4 12.4 76.2 12Q88.6 12.2 89 22.2Q89 32.2 76.2 32.6Q72.6 32.6 70.2 32.2L65 37.4L68 31.4",
      fill: "paper",
    },
    { d: `${dot(70.6, 22.4)}${dot(76.2, 22.4)}${dot(81.8, 22.4)}`, tone: "accent", w: 3.2 },
  ],
};
