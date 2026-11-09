import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Tech Radar: the round radar cut into four quadrants and three rings, its sweep passing over a new blip. */
const art: InkDrawing = {
  name: "tech-radar",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 49, rx: 40, ry: 37, seed: 2553, tone: "plum" }],
  strokes: [
    { d: ring(48, 49, 37, 37, -2.3), fill: "paper", fillD: disc(48, 49, 37) },
    { d: ring(48, 49, 24.6, 24.6, -2), tone: "sub", w: 1.8 },
    { d: ring(48, 49, 12.2, 12.2, -2.6), w: 2 },
    { d: "M48.4 12.6Q47.6 49 48.2 85.6M11.4 49.4Q48 48.6 84.8 49.2", tone: "sub", w: 1.6 },
    { d: `${dot(32.6, 37.4)}${dot(66.4, 67.6)}${dot(29.6, 69.4)}${dot(77.4, 39.4)}`, w: 4.4 },
    {
      d: "M48.2 49Q62 38.4 75.4 26",
      tone: "accent",
      w: 2.6,
      fill: "accent",
      fillD: "M48 49L54.4 12.6A37 37 0 0 1 76.3 25.2Z",
    },
    {
      d: ring(58.3, 34.3, 3, 3, -2),
      tone: "accent",
      w: 2.2,
      fill: "accent",
      fillD: disc(58.3, 34.3, 3),
    },
  ],
};

export default art;
