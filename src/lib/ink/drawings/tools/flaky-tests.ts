import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Flaky Test Scoreboard: a snowflake for the flaky test, with the pass and fail it flips between. */
const art: InkDrawing = {
  name: "flaky-tests",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 38, ry: 34, seed: 2469, tone: "info" }],
  strokes: [
    {
      d: "M40 69Q39.1 42 40 15M16.6 55.5Q39.6 41.2 63.4 28.5M16.6 28.5Q40.5 41.2 63.4 55.5",
      w: 2.6,
    },
    {
      d: "M40 57L46 63M40 57L34 63M27 49.5L24.8 57.7M27 49.5L18.8 47.3M27 34.5L18.8 36.7M27 34.5L24.8 26.3M40 27L34 21M40 27L46 21M53 34.5L55.2 26.3M53 34.5L61.2 36.7M53 49.5L61.2 47.3M53 49.5L55.2 57.7",
      w: 2,
    },
    { d: ring(40, 42, 4, 4, -2), fill: "paper", fillD: disc(40, 42, 4), w: 2 },
    { d: ring(55, 79, 8.6, 8.6, -2.4), fill: "paper", fillD: disc(55, 79, 8.6) },
    { d: "M50.6 79.2L53.8 82.4L59.6 75.4", tone: "success", w: 2.4 },
    { d: ring(76, 70, 9.6, 9.6, -2.2), fill: "paper", fillD: disc(76, 70, 9.6) },
    { d: "M71.8 65.8L80.2 74.2M80.2 65.8L71.8 74.2", tone: "danger", w: 2.6 },
  ],
};

export default art;
