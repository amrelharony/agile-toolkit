import { dot } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Backlog Health: a heartbeat line running over the backlog's list, one item flagged. */
const art: InkDrawing = {
  name: "backlog-health",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 56, rx: 38, ry: 32, seed: 4208, tone: "accent2" }],
  strokes: [
    {
      d: "M22.4 30.4L73.6 29.6Q78.4 29.6 78.4 34.4L78 81.4Q78 86.2 73.2 86.2L22.8 86.6Q18 86.6 18 81.8L18.2 35Q18.2 30.4 22.4 30.4Z",
      fill: "paper",
    },
    { d: dot(27.4, 44.6), w: 3.8 },
    { d: dot(27.4, 57), w: 3.8 },
    { d: dot(27.4, 69.4), w: 3.8 },
    { d: dot(27.4, 79.4), w: 3.8 },
    { d: "M34.6 44.6L68.6 44.2M34.6 69.4L66.4 69M34.6 79.4L56.4 79.2", tone: "sub", w: 1.8 },
    { d: "M33.8 52L70.2 51.6L70 62L34 62.4Z", tone: "warning", fill: "warning", w: 1.4 },
    { d: "M38.4 57L62.4 56.8", w: 1.8 },
    {
      d: "M6.4 21.6L27.6 21.4L32.6 11.6L39.4 32.2L45.8 5.8L52 26.2L56 21.4L89.6 21.2",
      tone: "danger",
      w: 2.8,
    },
  ],
};

export default art;
