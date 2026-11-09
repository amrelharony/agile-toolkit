import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Agile Maturity Assessment: five steps of maturity, the first three shaded as reached, a teammate on the third and a flag on the top step. */
const art: InkDrawing = {
  name: "maturity",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 52, rx: 39, ry: 34, seed: 2196, tone: "plum" }],
  strokes: [
    {
      d: "M10.4 86.2L10.2 75.4Q17.8 74.6 25.4 75L25.2 64.2Q32.8 63.4 40.4 63.8L40.2 53Q47.8 52.2 55.4 52.6L55.2 41.8Q62.8 41 70.4 41.4L70.2 30.6Q78 29.8 85.8 30.4L86.2 86.4Q48 87.6 10.4 86.2Z",
      fill: "paper",
    },
    {
      d: "M55.3 52.8Q54.9 69.6 55.5 86.6",
      tone: "sub",
      w: 1.6,
      fill: "plum",
      fillD:
        "M10.4 86.2L10.2 75.4Q17.8 74.6 25.4 75L25.2 64.2Q32.8 63.4 40.4 63.8L40.2 53Q47.8 52.2 55.4 52.6L55.5 86.8Q33 87.4 10.4 86.2Z",
    },
    {
      d: "M41.8 52.6Q42 44.6 47.8 44.2Q53.6 44.6 53.8 52.6",
      fill: "paper",
      fillD: "M41.8 52.6Q42 44.6 47.8 44.2Q53.6 44.6 53.8 52.6Z",
    },
    { d: ring(47.8, 37.8, 4.6, 4.6, -2), fill: "paper", fillD: disc(47.8, 37.8, 4.6) },
    { d: "M78.2 30.4Q77.6 20.4 78.2 10.6", w: 2 },
    {
      d: "M78.4 10.8Q83.6 12.8 88.2 13.6Q83.4 16 78.4 19.8",
      tone: "accent",
      w: 2,
      fill: "accent",
      fillD: "M78.4 10.8Q83.6 12.8 88.2 13.6Q83.4 16 78.4 19.8Z",
    },
  ],
};

export default art;
