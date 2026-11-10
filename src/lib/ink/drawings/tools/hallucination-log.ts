import { dot } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Hallucination Log: an answer bubble with a ghost in it where the facts should be, flagged with a red warning mark. */
const art: InkDrawing = {
  name: "hallucination-log",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 46, cy: 46, rx: 40, ry: 34, seed: 2616, tone: "accent2" }],
  strokes: [
    {
      d: "M19.6 14.8Q43 13.6 66.4 14.4Q73.8 14.8 74 22L73.8 56Q73.6 63.2 66.2 63.4L33 63.8L18.6 75.6L22.4 63.6Q12.4 63.2 12.4 56L12.6 22Q12.8 15 19.6 14.8Z",
      fill: "paper",
    },
    {
      d: "M29.6 57.2Q29.2 23.6 43 23.4Q56.8 23.6 56.4 57.2L51.9 52.9L47.5 57.4L43 52.9L38.5 57.4L34.1 52.9Z",
    },
    { d: `${dot(38.4, 36.4)}${dot(47.6, 36.4)}`, w: 3.6 },
    { d: "M40.4 44.6Q43 46 45.6 44.6", w: 1.6 },
    { d: "M84.2 18.6Q83.4 32 82.8 44", tone: "danger", w: 3.2 },
    { d: dot(82.6, 53), tone: "danger", w: 4.4 },
  ],
};

export default art;
