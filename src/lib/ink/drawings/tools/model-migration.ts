import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Model Upgrade Migration Tracker: moving boxes wheeled off on a hand truck, an arrow up to the next version. */
const art: InkDrawing = {
  name: "model-migration",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 46, cy: 52, rx: 38, ry: 34, seed: 2644, tone: "accent2" }],
  strokes: [
    { d: "M8.6 62.4L15.4 62.2M7.4 70L14.8 69.8M9.6 77.6L15.6 77.4", tone: "sub", w: 1.6 },
    { d: "M21.6 15.2Q24.8 46 28.2 78.2", w: 2.8 },
    { d: "M18 16.4Q22 14.6 26.4 14", w: 3 },
    { d: "M30.6 77.6L30.2 53.6Q46 52.8 62.6 53.4L63 77.6Z", fill: "paper" },
    { d: "M34 53.6L33.8 34.4Q45.4 33.8 57.6 34.2L58 53.4Z", fill: "paper" },
    { d: "M46.4 53.4L46.6 61.6M45.8 34.2L45.8 41.4", tone: "sub", w: 2.4 },
    { d: "M27.6 79Q44 78.2 64.2 79", w: 2.8 },
    { d: ring(25, 82.4, 5.4), fill: "paper", fillD: disc(25, 82.4, 5.4) },
    { d: dot(25, 82.4), w: 3 },
    { d: "M68.4 66Q79 54 78.2 26.4", tone: "accent", w: 2.8 },
    { d: "M72.6 32L78.2 25.6L83.6 32.2", tone: "accent", w: 2.8 },
  ],
};

export default art;
