import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const keyArt: InkDrawing = {
  name: "key",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 46, cy: 50, rx: 40, ry: 28, seed: 291, tone: "wood" }],
  strokes: [
    { d: ring(29.6, 48, 14.2, 14.2, -2.6), fill: "warning", fillD: disc(29.6, 48, 14.2) },
    { d: ring(26.4, 48, 4.6, 4.6, -2), fill: "paper", fillD: disc(26.4, 48, 4.6) },
    { d: "M43.6 47.6Q64 46.6 85.4 48.2", w: 3 },
    { d: "M74.4 48L74.6 58.4M82.6 48.2L82.4 55.6L78 55.8", w: 2.6 },
    { d: "M60.8 26.4L62 32.6M68.6 30.4L64.4 34.4M54.6 30.4L58.4 34", tone: "accent", w: 1.8 },
  ],
};
