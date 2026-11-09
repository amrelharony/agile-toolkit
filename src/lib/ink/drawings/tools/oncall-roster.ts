import { dot } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** On-Call Roster & Burnout: a phone handset ringing under a crescent moon, the page that comes at night. */
const art: InkDrawing = {
  name: "oncall-roster",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 38, ry: 34, seed: 2413, tone: "info" }],
  strokes: [
    {
      d: "M17.5 41.7Q22.4 73.6 54.3 78.5L62 71.3Q59.2 63.7 52 61L46.9 64.6Q33.1 62.9 31.4 49.1L35 44Q32.3 36.8 24.7 34Z",
      fill: "paper",
    },
    { d: "M23.2 54.6Q27 64 36.4 69", tone: "sub", w: 1.6 },
    {
      d: "M77.6 10.6Q63 12.6 64.2 22.4Q65.8 31.2 78.4 29.6Q70.8 26.6 70.6 20.4Q70.6 14 77.6 10.6Z",
      fill: "paper",
    },
    {
      d: `${dot(86, 36)}${dot(56, 12.4)}`,
      tone: "sub",
      w: 3,
      fill: "wood",
      fillD:
        "M77.6 10.6Q63 12.6 64.2 22.4Q65.8 31.2 78.4 29.6Q70.8 26.6 70.6 20.4Q70.6 14 77.6 10.6Z",
    },
    {
      d: "M47.5 35.3A22 22 0 0 1 60.7 48.5M50.3 27.8A30 30 0 0 1 68.2 45.7",
      tone: "accent",
      w: 2.4,
    },
  ],
};

export default art;
