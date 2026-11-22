import { dot } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Product Metrics: a funnel of three bands narrowing down, and a small star shining above its mouth for the North Star. */
const art: InkDrawing = {
  name: "product-metrics",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 34, seed: 4311, tone: "accent" }],
  strokes: [
    { d: "M14 34.4L82 34L73 44L23 44.2Z", fill: "accent" },
    { d: "M23 44.2L73 44L64 54L32 54.2Z", fill: "warning" },
    { d: "M32 54.2L64 54L55 64L41 64.2Z", fill: "success" },
    { d: "M41 64.2L41.2 78.6Q41.4 81 43.8 81L52.4 81Q55 80.8 55 78.4L55 64", w: 2 },
    { d: dot(48.2, 87.4), tone: "accent", w: 3.4 },
    {
      d: "M48 9L50.2 14.9L56.6 15.2L51.6 19.2L53.3 25.3L48 21.8L42.7 25.3L44.4 19.2L39.4 15.2L45.8 14.9Z",
      fill: "warning",
    },
    {
      d: "M33.4 12.2L36.4 13.8M33.2 21.6L36.4 20.6M62.6 12.2L59.6 13.8M62.8 21.6L59.6 20.6",
      tone: "warning",
      w: 1.6,
    },
  ],
};

export default art;
