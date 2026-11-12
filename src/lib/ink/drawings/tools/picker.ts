import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Picker: a prize wheel on its stand, two slices coloured, the pointer at the top and the wheel still turning. */
const art: InkDrawing = {
  name: "picker",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 36, seed: 4201, tone: "accent" }],
  strokes: [
    { d: "M44.4 70L38.6 86M51.6 70L57.4 86", w: 2.6 },
    { d: "M30.4 86.4Q48 87.6 65.8 86.2", tone: "sub", w: 1.8 },
    { d: ring(48, 44, 28, 28, -2.3), fill: "paper", fillD: disc(48, 44, 28) },
    { d: "M48 44L48 16A28 28 0 0 1 72.2 30Z", tone: "accent", fill: "accent", w: 1.6 },
    { d: "M48 44L48 72A28 28 0 0 1 23.8 58Z", tone: "accent2", fill: "accent2", w: 1.6 },
    { d: "M48 16L48 72M72.2 30L23.8 58M72.2 58L23.8 30", tone: "sub", w: 1.4 },
    { d: ring(48, 44, 28, 28, -2.3), w: 2.4 },
    { d: ring(48, 44, 4.6, 4.6, -2.2), fill: "paper", fillD: disc(48, 44, 4.6) },
    { d: dot(48, 44), w: 3.6 },
    { d: "M42.4 8.6Q48 7.6 53.6 8.8L48.2 19.4Z", fill: "danger", w: 1.8 },
    { d: "M81.4 30.6Q85.4 44 81.2 57.4M87 36.8Q88.8 44 86.8 51.2", tone: "sub", w: 1.6 },
  ],
};

export default art;
