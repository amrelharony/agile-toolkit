import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Ceremony Timer: a twin-bell alarm clock whose face is cut into agenda segments, one time-box shaded. */
const art: InkDrawing = {
  name: "ceremony-timer",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 38, ry: 34, seed: 2168, tone: "accent" }],
  strokes: [
    { d: "M26.3 43.2A9 9 0 0 1 40.1 31.6Z", fill: "paper" },
    { d: "M55.9 31.6A9 9 0 0 1 69.7 43.2Z", fill: "paper" },
    { d: "M27.4 30.6L25.4 28.2M68.6 30.6L70.6 28.2", w: 3 },
    { d: "M34.6 76.4L29.4 84M61.4 76.4L66.6 84", w: 2.6 },
    { d: "M48 30.6L48 25.8", w: 2.2 },
    { d: "M44.2 25.4Q48 24.6 51.8 25.4", w: 2.8 },
    { d: ring(48, 55, 25, 25, -2.3), fill: "paper", fillD: disc(48, 55, 25) },
    { d: "M48 55L48 38A17 17 0 0 1 62.7 63.5Z", tone: "accent", fill: "accent", w: 1.8 },
    { d: "M48 55L33.3 63.5", tone: "sub", w: 1.6 },
    { d: "M69.6 55L66.8 55M48 76.6L48 73.8M26.4 55L29.2 55", tone: "sub", w: 1.6 },
    { d: "M48 55L58.4 46.8", w: 2.6 },
    { d: dot(48, 55), w: 4.4 },
  ],
};

export default art;
