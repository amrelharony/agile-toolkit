import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Burnup Generator: a clipboard chart where the points done climb towards a scope line that steps up when work is added. */
const art: InkDrawing = {
  name: "burnup",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 36, ry: 36, seed: 2098, tone: "success" }],
  strokes: [
    {
      d: "M21.6 19Q48 17.6 74.6 18.8Q76 52 74.8 87.2Q48 88.6 21.4 87.4Q20.2 52 21.6 19Z",
      fill: "paper",
    },
    { d: "M37.6 23.4L37.2 14.2Q48 12.4 58.8 14L58.4 23.6Q48 25 37.6 23.4Z", fill: "paper", w: 2 },
    { d: ring(48, 18.4, 2.4), tone: "sub", w: 1.6 },
    { d: "M30 31.6Q29.4 56 30.2 79.4Q48 80.2 67.8 79.2", w: 1.8 },
    { d: "M31.4 40.6Q40 40 47.4 40.4L47.8 33.2Q57 32.6 67.4 33.4" },
    { d: "M41.6 29.4L41.6 35.6M38.5 32.5L44.7 32.5", tone: "sub", w: 1.6 },
    { d: "M31 78Q40 76.6 44 68Q48 59.6 54 54Q59.6 48.6 62.6 40.8", tone: "accent", w: 2.8 },
    { d: "M58.4 43L62.8 39.4L63.8 45", tone: "accent", w: 2.4 },
  ],
};

export default art;
