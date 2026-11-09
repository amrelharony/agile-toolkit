import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Onboarding Speed Tracker: a new joiner's ID badge on its lanyard, a progress bar along the bottom part-way full. */
const art: InkDrawing = {
  name: "onboarding-tracker",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 54, rx: 36, ry: 36, seed: 2560, tone: "plum" }],
  strokes: [
    { d: "M29.4 7.4Q36.6 22 45.6 35.2M66.6 7.4Q59.4 22 50.4 35.2", w: 2.4 },
    { d: "M45 33.6L51 33.4L51.4 41L44.8 41.2Z", w: 2, fill: "paper" },
    {
      d: "M27.4 41.4Q48 40.2 68.8 41.2Q72.8 41.6 72.8 45.6L72.4 83.8Q72.2 87.8 68.2 87.8L27.8 88.2Q23.6 88 23.6 84L24 45.4Q24.2 41.6 27.4 41.4Z",
      fill: "paper",
    },
    { d: "M35.4 49.6L60.6 49.4L61 67.6L35.2 68Z", w: 1.8, fill: "plum" },
    { d: ring(48, 55.2, 4.4, 4.4, -2), w: 1.8 },
    { d: "M39.8 67.6Q40.2 61.2 48 61Q55.8 61.2 56.4 67.6", w: 1.8 },
    { d: "M34.6 73Q48 72.4 61.6 73", tone: "sub", w: 1.8 },
    { d: "M34.8 77.6Q48 77.2 61.4 77.4L61.4 84.2Q48 84.6 34.8 84.4Z", w: 1.8 },
    {
      d: "M49.2 77.4L49.4 84.4",
      tone: "accent",
      w: 2.2,
      fill: "accent",
      fillD: "M34.8 77.6L49.2 77.4L49.4 84.4L34.8 84.4Z",
    },
  ],
};

export default art;
