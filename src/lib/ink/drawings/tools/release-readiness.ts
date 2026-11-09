import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Release Readiness Checklist: a rocket on the pad, flame lit, with a big tick beside it for gates passed. */
const art: InkDrawing = {
  name: "release-readiness",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 50, rx: 38, ry: 36, seed: 2420, tone: "success" }],
  strokes: [
    {
      d: "M27.4 46.6L19.6 58.4L19.8 67.6L27.4 62.2M52.6 46.6L60.4 58.4L60.2 67.6L52.6 62.2",
      fill: "paper",
      fillD: "M27.4 46.6L19.6 58.4L19.8 67.6L27.4 62.2ZM52.6 46.6L60.4 58.4L60.2 67.6L52.6 62.2Z",
    },
    {
      d: "M40 10.4Q52.6 20.6 52.8 42L52.6 62.4Q40 63.2 27.4 62.6L27.2 42Q27.4 20.6 40 10.4Z",
      fill: "paper",
    },
    { d: "M30.2 25.6Q40 23.4 49.8 25.4", tone: "sub", w: 1.6 },
    { d: ring(40, 39, 5.6), w: 2 },
    { d: "M33.6 62.8L32.4 68.4Q40 69 47.6 68.4L46.4 62.8", w: 2 },
    {
      d: "M34.8 70.6Q35.6 79 40 87Q44.4 79 45.2 70.6",
      tone: "accent",
      fill: "accent",
      fillD: "M34.8 70.6Q35.6 79 40 87Q44.4 79 45.2 70.6Z",
    },
    { d: "M61.4 37.6L69 46L84.6 24.6", tone: "success", w: 3.2 },
  ],
};

export default art;
