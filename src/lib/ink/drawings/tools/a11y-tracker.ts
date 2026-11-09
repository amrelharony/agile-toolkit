import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Accessibility Audit Tracker: the universal-access figure in its circle, with a green check badge for fixes landed. */
const art: InkDrawing = {
  name: "a11y-tracker",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 48, rx: 38, ry: 36, seed: 2455, tone: "info" }],
  strokes: [
    { d: ring(46, 46, 32, 32, -2.3), fill: "paper", fillD: disc(46, 46, 32) },
    { d: "M26.2 35.4Q46 36.4 65.8 35.2", w: 3 },
    { d: "M46 34.6Q45.6 46 46 56.4", w: 3 },
    { d: "M46 56Q41.2 64 37.4 73.2M46 56Q50.8 64 54.6 73.2", w: 3 },
    { d: ring(73, 73, 10.4, 10.4, -2.6), fill: "paper", fillD: disc(73, 73, 10.4) },
    { d: "M67.6 73.4L71.6 77.4L78.8 68.8", tone: "success", w: 2.6 },
    { d: ring(46, 24.6, 4.6), tone: "accent", fill: "accent", fillD: disc(46, 24.6, 4.6), w: 2.4 },
  ],
};

export default art;
