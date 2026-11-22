import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Team Time: a globe with a small clock face over its lower right, hands at ten to two, and the sun rising over its top. */
const art: InkDrawing = {
  name: "team-time",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 36, seed: 4317, tone: "plum" }],
  strokes: [
    { d: ring(42, 52, 28, 28, -2.3), fill: "paper", fillD: disc(42, 52, 28) },
    { d: "M42.4 24.4Q24.6 52 42.4 79.6M41.6 24.4Q59.4 52 41.6 79.6", w: 1.8 },
    {
      d: "M33.6 25.3A8.4 8.4 0 0 1 50.4 25.3",
      tone: "warning",
      w: 2.2,
      fill: "warning",
      fillD: "M33.6 25.3A8.4 8.4 0 0 1 50.4 25.3Z",
    },
    { d: "M42 14.2L42 10.8M34.2 17.4L31.8 15M49.8 17.4L52.2 15", tone: "warning", w: 1.8 },
    { d: ring(68, 72, 14, 14, -2), fill: "paper", fillD: disc(68, 72, 14) },
    { d: "M68 60.6L68 62.6M79.4 72L77.4 72M68 83.4L68 81.4M56.6 72L58.6 72", tone: "sub", w: 1.6 },
    { d: "M59.4 67L68 72L73.7 68", w: 2.4 },
    { d: dot(68, 72), w: 3.6 },
  ],
};

export default art;
