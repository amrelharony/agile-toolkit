import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** DORA Scorecard: one of the "four keys", a big key with a 4 on its bow and a bit stepped in four bands. */
const art: InkDrawing = {
  name: "dora-scorecard",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 48, rx: 38, ry: 34, seed: 2364, tone: "success" }],
  strokes: [
    {
      d: "M41 37.5Q60.5 51.4 78.8 67L79 72.3L73.9 73.3L71 77.4L66.1 73.6L64.1 76.1L59.5 72.2L57.6 74.8L52.9 70.9L51 73.4L46.4 69.6L55.2 58.7Q45.2 51.6 36.1 43.8",
      fill: "paper",
      fillD:
        "M41 37.5Q60.5 51.4 78.8 67L79 72.3L73.9 73.3L71 77.4L66.1 73.6L64.1 76.1L59.5 72.2L57.6 74.8L52.9 70.9L51 73.4L46.4 69.6L55.2 58.7Q45.2 51.6 36.1 43.8Z",
    },
    { d: ring(29.1, 33.2, 15, 15, -0.6), fill: "paper", fillD: disc(29.1, 33.2, 15) },
    { d: ring(14.6, 18.8, 6.4, 6.4, 0.8), tone: "sub", w: 2 },
    { d: "M31.4 26L23.4 37.4L35 37.2M31.4 26.4L31.6 41.4", tone: "accent", w: 2.8 },
  ],
};

export default art;
