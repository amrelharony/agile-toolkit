import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const bellArt: InkDrawing = {
  name: "bell",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 36, ry: 34, seed: 261, tone: "warning" }],
  strokes: [
    {
      d: "M30.2 62.4Q32 50.2 32.2 40.2Q32.4 24 48 22.2Q63.6 24 63.8 40.2Q64 50.2 65.8 62.4",
      fill: "warning",
      fillD: "M30.2 62.4Q32 50.2 32.2 40.2Q32.4 24 48 22.2Q63.6 24 63.8 40.2Q64 50.2 65.8 62.4Z",
    },
    { d: "M23.6 64.2Q48 60 72.4 64Q72.6 70.4 48 70.4Q23.4 70.4 23.6 64.2", fill: "paper" },
    { d: "M43.8 70.6Q48 78.6 52.2 70.4", w: 2.2 },
    { d: "M48 22.2L48 16.8", w: 2 },
    { d: ring(48, 14.2, 2.6, 2.6, -2), w: 2 },
    { d: "M18.4 30Q14 38 18.2 46.4M77.6 30Q82 38 77.8 46.4", tone: "accent", w: 1.8 },
    { d: "M11.6 25.6Q5.6 38 11.8 50.4M84.4 25.6Q90.4 38 84.2 50.4", tone: "accent", w: 1.6 },
  ],
};
