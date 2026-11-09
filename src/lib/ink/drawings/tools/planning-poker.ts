import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Planning Poker: a fanned hand of three estimate cards, the front one showing a 5. */
const art: InkDrawing = {
  name: "planning-poker",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 54, rx: 40, ry: 32, seed: 2035, tone: "accent2" }],
  strokes: [
    {
      d: "M43.5 74.8L30.6 80.4L11.7 38.6L35.6 27.8",
      fill: "paper",
      fillD: "M11.7 38.6L35.4 27.9L54.2 69.8L30.6 80.4Z",
    },
    { d: ring(18.7, 42, 2.4), tone: "sub", w: 1.6 },
    {
      d: "M60.4 27.7L84.2 38.6L65.6 80.6L52.4 74.8",
      fill: "accent2",
      fillD: "M60.6 27.8L84.2 38.6L65.6 80.6L41.8 69.8Z",
    },
    { d: ring(77.3, 42, 2.4), tone: "sub", w: 1.6 },
    { d: "M35.2 28.2L61 27.8L61.4 74.2L35 74.6Z", fill: "paper" },
    {
      d: "M55 37.6L43.4 37.8L42.2 49.4Q46 46.6 50 47Q56.6 48 56.4 55.6Q56 63.8 48.4 64Q43.4 64 40.8 60.4",
      tone: "accent",
      w: 3,
    },
  ],
};

export default art;
