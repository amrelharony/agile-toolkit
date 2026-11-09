import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Premortem Facilitator: a crystal ball showing the project's line falling, looking ahead to failure. */
const art: InkDrawing = {
  name: "premortem",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 38, ry: 34, seed: 2273, tone: "accent3" }],
  strokes: [
    { d: ring(48, 41, 25, 25, -2.3), fill: "paper", fillD: disc(48, 41, 25) },
    { d: "M29.6 62.6Q48 70 66.4 62.6L73.4 80.6Q48 86.6 22.6 80.6Z", fill: "paper" },
    { d: "M26 74Q48 79.6 70 74", tone: "sub", w: 1.6 },
    { d: "M30.6 31Q33.4 23.6 41 20.4", tone: "sub", w: 1.8 },
    { d: "M74 13.6L74 21.6M70 17.6L78 17.6", tone: "sub", w: 1.8 },
    { d: "M32 34L41.6 42.4L48.6 36.4L62 52M61.2 44L62 52L54.2 50", tone: "danger", w: 2.8 },
  ],
};

export default art;
