import { dot } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const comicsArt: InkDrawing = {
  name: "comics",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 34, seed: 201, tone: "accent" }],
  strokes: [
    {
      d: "M23.6 50.4Q12 44.6 12.2 34Q13 17.6 38.2 17Q64 17.6 64.2 34.2Q64 52 40.4 53Q34.6 53.2 30.4 52.2L18.4 62.4L23.6 50.4",
      fill: "paper",
    },
    { d: "M26.4 31.4L50.4 30.8M26.4 38.6L44.4 38.2", tone: "sub", w: 1.6 },
    {
      d: "M76.2 72.4Q84.4 67.2 84.2 60Q84 47 62.2 47Q40 47.2 40.2 60.4Q40.4 75.2 62.4 76L80.4 86.4L76.2 72.4",
      fill: "paper",
    },
    { d: `${dot(55, 61.4)}${dot(62.2, 61.4)}${dot(69.4, 61.4)}`, tone: "accent", w: 3.4 },
  ],
};
