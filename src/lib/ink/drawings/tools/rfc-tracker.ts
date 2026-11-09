import { dot } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** RFC Tracker: a draft page out for comment, a question bubble and a reply bubble pinned to its edge. */
const art: InkDrawing = {
  name: "rfc-tracker",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 50, rx: 40, ry: 34, seed: 2567, tone: "warning" }],
  strokes: [
    {
      d: "M14 16.2Q30 15.4 44.8 16L56.4 27.6Q56.8 56 56.4 83.6Q35 84.4 14.4 83.8Q13.4 50 14 16.2Z",
      fill: "paper",
    },
    { d: "M44.8 16.4L45 27.8L56.2 27.6", w: 1.8 },
    {
      d: "M20.4 30.2L38.6 29.8M20.4 38.6L48.4 38.2M20.4 47L44.2 46.6M20.4 55.4L48.6 55M20.4 63.8L36.4 63.6M20.4 72.2L44 71.8",
      tone: "sub",
      w: 1.6,
    },
    {
      d: "M58 40.2L52.6 47.2L56.2 40.2Q50.2 40 50.4 34L50.6 22.2Q50.8 16.2 56.8 16.2L80 15.8Q86 16 86 22L85.8 34Q85.6 40 79.6 40.2Z",
      fill: "paper",
    },
    {
      d: "M60.4 71.6Q56.4 71.4 56.6 67.4L56.6 57.2Q56.8 52.4 61.4 52.4L82.6 52.2Q87.6 52.4 87.6 57.2L87.4 66.8Q87.2 71.6 82.4 71.6L66 71.8L58.6 78.4Z",
      fill: "accent2",
    },
    { d: `${dot(65.4, 62)}${dot(72, 62)}${dot(78.6, 62)}`, w: 3.8 },
    {
      d: "M63.8 24.2Q64.2 20 68.6 20Q73.2 20.2 73 24.4Q72.8 27.4 68.6 29L68.4 31.6",
      tone: "accent",
      w: 2.6,
    },
    { d: dot(68.4, 35.4), tone: "accent", w: 3.6 },
  ],
};

export default art;
