import { dot } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Blameless Post-Mortem: a fishbone diagram, contributing causes branching off the spine to the incident at its head. */
const art: InkDrawing = {
  name: "post-mortem",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 48, rx: 40, ry: 32, seed: 2406, tone: "info" }],
  strokes: [
    { d: "M10.6 48.4Q40 47.2 68.6 48.2", w: 2.6 },
    { d: "M14.4 48.2L7.6 38.2M14.4 48.6L7.6 58.4" },
    {
      d: "M31 47.8Q27.4 34.2 22.4 22.4M47.4 47.6Q43.8 34.2 38.8 22M62.2 47.8Q59.2 34.6 54.8 22.6",
    },
    {
      d: "M31 48.8Q27.4 62.2 22.4 74M47.4 48.8Q43.8 62.2 38.8 74.4M62.2 48.6Q59.2 61.8 54.8 73.8",
    },
    {
      d: "M27.2 35.6L18.6 35.8M43.6 35.4L35 35.6M27.2 61.4L18.6 61.2M43.6 61.6L35 61.4",
      tone: "sub",
      w: 1.6,
    },
    {
      d: "M66.4 34.6Q84.6 37.6 88 48Q84.6 58.4 66.4 61.4Q70.8 48 66.4 34.6Z",
      fill: "paper",
    },
    {
      d: dot(77, 44.6),
      w: 3.6,
      fill: "accent",
      fillD: "M66.4 34.6Q84.6 37.6 88 48Q84.6 58.4 66.4 61.4Q70.8 48 66.4 34.6Z",
    },
  ],
};

export default art;
