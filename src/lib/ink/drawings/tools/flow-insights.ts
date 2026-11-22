import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Flow Insights: a stacked bar of the work mix, an arrow curling from its top block back to the bottom for repeat work, and three people in a row, the third only half there for a team change. */
const art: InkDrawing = {
  name: "flow-insights",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 52, rx: 40, ry: 34, seed: 4314, tone: "success" }],
  strokes: [
    { d: "M8.6 82.8Q50 84.2 91.4 82.4", tone: "sub", w: 1.6 },
    { d: "M14.4 54.4L34 54.2L34.2 82L14.2 82.2Z", fill: "success" },
    { d: "M14.2 36.4L34.2 36.2L34 54.2L14.4 54.4Z", fill: "warning" },
    { d: "M14.4 22.4L34 22L34.2 36.2L14.2 36.4Z", fill: "danger" },
    { d: "M8.4 28.6L12 30.4L8.4 32.2M8.4 46.6L12 48.4L8.4 50.2", tone: "accent", w: 1.6 },
    { d: "M35.6 29.2Q45.6 30 46 49.6Q45.6 69.4 36.4 70M40.6 66.2L36.2 70L40.8 73.6", w: 2 },
    { d: ring(56, 62, 4.6, 4.6, -2.3), fill: "paper", fillD: disc(56, 62, 4.6) },
    { d: ring(69, 62, 4.6, 4.6, -2.6), fill: "paper", fillD: disc(69, 62, 4.6) },
    { d: "M50 82Q50.4 70.4 56 70.2Q61.6 70.4 62 82M63 82Q63.4 70.4 69 70.2Q74.6 70.4 75 82", w: 2 },
    { d: "M78 59.7A4.6 4.6 0 0 1 83.6 57.7", tone: "sub", w: 2 },
    { d: "M86 59.7A4.6 4.6 0 0 1 85 65.5", tone: "sub", w: 2 },
    { d: "M82 66.6A4.6 4.6 0 0 1 77.5 62.8", tone: "sub", w: 2 },
    { d: "M76 82Q76.2 76.2 78 73.4M86 73.4Q87.8 76.2 88 82", tone: "sub", w: 2 },
  ],
};

export default art;
