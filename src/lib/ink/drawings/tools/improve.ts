import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Improve: a small plan-do-check-act wheel climbing a three-step staircase towards a pennant on the top step. */
const art: InkDrawing = {
  name: "improve",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 54, rx: 40, ry: 32, seed: 4315, tone: "accent3" }],
  strokes: [
    {
      d: "M6 84.4L28 84L28.2 70L48 69.8L48.2 55.6L68 55.4L68.2 41.4L90 41L90.2 84.6Z",
      fill: "paper",
    },
    { d: "M80 41.2L80.2 15.4", w: 2.4 },
    {
      d: "M80.2 16L92 21L80.2 26",
      fill: "accent3",
      fillD: "M80.2 16L92 21L80.2 26Z",
    },
    { d: ring(56, 46.4, 9, 9, -2.3), fill: "paper", fillD: disc(56, 46.4, 9) },
    {
      d: "M50.7 44.5A5.6 5.6 0 1 1 54.1 51.7M55.9 54.3L54.1 51.7L57.2 50.9",
      tone: "accent3",
      w: 1.8,
    },
    { d: "M40.4 44.2L44.4 44M39.6 49.8L43.8 49.6", tone: "sub", w: 1.6 },
  ],
};

export default art;
