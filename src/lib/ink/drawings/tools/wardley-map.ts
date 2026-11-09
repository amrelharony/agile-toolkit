import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Wardley Map Canvas: a user's value chain of linked components on the evolution axis, one component moving right. */
const art: InkDrawing = {
  name: "wardley-map",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 48, rx: 40, ry: 34, seed: 2518, tone: "accent" }],
  strokes: [
    { d: "M12.4 10.4Q11.6 47 12.2 85.6" },
    { d: "M10.4 84Q48 84.8 86.6 83.6M81.4 79.4L87.6 83.6L81.6 88" },
    {
      d: "M38 14L38.2 19M38.2 25L38.4 30M38.4 36L38.4 41M38.4 47L38.2 52M38.2 58L38 63M38 69L37.8 74M64 14L63.8 19M63.8 25L63.8 30M63.8 36L64 41M64 47L64.2 52M64.2 58L64.2 63M64.2 69L64 74",
      tone: "sub",
      w: 1.4,
    },
    {
      d: "M43 25Q44 30 45.4 32.2M43.2 39.6Q35 45 29 50.6M48.8 39.6Q53 45 56.4 48.6M28.4 57.4Q35 64 41.6 68.8M57.8 56.2Q53 63 47 68.6",
      w: 1.8,
    },
    {
      d: "M35.4 25Q35.8 19 42 18.8Q48.2 19 48.6 25",
      fill: "paper",
      fillD: "M35.4 25Q35.8 19 42 18.8Q48.2 19 48.6 25Z",
      w: 2,
    },
    { d: ring(42, 13.6, 3.8, 3.8, -2), fill: "paper", fillD: disc(42, 13.6, 3.8), w: 2 },
    { d: ring(46.4, 36, 4.4, 4.4, -2.4), fill: "paper", fillD: disc(46.4, 36, 4.4) },
    { d: ring(26, 54, 4.4, 4.4, -2), fill: "paper", fillD: disc(26, 54, 4.4) },
    { d: ring(59, 52.4, 4.4, 4.4, -2.6), fill: "paper", fillD: disc(59, 52.4, 4.4) },
    { d: ring(44, 72, 4.4, 4.4, -2.2), fill: "paper", fillD: disc(44, 72, 4.4) },
    {
      d: "M64.6 52.2L67.8 52.1M70.6 52L73.6 51.9M70.6 48.8L74.8 51.9L70.8 55",
      tone: "accent",
      w: 1.8,
    },
    {
      d: ring(80.6, 52, 4.6, 4.6, -2),
      tone: "accent",
      w: 2.4,
      fill: "accent",
      fillD: disc(80.6, 52, 4.6),
    },
  ],
};

export default art;
