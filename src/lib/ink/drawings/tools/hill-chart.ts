import { dot } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Hill Chart: a smooth hill split at its top, two pieces of work climbing the left slope, one past the top and on its way down. */
const art: InkDrawing = {
  name: "hill-chart",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 56, rx: 40, ry: 30, seed: 4304, tone: "success" }],
  strokes: [
    {
      d: "M6 78Q20 77.6 30 58Q40 34.4 48 34.2Q56 34.4 66 58Q76 77.6 90 78",
      fill: "success",
      fillD: "M6 78Q20 77.6 30 58Q40 34.4 48 34.2Q56 34.4 66 58Q76 77.6 90 78Z",
    },
    { d: "M5 79.2Q48 80.6 91 78.8", tone: "sub", w: 1.6 },
    { d: "M48 40.4L48 44.8M48 50.4L48 54.8M48 60.4L48 64.8M48 70.4L48 74.8", tone: "sub", w: 1.4 },
    { d: "M38.4 24.4Q48 16.4 58.6 23.8M53.8 23.6L58.8 24L57.8 19", w: 2 },
    { d: `${dot(24.8, 66.2)}${dot(39.2, 40.2)}`, tone: "warning", w: 6.4 },
    { d: dot(56.8, 40.4), tone: "success", w: 6.4 },
  ],
};

export default art;
