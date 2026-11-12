import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Facilitator Timers: a stopwatch with its crown and side button, a third of the round shaded, ticking fast. */
const art: InkDrawing = {
  name: "facilitator-timers",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 52, rx: 38, ry: 34, seed: 4205, tone: "accent" }],
  strokes: [
    { d: "M48 24L48 16.4", w: 3.4 },
    { d: "M42.2 13.4Q48 11.8 53.8 13.4", w: 3.8 },
    { d: "M66.8 29.4L71.2 25", w: 3.4 },
    { d: ring(48, 52, 28, 28, -2.3), fill: "paper", fillD: disc(48, 52, 28) },
    { d: "M48 52L48 30A22 22 0 0 1 67 63Z", tone: "accent", fill: "accent", w: 1.6 },
    { d: "M48 26.8L48 29.6M73.2 52L70.4 52M48 77.2L48 74.4M22.8 52L25.6 52", tone: "sub", w: 1.8 },
    { d: "M48 52L59.6 38.2", w: 2.6 },
    { d: dot(48, 52), w: 4.4 },
    { d: "M9.4 44.4L15.6 44.2M7.4 52.4L14.8 52.2M9.6 60.4L15.6 60.2", tone: "sub", w: 1.8 },
  ],
};

export default art;
