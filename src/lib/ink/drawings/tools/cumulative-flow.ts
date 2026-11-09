import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Cumulative Flow Diagram: three stacked bands (to do, doing, done) widening across the days, with the work in progress marked. */
const art: InkDrawing = {
  name: "cumulative-flow",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 50, rx: 40, ry: 34, seed: 2112, tone: "success" }],
  strokes: [
    { d: "M14.6 12.6Q13.6 48 14.8 82.6M12.4 81.4Q50 82.6 87.4 80.8" },
    {
      d: "M16 56Q38 44 54 33Q70 22 86 17",
      fill: "paper",
      fillD: "M16 56Q38 44 54 33Q70 22 86 17L86 38Q72 41 56 51Q40 61 16 68Z",
    },
    {
      d: "M16 68Q40 61 56 51Q72 41 86 38",
      fill: "accent2",
      fillD: "M16 68Q40 61 56 51Q72 41 86 38L86 56Q74 59 58 67Q42 75 16 78Z",
    },
    {
      d: "M16 78Q42 75 58 67Q74 59 86 56",
      fill: "success",
      fillD: "M16 78Q42 75 58 67Q74 59 86 56L86 80L16 80Z",
    },
    { d: "M86.4 16Q87 48 86.2 80.4", tone: "sub", w: 1.6 },
    {
      d: "M72 45L72.2 58.4M68.8 48.6L72 44.6L75.2 48.6M69 55L72.2 59L75.4 55",
      tone: "accent",
      w: 2.4,
    },
  ],
};

export default art;
