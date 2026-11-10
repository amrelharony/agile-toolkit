import { dot } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Stacey Matrix: certainty and agreement axes with zones rippling out from the corner, the complex band tinted and an item plotted in it. */
const art: InkDrawing = {
  name: "stacey-matrix",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 38, ry: 34, seed: 2812, tone: "warning" }],
  strokes: [
    { d: "M16.2 84Q15.4 50 16.4 14.4", w: 2.4 },
    { d: "M13.6 82.2Q50 81.2 84.4 82.4", w: 2.4 },
    { d: "M11.8 20.4L16.4 13.8L21 20.6M78.2 77.4L85 82.4L78 87", w: 2.2 },
    { d: "M36.6 82.4A20.4 20 0 0 0 15.8 62", w: 2 },
    { d: "M56.6 82.6A40.6 39.8 0 0 0 15.6 41.8", w: 2 },
    {
      d: "M76.4 82.4A60.2 60.6 0 0 0 15.8 21.8",
      fill: "accent",
      fillD: "M56.4 82A40.4 40 0 0 0 16 42L16 22A60 60 0 0 1 76 82Z",
      w: 2,
    },
    { d: dot(25.4, 72.6), tone: "sub", w: 3.6 },
    { d: dot(51, 46.8), w: 4.8 },
  ],
};

export default art;
