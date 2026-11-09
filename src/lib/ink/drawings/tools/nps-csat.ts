import { dot } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** NPS / CSAT Tracker: a smiling survey card being posted into a feedback box. */
const art: InkDrawing = {
  name: "nps-csat",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 38, ry: 34, seed: 2343, tone: "accent" }],
  strokes: [
    { d: "M18 48.4Q45 47.6 72.4 48.2L82.4 37.8Q55 37.2 28.2 38Z", fill: "paper" },
    { d: "M37.4 43.4Q49 42.8 60.6 43.2", w: 3 },
    {
      d: "M38.2 43.2Q36.6 28.4 36 13.6Q47.6 12.4 59.4 12.4Q59.4 27.8 60.4 43",
      fill: "paper",
      fillD: "M38.2 43.2Q36.6 28.4 36 13.6Q47.6 12.4 59.4 12.4Q59.4 27.8 60.4 43Z",
    },
    { d: `${dot(43.4, 23.6)}${dot(52.6, 23.2)}`, w: 3.8 },
    { d: "M41.6 30.2Q48 36.4 54.6 29.8", tone: "accent", w: 2.6 },
    {
      d: "M18 48.2Q17.6 67 18.2 86Q45 86.8 72.4 86.2Q72 67 72.4 48.4",
      fill: "paper",
      fillD: "M18 48.2L18.2 86L72.4 86.2L72.4 48.4Z",
    },
    {
      d: "M72.4 48.4L82.4 38Q82 57 82.6 75.6L72.4 86.2",
      fill: "accent",
      fillD: "M72.4 48.4L82.4 38L82.6 75.6L72.4 86.2Z",
    },
    { d: "M18.6 55.6Q45 54.8 71.8 55.4", tone: "sub", w: 1.6 },
  ],
};

export default art;
