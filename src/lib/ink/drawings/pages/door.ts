import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const doorArt: InkDrawing = {
  name: "door",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 38, ry: 36, seed: 301, tone: "accent" }],
  strokes: [
    { d: "M24 86.6L24.2 14.2Q46 12 68 14.2L68.2 86.4", w: 2.6 },
    { d: "M29.4 18.4L58.6 22.6L58.4 84.2L29.6 82.4Z", fill: "accent" },
    { d: ring(52.4, 52.4, 2.4, 2.4, -2), tone: "ink", w: 2 },
    { d: "M34.8 28.6L52.6 31M34.8 64.4L52.6 66", tone: "sub", w: 1.5 },
    { d: "M61.4 30.4L74.2 26.4M61.4 46.4L76.2 46.6M61.4 62.4L74.4 66.4", tone: "warning", w: 2 },
    { d: "M12.6 86.6Q48 88.6 85.4 86.2", tone: "sub", w: 1.8 },
  ],
};
