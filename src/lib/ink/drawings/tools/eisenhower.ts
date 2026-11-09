import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Eisenhower Matrix: a four-box card, a tick in Do and a cross in Delete, an alarm clock on the corner for urgency. */
const art: InkDrawing = {
  name: "eisenhower",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 47, cy: 52, rx: 38, ry: 34, seed: 2756, tone: "warning" }],
  strokes: [
    {
      d: "M10.8 30.2Q42 29 73.2 30.4",
      fill: "paper",
      fillD: "M12 30L72.6 30.2L72.8 86L12.2 85.8Z",
    },
    { d: "M72.2 29Q73.2 57.6 72.4 86.8" },
    { d: "M73.6 85.8Q42 87 11 85.6" },
    { d: "M12.2 87Q11 58 12.4 29" },
    { d: "M42.4 30.6Q41.4 58 42.6 85.6M12.6 57.8Q42 59 72 57.4", w: 2 },
    { d: "M51.4 65.6L63.2 77.6M63.4 65.4L51.2 77.8", tone: "danger", w: 2.6 },
    {
      d: "M60.4 19.3A4.8 4.8 0 0 1 68.3 13.7ZM73.7 13.7A4.8 4.8 0 0 1 81.6 19.3Z",
      fill: "paper",
      w: 2,
    },
    { d: ring(71, 26, 12), fill: "paper", fillD: disc(71, 26, 12) },
    { d: "M71 26.4L70.8 18.4M71 26.4L76.8 29.6", w: 2.2 },
    { d: "M63.4 35.6L60.4 39.8M78.6 35.6L81.6 39.8", w: 2 },
    { d: "M86.2 19.6Q89 26 86.2 32.4", tone: "sub", w: 1.8 },
    { d: "M19.4 44.6L25.8 51.2L36.4 37", tone: "success", w: 3 },
  ],
};

export default art;
