import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const teamArt: InkDrawing = {
  name: "team",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 56, rx: 39, ry: 30, seed: 51, tone: "plum" }],
  strokes: [
    {
      d: "M51.6 60.4Q55 53 64.6 52.6Q82.6 53 82.6 78.4",
      fill: "paper",
      fillD: "M50 61Q55 53 64.6 52.6Q82.6 53 82.6 78L50 78Z",
    },
    { d: ring(64.4, 34.6, 10.4, 10.8, -2.5), fill: "paper", fillD: disc(64.4, 34.6, 10.4, 10.8) },
    {
      d: "M14 78.6Q14 56.6 32.2 56.2Q50.2 56.6 50.4 78.6",
      fill: "paper",
      fillD: "M14 78Q14 56.6 32.2 56.2Q50.2 56.6 50.4 78Z",
    },
    { d: ring(32.2, 38.4, 10.2, 10.6, -2.2), fill: "paper", fillD: disc(32.2, 38.4, 10.2, 10.6) },
    { d: "M9.6 80.4Q48 82.4 86.4 79.6", tone: "sub", w: 1.6 },
    {
      d: "M48 22.4C44.4 15.2 35.6 17.6 39.6 25.4L48 32.6L56.4 25.4C60.4 17.6 51.6 15.2 48 22.4",
      tone: "plum",
      fill: "plum",
      w: 2.4,
    },
  ],
};
