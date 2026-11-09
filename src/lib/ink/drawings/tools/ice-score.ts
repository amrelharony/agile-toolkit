import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** ICE Score Card: a bubbling lab flask for a growth experiment, a rising arrow climbing out beside it. */
const art: InkDrawing = {
  name: "ice-score",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 50, rx: 38, ry: 34, seed: 2700, tone: "warning" }],
  strokes: [
    {
      d: "M38.8 15.6Q38.4 26 38.8 36.4Q28.6 55 19.6 74.6Q17.4 80.4 23.4 80.6Q44 81.4 64.6 80.4Q70.6 80.2 68.2 74.4Q59.6 55 49.4 36.2Q49.8 26 49.4 15.6",
      fill: "paper",
      fillD:
        "M38.8 15.6Q38.4 26 38.8 36.4Q28.6 55 19.6 74.6Q17.4 80.4 23.4 80.6Q44 81.4 64.6 80.4Q70.6 80.2 68.2 74.4Q59.6 55 49.4 36.2Q49.8 26 49.4 15.6Z",
    },
    { d: "M35.4 14.8Q44 13.2 52.8 15", w: 2.4 },
    {
      d: "M28.4 58.4Q33.4 56.4 38.4 58.2T48.4 58T59.6 57.8",
      tone: "accent2",
      w: 1.6,
      fill: "accent2",
      fillD:
        "M28.4 58.4Q33.4 56.4 38.4 58.2T48.4 58T59.6 57.8Q64 66 68.2 74.4Q70.6 80.2 64.6 80.4Q44 81.4 23.4 80.6Q17.4 80.4 19.6 74.6Q24 66 28.4 58.4Z",
    },
    { d: ring(37.6, 70, 3), w: 1.8 },
    { d: ring(50.4, 65.4, 2.2), w: 1.6 },
    { d: ring(45, 47, 2.4), tone: "sub", w: 1.6 },
    { d: "M57.8 46.6Q62.6 41.6 65.6 36.8L71 40Q77.4 30.6 85 21", tone: "accent", w: 2.8 },
    { d: "M78.2 20.6L85.4 20.2L85 27.4", tone: "accent", w: 2.8 },
  ],
};

export default art;
