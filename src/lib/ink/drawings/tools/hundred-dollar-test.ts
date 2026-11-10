import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** $100 Test: three coin stacks of unequal height, a dollar coin dropping onto the short one. */
const art: InkDrawing = {
  name: "hundred-dollar-test",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 47, cy: 52, rx: 39, ry: 33, seed: 2749, tone: "warning" }],
  strokes: [
    {
      d: "M11 52Q10.6 65.5 11 79A10 3 0 0 0 31 79Q31.4 65.5 31 52",
      fill: "paper",
      fillD: "M11 52L11 79A10 3 0 0 0 31 79L31 52Z",
    },
    { d: ring(21, 52, 10, 3), fill: "paper", fillD: disc(21, 52, 10, 3) },
    {
      d: "M36 30.4Q35.4 54.7 36 79A10 3 0 0 0 56 79Q56.6 54.7 56 30.4",
      fill: "paper",
      fillD: "M36 30.4L36 79A10 3 0 0 0 56 79L56 30.4Z",
    },
    { d: ring(46, 30.4, 10, 3, -2.6), fill: "paper", fillD: disc(46, 30.4, 10, 3) },
    {
      d: "M61 62.8Q60.6 70.9 61 79A10 3 0 0 0 81 79Q81.4 70.9 81 62.8",
      fill: "paper",
      fillD: "M61 62.8L61 79A10 3 0 0 0 81 79L81 62.8Z",
    },
    { d: ring(71, 62.8, 10, 3, -2), fill: "paper", fillD: disc(71, 62.8, 10, 3) },
    {
      d: "M11 57.4A10 3 0 0 0 31 57.4M11 62.8A10 3 0 0 0 31 62.8M11 68.2A10 3 0 0 0 31 68.2M11 73.6A10 3 0 0 0 31 73.6M36 35.8A10 3 0 0 0 56 35.8M36 41.2A10 3 0 0 0 56 41.2M36 46.6A10 3 0 0 0 56 46.6M36 52A10 3 0 0 0 56 52M36 57.4A10 3 0 0 0 56 57.4M36 62.8A10 3 0 0 0 56 62.8M36 68.2A10 3 0 0 0 56 68.2M36 73.6A10 3 0 0 0 56 73.6M61 68.2A10 3 0 0 0 81 68.2M61 73.6A10 3 0 0 0 81 73.6",
      tone: "sub",
      w: 1.4,
    },
    { d: "M66 17.6L66.4 23.2M76 17.6L75.6 23.2", tone: "sub", w: 1.6 },
    { d: ring(71, 38, 11.5), fill: "warning", fillD: disc(71, 38, 11.5) },
    {
      d: "M75.6 32.4Q73.4 30 70.4 30.4Q66.4 31 66.6 34.4Q67 37.4 71.2 38Q75.6 38.8 75.6 42.2Q75.4 45.8 71 45.8Q67.6 45.8 66 43.4M71.1 28L70.9 48",
      tone: "accent",
      w: 2.6,
    },
  ],
};

export default art;
