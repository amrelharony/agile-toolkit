import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** EBM Dashboard: an angular four-spoke radar, one spoke per key value area, its measured shape filled in and a small flag on the top spoke. */
const art: InkDrawing = {
  name: "ebm-dashboard",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 36, seed: 4313, tone: "accent" }],
  strokes: [
    { d: "M48 18.2L82 52L48.2 86L14 51.8Z", fill: "paper" },
    { d: "M48 35L65 52L48 69L31 52Z", tone: "sub", w: 1.4 },
    { d: "M48 18.6L48 85.6M14.4 52L81.6 52", tone: "sub", w: 1.6 },
    {
      d: "M46.2 40.7L49.8 40.7M46.2 29.3L49.8 29.3M46.2 63.3L49.8 63.3M46.2 74.7L49.8 74.7M36.7 50.2L36.7 53.8M25.3 50.2L25.3 53.8M59.3 50.2L59.3 53.8M70.7 50.2L70.7 53.8",
      w: 1.6,
    },
    { d: "M48 24.8L66.6 52L48 65.6L24.2 52Z", tone: "accent", w: 2.4, fill: "accent" },
    { d: "M48 18.2L48.2 5.8", w: 2 },
    {
      d: "M48.2 6.4L57.6 9.4L48.2 12.6",
      fill: "warning",
      fillD: "M48.2 6.4L57.6 9.4L48.2 12.6Z",
    },
  ],
};

export default art;
