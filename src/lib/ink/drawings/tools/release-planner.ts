import { dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Release Planner: a calendar with the ship date circled, and a die for the Monte Carlo odds. */
const art: InkDrawing = {
  name: "release-planner",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 34, seed: 2084, tone: "accent2" }],
  strokes: [
    {
      d: "M53 77.6L13 78L12.6 25.4L62 24.6L62.4 53.6",
      fill: "paper",
      fillD: "M12.6 25.4L62 24.6L62.6 77.4L13 78Z",
    },
    { d: "M12.8 25.4L62 24.6L62.2 36.4L12.8 36.8Z", fill: "accent2" },
    { d: "M24 19.4L24 30.4M50 19L50 30", w: 2.6 },
    {
      d: "M13.6 50.4Q37 49.8 61.6 50.2M13.8 64Q33 63.6 52.6 63.8M29.4 37L29.8 77.6M45.6 36.8L45.4 77.4",
      tone: "sub",
      w: 1.4,
    },
    { d: ring(37.6, 57, 6.6, 6, -2.2, 0.8), tone: "accent", w: 2.4 },
    { d: "M52.6 61.4L74.4 61L74.8 83.2L53 83.6Z", fill: "paper" },
    {
      d: "M52.6 61.4L60.8 53.4L82.6 53L74.4 61",
      fill: "paper",
      fillD: "M52.6 61.4L60.8 53.4L82.6 53L74.4 61Z",
    },
    {
      d: "M74.4 61L82.6 53L83 74.8L74.8 83.2",
      fill: "accent2",
      fillD: "M74.4 61L82.6 53L83 74.8L74.8 83.2Z",
    },
    { d: `${dot(58, 67)}${dot(63.7, 72.3)}${dot(69.4, 77.6)}`, w: 4 },
    { d: `${dot(67.6, 57.2)}${dot(77.3, 63.6)}${dot(80.2, 72.4)}`, w: 3.4 },
  ],
};

export default art;
