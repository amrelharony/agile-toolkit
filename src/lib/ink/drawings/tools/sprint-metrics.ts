import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Sprint Metrics: a tape measure with its marked tape pulled out, for measuring how the sprints went. */
const art: InkDrawing = {
  name: "sprint-metrics",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 32, seed: 2329, tone: "success" }],
  strokes: [
    { d: "M22 28.2L22.2 23.8L36 23.6L36.2 28", w: 2 },
    {
      d: "M10.4 36Q10 28 18.4 28L44 27.8Q52.2 28 52.4 36L52.2 64Q52.2 72.4 44 72.4L18.2 72.6Q10 72.4 10.2 64Z",
      fill: "paper",
      w: 2.4,
    },
    { d: ring(31, 50, 10.4) },
    { d: ring(31, 50, 3.4, 3.4, -1.4), tone: "sub", w: 1.6 },
    {
      d: "M52.4 58.2Q69 57.6 86 58.4M86 70.2Q69 70.8 52.4 70.4",
      fill: "warning",
      fillD: "M52.2 58.2Q69 57.6 86 58.4L86 70.2Q69 70.8 52.2 70.4Z",
    },
    {
      d: "M57 58.4L57 63.4M62 58.2L62 65.8M67 58.2L67 63.2M72 58.2L72 65.8M77 58.4L77 63.4",
      tone: "sub",
      w: 1.6,
    },
    { d: "M86.2 53.6L86.8 74.8", tone: "accent", w: 3.2 },
  ],
};

export default art;
