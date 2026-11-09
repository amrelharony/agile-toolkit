import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const runArt: InkDrawing = {
  name: "run",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 42, cy: 62, rx: 34, ry: 26, seed: 21, tone: "accent" }],
  strokes: [
    {
      d: "M20.5 46Q41 49.5 61.5 45.6",
      fill: "accent",
      fillD: "M21 46.5Q41 49.5 61 46L57 80Q56 84 51 84L32 84Q27 84 26 80Z",
    },
    { d: "M21 46.4L25.6 80Q26.6 84.4 32 84.4L50.6 84.2Q55.6 84 56.6 79.6L61.2 45.4" },
    { d: "M60 53Q71.6 52 70 62.4Q68.4 70.6 57.6 70.4" },
    { d: "M32.4 38Q28 31.6 33 26.2Q37.6 21 33.2 14.6", tone: "sub", w: 1.6 },
    { d: "M44.2 38Q39.8 31.6 44.8 26.2Q49.4 21 45 14.6", tone: "sub", w: 1.6 },
    { d: ring(72, 26, 13, 13, -2.6, 0.5), fill: "paper", fillD: disc(72, 26, 13) },
    { d: "M72 26.2L72 17.4", w: 2.4 },
    { d: "M72.2 26L78.4 29.4", tone: "accent", w: 2.4 },
    { d: "M72 14.6L72 16.2M83.6 26L82 26M72 37.4L72 35.8M60.4 26L62 26", tone: "sub", w: 1.6 },
  ],
};
