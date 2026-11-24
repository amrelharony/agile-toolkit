import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Strategy Tree: a small tree whose trunk splits into three branches, each ending in a coin for a bet, with two roots below. */
const art: InkDrawing = {
  name: "strategy-tree",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 48, rx: 40, ry: 36, seed: 4309, tone: "accent" }],
  strokes: [
    { d: "M47.6 72.4Q40 78 32.4 86.4M48.6 72.4Q56 78.6 63.6 86", tone: "wood", w: 2.4 },
    { d: "M10 72.2Q48 73.8 86 71.8", tone: "sub", w: 1.6 },
    { d: "M48 72L48.2 46", tone: "wood", w: 4.2 },
    {
      d: "M48.2 47Q36.4 40.4 27.6 30.6M48.2 46.4L48.2 23M48.2 47Q60 40.4 68.8 30.6",
      tone: "wood",
      w: 2.8,
    },
    { d: ring(23, 25, 7.4, 7.4, -2.3), fill: "warning", fillD: disc(23, 25, 7.4) },
    { d: ring(48.2, 15.4, 7.4, 7.4, -2), fill: "warning", fillD: disc(48.2, 15.4, 7.4) },
    { d: ring(73.4, 25, 7.4, 7.4, -2.6), fill: "warning", fillD: disc(73.4, 25, 7.4) },
    {
      d: `${ring(23, 25, 3.6, 3.6, -2)}${ring(48.2, 15.4, 3.6, 3.6, -2.4)}${ring(73.4, 25, 3.6, 3.6, -2.2)}`,
      tone: "sub",
      w: 1.4,
    },
  ],
};

export default art;
