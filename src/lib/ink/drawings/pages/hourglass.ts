import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const hourglassArt: InkDrawing = {
  name: "hourglass",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 36, ry: 38, seed: 231, tone: "wood" }],
  strokes: [
    {
      d: "M34.4 25.8Q48 29.6 61.6 25.8Q60 38.2 48.2 46.2Q36 38.2 34.4 25.8",
      tone: "wood",
      fill: "wood",
      w: 1.4,
    },
    { d: "M34.6 80.4Q48 64 61.4 80.4", tone: "wood", fill: "wood", w: 1.4 },
    { d: "M48.2 47.4L48 66.4", tone: "wood", w: 1.4 },
    { d: "M30.4 15.8Q30 40 46.2 48Q30.2 56 30.2 82.4" },
    { d: "M65.8 15.8Q66.2 40 50 48Q65.8 56 66 82.4" },
    { d: "M23.4 14.2Q48 11.8 72.6 14.4", w: 3 },
    { d: "M23.4 84.4Q48 86.4 72.8 84", w: 3 },
    { d: "M15.6 60.4Q7.6 48 15.8 35.6", tone: "accent", w: 2 },
    { d: "M11.4 39.8L16 35L20.2 40.2", tone: "accent", w: 2 },
  ],
};
