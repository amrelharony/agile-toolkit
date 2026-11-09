import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Cost of Delay: a jar of coins with a hole in it, the value leaking out while the work waits. */
const art: InkDrawing = {
  name: "cost-of-delay",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 48, rx: 38, ry: 36, seed: 2728, tone: "warning" }],
  strokes: [
    {
      d: "M30.6 30.6Q28.6 31.2 28.8 34.4L29.6 77.8Q30 83.4 35.6 83.6L60.4 83.4Q65.8 83.2 66.2 77.6L67 34.4Q67.2 31.2 65.2 30.6",
      fill: "paper",
      fillD:
        "M30.6 30.6Q28.6 31.2 28.8 34.4L29.6 77.8Q30 83.4 35.6 83.6L60.4 83.4Q65.8 83.2 66.2 77.6L67 34.4Q67.2 31.2 65.2 30.6Z",
    },
    {
      d: "M27.4 24.6Q48 22.4 68.6 24.8L68.2 30.6Q48 32.8 27.8 30.4Z",
      tone: "ink",
      fill: "wood",
      w: 2.2,
    },
    {
      d: ring(47.6, 75.4, 12, 3.8, -2.6),
      tone: "warning",
      fill: "warning",
      fillD: ring(47.6, 75.4, 12, 3.8, 0, 0),
      w: 2,
    },
    {
      d: ring(48.6, 68.2, 12, 3.8, -2.2),
      tone: "warning",
      fill: "warning",
      fillD: ring(48.6, 68.2, 12, 3.8, 0, 0),
      w: 2,
    },
    {
      d: ring(47.4, 61, 11.6, 3.8, -2.4),
      tone: "warning",
      fill: "warning",
      fillD: ring(47.4, 61, 11.6, 3.8, 0, 0),
      w: 2,
    },
    { d: "M66.8 62.2Q70.4 63.2 67 66.8", w: 2.4 },
    {
      d: ring(76.4, 70.4, 4.4, 4.4, -2),
      tone: "warning",
      fill: "warning",
      fillD: ring(76.4, 70.4, 4.4, 4.4, 0, 0),
      w: 2,
    },
    {
      d: ring(81.6, 83.2, 3.8, 3.8, -2.4),
      tone: "warning",
      fill: "warning",
      fillD: ring(81.6, 83.2, 3.8, 3.8, 0, 0),
      w: 2,
    },
    { d: "M71.8 76.4L73.6 79.2M78.4 61.6L80.6 60.2M86.6 76.6L88.4 75.4", tone: "sub", w: 1.5 },
    { d: "M15.6 46.4L15.8 62.4M11.6 57.6L15.8 62.8L20 57.6", tone: "accent", w: 2.4 },
  ],
};

export default art;
