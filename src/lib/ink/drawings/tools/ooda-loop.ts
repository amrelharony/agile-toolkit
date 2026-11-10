import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** OODA Loop Tracker: four arrows chasing each other round a loop, a watching eye at its centre. */
const art: InkDrawing = {
  name: "ooda-loop",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 48, rx: 38, ry: 35, seed: 2798, tone: "warning" }],
  strokes: [
    { d: "M53.7 15.5A33.6 33.6 0 0 1 80.5 42.3M83.2 36.3L80.5 42.3L75.8 37.6", w: 2.4 },
    { d: "M80.5 53.7A32.6 32.6 0 0 1 53.7 80.5M59.7 83.2L53.7 80.5L58.4 75.8", w: 2.4 },
    { d: "M42.3 80.5A33.4 33.4 0 0 1 15.5 53.7M12.8 59.7L15.5 53.7L20.2 58.4", w: 2.4 },
    { d: "M15.5 42.3A32.8 32.8 0 0 1 42.3 15.5M36.3 12.8L42.3 15.5L37.6 20.2", w: 2.4 },
    {
      d: "M29.4 48.6Q48 32.6 66.6 47.6Q48 63.4 28.6 47.8",
      fill: "paper",
      fillD: "M29.4 48.6Q48 32.6 66.6 47.6Q48 63.4 29.4 48.6Z",
    },
    {
      d: ring(48, 48, 6.6, 6.6, -2),
      tone: "accent",
      fill: "accent",
      fillD: disc(48, 48, 6.6),
      w: 2.2,
    },
    { d: dot(48, 48), w: 4.4 },
  ],
};

export default art;
