import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Team Dashboard: a monitor with three KPI lamps lit green, amber and red over their readings. */
const art: InkDrawing = {
  name: "health-dashboard",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 34, seed: 2133, tone: "success" }],
  strokes: [
    { d: "M42.4 66.4L40.6 79.2M53.6 66.4L55.4 79.2", w: 2 },
    { d: "M27.6 80.6Q48 78.2 68.4 80.4", w: 2.6 },
    {
      d: "M11.6 17.6Q48 16 84.4 17.4Q85.6 42 84.6 65.6Q48 67 11.4 65.8Q10.4 42 11.6 17.6Z",
      fill: "paper",
    },
    { d: ring(28, 36, 8), tone: "success", fill: "success", fillD: disc(28, 36, 8), w: 2.4 },
    { d: ring(48, 36, 8, 8, -2), tone: "warning", fill: "warning", fillD: disc(48, 36, 8), w: 2.4 },
    { d: ring(68, 36, 8, 8, -2.6), tone: "danger", fill: "danger", fillD: disc(68, 36, 8), w: 2.4 },
    {
      d: "M21 53Q28 52.6 35 53M41 53Q48 52.6 55 53M61 53Q68 52.6 75 53",
      tone: "sub",
      w: 2,
    },
  ],
};

export default art;
