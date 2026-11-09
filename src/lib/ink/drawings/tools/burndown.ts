import { dot } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Burndown Generator: a flip chart on an easel, the points left stepping down to zero beside a dashed ideal line. */
const art: InkDrawing = {
  name: "burndown",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 38, ry: 34, seed: 2091, tone: "success" }],
  strokes: [
    { d: "M28.4 60L18.6 88.2M67.6 60L77.4 88.2" },
    { d: "M48 62L48.4 84.6", tone: "sub", w: 1.6 },
    {
      d: "M19.4 16.6Q48 15.6 76.8 16.4Q77.6 40 76.6 64.2Q48 65.4 19.8 64.4Q18.8 40 19.4 16.6Z",
      fill: "paper",
    },
    { d: "M14.6 15.4Q48 13 81.6 15", w: 2.4 },
    { d: "M27.6 22.4Q27 40 27.8 56.8Q48 57.6 69.8 56.4", w: 1.8 },
    {
      d: "M29 24L32.1 26.5M34.5 28.3L37.6 30.8M39.9 32.7L43 35.2M45.4 37L48.5 39.5M50.8 41.4L54 43.8M56.3 45.7L59.4 48.2M61.8 50L64.9 52.5",
      tone: "sub",
      w: 1.6,
    },
    {
      d: "M29 24.2L35.6 24.8L37 32.4L43.2 33L44.4 41.4L50.6 41.8L52 48.6L58.4 49.2L59.6 55.6L66.4 55.8",
      tone: "accent",
      w: 2.8,
    },
    { d: dot(66.6, 55.8), tone: "accent", w: 4.4 },
  ],
};

export default art;
