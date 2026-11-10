import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Team Mood Tracker: a check-in stand with three mood buttons, sad, so-so and happy, the happy one lit. */
const art: InkDrawing = {
  name: "mood-tracker",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 54, rx: 40, ry: 32, seed: 2350, tone: "plum" }],
  strokes: [
    {
      d: "M13 24.6Q48 23 83.4 24.4Q87.6 24.8 87.6 29L87.2 59.6Q87 63.8 82.8 63.8L13.4 64.2Q9 64 9 59.8L9.4 28.8Q9.6 24.8 13 24.6Z",
      fill: "paper",
    },
    { d: "M48.2 64.2Q47.6 74.6 48.4 84.6", w: 2.8 },
    { d: "M35.6 85.4Q48 84 60.6 85.6", w: 2.2 },
    { d: `${ring(24.6, 44, 10.2)}${ring(48, 44, 10.2, 10.2, -2)}`, w: 2 },
    {
      d: ring(71.4, 44, 10.2, 10.2, -2.6),
      tone: "success",
      w: 2.4,
      fill: "success",
      fillD: disc(71.4, 44, 10.2),
    },
    {
      d: `${dot(21, 41)}${dot(28.2, 41)}${dot(44.4, 41)}${dot(51.6, 41)}${dot(67.8, 41)}${dot(75, 41)}`,
      w: 3.6,
    },
    {
      d: "M20.2 50.6Q24.6 45.8 29 50.6M43.8 49.2Q48 48.6 52.2 49.4M66.6 47.6Q71.4 53.6 76.2 47.6",
      w: 2,
    },
  ],
};

export default art;
