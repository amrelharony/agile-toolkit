import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const earlyArt: InkDrawing = {
  name: "early",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 32, seed: 341, tone: "accent" }],
  strokes: [
    { d: "M14.4 30.4L58.4 26.6L62.4 80.4L18.6 84.6Z", fill: "accent" },
    { d: "M22.4 30L26.6 84", tone: "sub", w: 1.6 },
    { d: "M32.4 40.4L52.4 38.6M33 48.4L49 47", tone: "paper", w: 2 },
    { d: ring(68.4, 34.4, 14, 14, -2.6), fill: "paper", fillD: disc(68.4, 34.4, 14) },
    { d: "M68.4 34.6L68.4 25.4", w: 2.2 },
    { d: "M68.6 34.4L75.4 38", tone: "accent", w: 2.2 },
    {
      d: "M76.4 58.4L79 64.6L85.4 65.4L80.6 69.6L82 76L76.4 72.6L70.8 76L72.2 69.6L67.4 65.4L73.8 64.6Z",
      tone: "warning",
      fill: "warning",
      w: 1.8,
    },
  ],
};
