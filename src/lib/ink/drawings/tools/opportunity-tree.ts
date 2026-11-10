import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Opportunity Solution Tree: an outcome card branching into two opportunities, the target one shaded and growing two solutions, one tested with a tick. */
const art: InkDrawing = {
  name: "opportunity-tree",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 46, cy: 50, rx: 40, ry: 34, seed: 2259, tone: "accent" }],
  strokes: [
    { d: "M46.4 24Q44.6 33.6 27.4 39.4M49.6 24Q51.4 33.6 68.6 39.4", w: 2 },
    {
      d: "M24 51.4Q20.4 56.6 17 62.6M28.2 51.4Q32.2 56.6 35.6 62.6M70 51.4Q70.8 57 70.2 62.6",
      w: 2,
    },
    { d: "M34.6 10.8Q48 9.8 61.8 10.6L62.2 23.8Q48 24.6 34.2 23.6Z", fill: "paper" },
    { d: "M40.4 17.4Q48 16.6 55.6 17.2", tone: "sub", w: 1.6 },
    {
      d: "M13.2 39.6Q26 38.8 39.2 39.4L39.4 51.4Q26 52.2 12.8 51.2Z",
      tone: "accent",
      fill: "accent",
      w: 2.4,
    },
    { d: "M57.2 39.4Q70 38.8 82.8 39.6L83 51.2Q70 52 56.8 51.4Z", fill: "paper" },
    { d: ring(16, 69.4, 6.6, 6.6, -2.2), fill: "paper", fillD: disc(16, 69.4, 6.6) },
    { d: ring(36.4, 69.4, 6.6, 6.6, -2.6), fill: "paper", fillD: disc(36.4, 69.4, 6.6) },
    {
      d: ring(70.2, 69.4, 6.6, 6.6, -2),
      tone: "sub",
      w: 1.8,
      fill: "paper",
      fillD: disc(70.2, 69.4, 6.6),
    },
    { d: "M32.4 69.8L35.4 73L40.8 65.8", tone: "success", w: 2.6 },
  ],
};

export default art;
