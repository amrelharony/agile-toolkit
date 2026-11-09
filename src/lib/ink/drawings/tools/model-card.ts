import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Model Card Builder: a hang tag labelling the model, a cube for the model above its fact rows. */
const art: InkDrawing = {
  name: "model-card",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 52, rx: 36, ry: 36, seed: 2686, tone: "accent2" }],
  strokes: [
    { d: "M26.6 32L48 14.6L69.6 32L69.2 85L27 85.4Z", fill: "paper" },
    { d: ring(48, 27, 3.4), w: 2 },
    { d: "M50.2 24.4Q58 10 72 12Q82 13.4 84.4 22", tone: "sub", w: 1.6 },
    {
      d: "M48 37L56.2 41.4L56.2 50.6L48 55.2L39.8 50.6L39.8 41.4Z",
      tone: "accent",
      w: 2.2,
      fill: "accent",
    },
    { d: "M39.8 41.4L48 45.8L56.2 41.4M48 45.8L48 55.2", tone: "accent", w: 1.8 },
    { d: "M33.4 62.6Q48 62 62.6 62.4", w: 2.6 },
    { d: "M33.4 70Q45 69.6 56.6 69.8M33.4 77Q47 76.6 60 76.8", tone: "sub", w: 1.6 },
  ],
};

export default art;
