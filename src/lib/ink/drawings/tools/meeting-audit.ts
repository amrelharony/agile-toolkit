import { dot } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Meeting Audit: a wall calendar with a big tick across the week, the meeting that earned its place. */
const art: InkDrawing = {
  name: "meeting-audit",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 54, rx: 40, ry: 32, seed: 4213, tone: "plum" }],
  strokes: [
    {
      d: "M20.4 22.4L75.6 21.8Q80.4 21.8 80.4 26.6L80.2 79.6Q80.2 84.4 75.4 84.4L20.6 84.8Q15.8 84.8 15.8 80L16 27Q16 22.4 20.4 22.4Z",
      fill: "paper",
    },
    {
      d: "M20.4 22.4L75.6 21.8Q80.4 21.8 80.4 26.6L80.4 36.4L15.8 36.6L16 27Q16 22.4 20.4 22.4Z",
      fill: "accent",
    },
    { d: "M32.4 15.4L32.6 28.2M63.6 15.2L63.8 28", w: 3.4 },
    { d: dot(27, 46), w: 3.4 },
    { d: dot(39, 46), w: 3.4 },
    { d: dot(51, 46), w: 3.4 },
    { d: dot(27, 76), w: 3.4 },
    { d: dot(69, 76), w: 3.4 },
    { d: "M33 61.6L44 72.4L68.4 48.8", tone: "success", w: 4.6 },
  ],
};

export default art;
