import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Walking Skeleton Builder: screen, service and database, threaded by one thin end-to-end line. */
const art: InkDrawing = {
  name: "walking-skeleton",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 49, rx: 36, ry: 36, seed: 2763, tone: "accent2" }],
  strokes: [
    {
      d: "M20.4 12.6Q20.4 10 23 10L73 9.6Q75.6 9.6 75.6 12.2L75.8 29.6Q75.8 32 73.2 32L23.2 32.4Q20.6 32.4 20.6 29.8Z",
      fill: "paper",
    },
    { d: "M21 17.6Q48 17 75.4 17.4", tone: "sub", w: 1.6 },
    { d: `${dot(25.4, 13.8)}${dot(30, 13.8)}`, tone: "sub", w: 3 },
    { d: "M28.4 41.6L67.8 41.2L68.2 58.6L28.6 59Z", fill: "paper" },
    { d: "M29 50.2Q48 49.6 67.6 50", tone: "sub", w: 1.6 },
    { d: `${dot(33.6, 45.8)}${dot(33.6, 54.4)}`, tone: "sub", w: 3 },
    {
      d: "M31 69.8L31.2 82.4Q31.6 87.4 48 87.6Q64.4 87.4 64.8 82.4L65 69.8",
      fill: "accent2",
      fillD: "M31 69.8L31.2 82.4Q31.6 87.4 48 87.6Q64.4 87.4 64.8 82.4L65 69.8Q48 64.4 31 69.8Z",
    },
    { d: ring(48, 69.8, 17, 5, -2.6), fill: "paper", fillD: disc(48, 69.8, 17, 5) },
    { d: "M31.2 77Q48 81.6 64.8 76.8", tone: "sub", w: 1.6 },
    { d: "M48.2 23.6Q47.4 50 48.2 79.4", tone: "accent", w: 2.6 },
    { d: `${dot(48.2, 24.4)}${dot(48, 50.2)}${dot(48.2, 79)}`, tone: "accent", w: 4.4 },
  ],
};

export default art;
