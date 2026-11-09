import { dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** LLM Eval Tracker: a spiral lab notebook charting the eval score across releases, the newest point flagged. */
const art: InkDrawing = {
  name: "llm-eval-tracker",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 38, ry: 34, seed: 2595, tone: "accent2" }],
  strokes: [
    { d: "M18.6 22.8Q49 21.6 78.6 22.4L78 84.4Q48.4 85.6 19.2 84.6Z", fill: "paper" },
    {
      d: `${ring(30, 22.6, 2.4, 4.6, -2)}${ring(42, 22.4, 2.4, 4.6, -2)}${ring(54, 22.4, 2.4, 4.6, -2)}${ring(66, 22.6, 2.4, 4.6, -2)}`,
      w: 1.8,
    },
    { d: "M28.4 34Q27.8 54 28.4 73.6Q49 72.8 70.6 73.8", tone: "sub", w: 1.8 },
    { d: "M42.8 71L42.8 76.4M53.6 71L53.6 76.4M65.4 71L65.4 76.4", tone: "sub", w: 1.6 },
    { d: "M31.6 65.4L42.8 55.6L53.6 60.4L65.4 41.8", w: 2.4 },
    { d: `${dot(31.6, 65.4)}${dot(42.8, 55.6)}${dot(53.6, 60.4)}`, w: 4.2 },
    {
      d: "M65.4 38.2L65.4 29.4L73 32L65.4 34.6",
      tone: "accent",
      w: 2,
      fill: "accent",
      fillD: "M65.4 29.4L73 32L65.4 34.6Z",
    },
    { d: ring(65.4, 41.8, 3.6), tone: "accent", w: 2.6 },
  ],
};

export default art;
