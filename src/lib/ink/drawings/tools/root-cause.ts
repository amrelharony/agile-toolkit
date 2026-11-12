import { dot } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Root Cause: a fishbone diagram, its bones of causes running into the problem at the head. */
const art: InkDrawing = {
  name: "root-cause",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 32, seed: 4209, tone: "accent3" }],
  strokes: [
    { d: "M10.6 50.2Q42 49.4 73.6 50", w: 2.8 },
    { d: "M10.6 50.2L4.4 41.6M10.6 50.2L4.6 58.8", w: 2.4 },
    {
      d: "M17.6 22.6L28.4 50M37.6 22.6L48.4 50M57.2 22.6L66.4 50M17.6 77.4L28.4 50M37.6 77.4L48.4 50M57.2 77.4L66.4 50",
      w: 2.2,
    },
    {
      d: "M22.8 35.8L13.4 35.8M42.8 35.8L33.4 35.8M62 35.8L54.2 35.8M22.8 64.2L13.4 64.2M42.8 64.2L33.4 64.2M62 64.2L54.2 64.2",
      tone: "sub",
      w: 1.6,
    },
    {
      d: "M75.6 38.6L87.6 38.4Q91 38.4 91 41.8L90.8 58.2Q90.8 61.6 87.4 61.6L75.6 61.8Q73.4 61.8 73.4 59.4L73.6 41Q73.6 38.6 75.6 38.6Z",
      fill: "danger",
    },
    { d: "M82.2 43.6L82.2 52.2", tone: "danger", w: 3 },
    { d: dot(82.2, 56.8), tone: "danger", w: 3.6 },
  ],
};

export default art;
