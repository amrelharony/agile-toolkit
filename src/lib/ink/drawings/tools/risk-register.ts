import { dot } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Risk Register: a likelihood-by-impact heat grid, its top-right cell flagged red with a warning mark, two lesser risks logged below. */
const art: InkDrawing = {
  name: "risk-register",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 47, rx: 40, ry: 34, seed: 2266, tone: "info" }],
  strokes: [
    {
      d: "M22.4 11.8Q53 10.8 83.6 12Q84.2 42 83.2 72.6Q53 73.6 22 72.4Q21.2 42 22.4 11.8Z",
      fill: "paper",
    },
    {
      d: "M42.6 12.2Q41.8 42 42.6 72.6M63 12Q63.8 42 62.8 72.8M22.2 32.2Q53 31.4 83.4 32.6M22 52.4Q53 53.2 83.4 52.2",
      tone: "sub",
      w: 1.6,
      fill: "warning",
      fillD: "M42.6 12.2L63 12L63 32.4L83.4 32.4L83.4 52.4L42.6 52.4Z",
    },
    { d: "M14.6 77.6Q14 46 14.8 14.6M10.8 19.4L14.8 13.6L18.8 19.2", tone: "sub", w: 1.8 },
    { d: "M18.2 81Q52 80.2 85.4 81.2M80 76.8L85.8 81.2L80.2 85.6", tone: "sub", w: 1.8 },
    { d: `${dot(53, 42.6)}${dot(32.4, 62.4)}`, w: 4.4 },
    {
      d: "M73.2 16.6L73 24.8",
      tone: "danger",
      w: 3,
      fill: "danger",
      fillD: "M63 12L83.4 12.2L83.4 32.4L63 32.4Z",
    },
    { d: dot(73, 28.6), tone: "danger", w: 4 },
  ],
};

export default art;
