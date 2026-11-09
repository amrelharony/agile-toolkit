import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** AI Red-Team Session Log: a padlock under attack, a pick and tension wrench working its keyhole. */
const art: InkDrawing = {
  name: "ai-red-team",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 52, rx: 38, ry: 34, seed: 2658, tone: "accent2" }],
  strokes: [
    { d: "M32.6 44L32.6 30.6Q32.4 16 46.2 16Q60 16 59.8 30.6L59.8 44", w: 3 },
    {
      d: "M28.6 42.4Q46 41.6 63.4 42.2Q68.4 42.4 68.4 47.4L68.2 77Q68 82.2 63 82.2L29 82.4Q24 82.2 24 77.2L24.2 47.4Q24.2 42.6 28.6 42.4Z",
      fill: "paper",
    },
    { d: ring(46, 56.4, 4.6), w: 2.2 },
    { d: "M43.6 60.6L42.4 70.4L49.6 70.4L48.4 60.6", w: 2 },
    { d: "M44 57.4L46.4 54.6Q48.4 55.6 49 57.6Q66 62.6 86.4 66.4", tone: "danger", w: 2.2 },
    { d: "M46 64.6L46.2 69.8Q62 74.2 84.6 78.4", tone: "danger", w: 2.2 },
    { d: "M76.4 63.6L86.6 65.6M75 75.8L85 77.8", tone: "danger", w: 4 },
    { d: "M66.4 22.6L71.4 18.6M68.4 30.6L74.4 29.6M16.6 26L21 29.8", tone: "sub", w: 1.6 },
  ],
};

export default art;
