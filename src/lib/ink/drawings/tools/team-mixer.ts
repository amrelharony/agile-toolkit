import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Team Mixer: four people swapping places across two crossing arrows, two groups shuffled into new ones. */
const art: InkDrawing = {
  name: "team-mixer",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 34, seed: 4211, tone: "plum" }],
  strokes: [
    { d: "M10.4 38.6Q20 26.4 29.6 38.6", fill: "accent", fillD: "M10.4 38.6Q20 26.4 29.6 38.6Z" },
    { d: ring(20, 22.6, 5.6, 5.6, -2.3), fill: "paper", fillD: disc(20, 22.6, 5.6) },
    { d: "M66.4 38.6Q76 26.4 85.6 38.6", fill: "accent3", fillD: "M66.4 38.6Q76 26.4 85.6 38.6Z" },
    { d: ring(76, 22.6, 5.6, 5.6, -2.3), fill: "paper", fillD: disc(76, 22.6, 5.6) },
    { d: "M10.4 82.6Q20 70.4 29.6 82.6", fill: "accent3", fillD: "M10.4 82.6Q20 70.4 29.6 82.6Z" },
    { d: ring(20, 66.6, 5.6, 5.6, -2.3), fill: "paper", fillD: disc(20, 66.6, 5.6) },
    { d: "M66.4 82.6Q76 70.4 85.6 82.6", fill: "accent", fillD: "M66.4 82.6Q76 70.4 85.6 82.6Z" },
    { d: ring(76, 66.6, 5.6, 5.6, -2.3), fill: "paper", fillD: disc(76, 66.6, 5.6) },
    { d: "M32.6 34.6Q48.4 40.6 61.4 64.2", w: 2.4 },
    { d: "M55.8 63.4L61.8 65L63.4 58.8", w: 2.4 },
    { d: "M32.6 66.4Q48.4 60.4 61.4 36.8", w: 2.4 },
    { d: "M55.8 37.6L61.8 36L63.4 42.2", w: 2.4 },
  ],
};

export default art;
