import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Team Skills Matrix: four Harvey balls filling from a quarter to full, the team's skill levels. */
const art: InkDrawing = {
  name: "skills-matrix",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 48, rx: 40, ry: 36, seed: 2210, tone: "plum" }],
  strokes: [
    { d: ring(30, 30, 14, 14, -2.2), fill: "paper", fillD: disc(30, 30, 14) },
    { d: ring(66, 30, 14, 14, -2), fill: "paper", fillD: disc(66, 30, 14) },
    { d: ring(30, 66, 14, 14, -2.5), fill: "paper", fillD: disc(30, 66, 14) },
    { d: ring(66, 66, 14, 14, -2.1), fill: "accent", fillD: disc(66, 66, 14) },
    {
      d: "M30.2 16.6Q29.8 23 30.2 30L43.4 30.2",
      w: 2,
      fill: "accent",
      fillD: "M30 30L30 16A14 14 0 0 1 44 30Z",
    },
    { d: "M66.2 16.6Q65.6 30 66.2 43.4", w: 2, fill: "accent", fillD: "M66 16A14 14 0 0 1 66 44Z" },
    {
      d: "M30.2 52.6Q29.8 59 30 66L16.6 66.2",
      w: 2,
      fill: "accent",
      fillD: "M30 66L30 52A14 14 0 1 1 16 66Z",
    },
    { d: "M68.9 54.1L54.1 68.9M74.5 57.5L57.5 74.5M77.9 63.1L63.1 77.9", tone: "accent", w: 1.6 },
  ],
};

export default art;
