import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Cycle Time Analyzer: a right-skewed histogram of cycle times with a dashed percentile line, and a stopwatch. */
const art: InkDrawing = {
  name: "cycle-time",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 34, seed: 2119, tone: "success" }],
  strokes: [
    {
      d: "M12 84L12.2 70L21 70.2L21.2 52L30 52.2L30.2 44L39 44.2L39.2 56L48 56.2L48.2 66L57 66.2L57.2 75L66 75.2L66.2 84",
      fill: "success",
      fillD:
        "M12 84L12.2 70L21 70.2L21.2 52L30 52.2L30.2 44L39 44.2L39.2 56L48 56.2L48.2 66L57 66.2L57.2 75L66 75.2L66.2 84Z",
    },
    {
      d: "M21.2 70.4L21 83.6M30.2 52.4L30 83.6M39.2 56.4L39 83.6M48.2 66.4L48 83.6M57.2 75.4L57 83.6",
      tone: "sub",
      w: 1.4,
    },
    { d: "M8.8 84.2Q38 85.2 70.4 84" },
    { d: ring(71, 30, 13, 13, -2), fill: "paper", fillD: disc(71, 30, 13) },
    { d: "M71 17L71 12.6M66.4 11.8Q71 10.6 75.6 11.8", w: 2.4 },
    { d: "M80.6 19.6L83.6 16.6", w: 2.4 },
    { d: "M71 20L71 22.6M81 30L78.4 30M71 40L71 37.4M61 30L63.6 30", tone: "sub", w: 1.6 },
    {
      d: "M52.6 46L52.6 50.6M52.6 54.6L52.6 59.2M52.6 63.2L52.6 67.8M52.6 71.8L52.6 76.4M52.6 80.4L52.6 86",
      tone: "accent",
      w: 2.4,
    },
    { d: "M71 30L77.6 23.4", tone: "accent", w: 2.6 },
    { d: dot(71, 30), w: 3.6 },
  ],
};

export default art;
