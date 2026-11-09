import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Canvas: a whiteboard square and circle joined by a connector, and a marker scribbling free-hand. */
const art: InkDrawing = {
  name: "canvas",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 34, seed: 2826, tone: "accent3" }],
  strokes: [
    { d: "M12.6 14.6L36 13.8L36.8 37.4L13.4 38.2Z", fill: "accent2" },
    { d: ring(68, 48, 14, 14, -2.6), fill: "paper", fillD: disc(68, 48, 14) },
    { d: "M12 70Q17 58 22.6 68Q28 78 33.4 68Q38 60 43 66" },
    { d: "M50.8 69.2L63.2 84.8L57 89.6L44.6 74.2Z", fill: "paper", w: 2.2 },
    { d: "M50.8 69.2L44 67L44.6 74.2", w: 2.2 },
    { d: "M55.2 74.6L49 79.6", tone: "sub", w: 1.8 },
    { d: "M38.6 24Q64 18 67 31M62 27.6L67.2 33L71.4 27", tone: "accent", w: 2.4 },
  ],
};

export default art;
