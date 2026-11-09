import { dot } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** MoSCoW Matrix: a bucket holding the scope cards that made it in, one card left outside and crossed out. */
const art: InkDrawing = {
  name: "moscow",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 46, cy: 50, rx: 40, ry: 34, seed: 2707, tone: "warning" }],
  strokes: [
    { d: "M16.6 42.8Q40 37.4 63.4 42.6", w: 2 },
    { d: "M17.2 43.2Q15.6 11.4 40 10.8Q64.4 11.4 62.8 43", tone: "sub", w: 1.8 },
    { d: "M24.6 46.4L21.2 26.6L34.4 24L37.8 43.8Z", fill: "paper" },
    { d: "M44 43.2L46.8 22.6L59.2 24.6L56.4 45.2Z", fill: "paper" },
    { d: "M33.6 46.4L33.2 17.6L47.2 17.2L47.6 46.2Z", fill: "warning" },
    { d: "M36.6 24.4L44 24.2M36.6 29.4L42 29.2", tone: "sub", w: 1.6 },
    {
      d: "M16.4 42.8Q40 47.8 63.6 42.6Q60.8 62.6 58.6 82.4Q40 84.6 21.4 82.6Q19.4 62.6 16.4 42.8Z",
      fill: "paper",
    },
    { d: "M18.6 57.2Q40 61.4 61.6 57M20.2 70.6Q40 74.4 60.2 70.4", tone: "sub", w: 1.6 },
    { d: `${dot(17.6, 44.4)}${dot(62.4, 44.2)}`, w: 3.6 },
    { d: "M10 84.6Q48 85.8 88.4 84.2", tone: "sub", w: 1.6 },
    { d: "M62.6 66.2L79.6 62.4L83.2 79.8L66.2 83.6Z", fill: "paper" },
    { d: "M68.6 69.2L77.4 77.2M77 68.6L69 77.8", tone: "accent", w: 2.6 },
  ],
};

export default art;
