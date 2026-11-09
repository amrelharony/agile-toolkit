import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const scrollArt: InkDrawing = {
  name: "scroll",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 38, ry: 36, seed: 331, tone: "wood" }],
  strokes: [
    { d: "M22.4 16.6L70.4 16.4L70.6 78.4L22.6 78.6Z", fill: "paper" },
    {
      d: "M16.4 17Q16.2 10.4 22.4 10.6L74.6 10.4Q80.6 10.4 80.4 17Q80.2 22.6 74.4 22.4L70.4 22.4",
      w: 2.2,
    },
    {
      d: "M16.4 78.4Q16.2 84.6 22.4 84.6L74.6 84.4Q80.6 84.4 80.4 78.4Q80.2 72.6 74.4 72.6L70.4 72.6",
      w: 2.2,
    },
    { d: "M30.4 32.4L62.4 32M30.4 40.4L58.4 40M30.4 48.4L54.4 48", tone: "sub", w: 1.6 },
    {
      d: ring(56.4, 62.4, 7.6, 7.6, -2.4),
      tone: "danger",
      fill: "danger",
      fillD: disc(56.4, 62.4, 7.6),
    },
    { d: "M52.4 62.4L55.4 65.4L60.6 59", tone: "danger", w: 1.8 },
  ],
};
