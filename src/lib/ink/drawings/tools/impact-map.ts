import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Impact Map: the goal's flag in a circle on the left, branching out to three people, each with a short line to what to build. */
const art: InkDrawing = {
  name: "impact-map",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 49, rx: 40, ry: 36, seed: 4308, tone: "accent" }],
  strokes: [
    { d: "M23.6 41.6Q32 22.4 41 21M26.4 48.6L40.8 49M23.6 54.8Q32 74.6 41 77", w: 2 },
    { d: ring(16, 48, 10, 10, -2.3), fill: "paper", fillD: disc(16, 48, 10) },
    { d: "M13 55L13.2 41.4", w: 2 },
    {
      d: "M13.2 41.8L21.4 44.4L13.2 47.4",
      tone: "accent",
      w: 1.8,
      fill: "accent",
      fillD: "M13.2 41.8L21.4 44.4L13.2 47.4Z",
    },
    { d: ring(49, 16.4, 4.2, 4.2, -2.3), fill: "paper", fillD: disc(49, 16.4, 4.2) },
    { d: ring(49, 44.4, 4.2, 4.2, -2), fill: "paper", fillD: disc(49, 44.4, 4.2) },
    { d: ring(49, 72.4, 4.2, 4.2, -2.6), fill: "paper", fillD: disc(49, 72.4, 4.2) },
    {
      d: "M42.8 27.6Q49 21.4 55.2 27.6M42.8 55.6Q49 49.4 55.2 55.6M42.8 83.6Q49 77.4 55.2 83.6",
      w: 2,
    },
    { d: "M57.2 21L67.4 20.6M57.2 49L67.4 48.6M57.2 77L67.4 76.6", tone: "sub", w: 1.8 },
    {
      d: "M70 14L82 13.6Q84 13.6 84 15.6L84.2 25.4Q84.2 27.4 82.2 27.4L70 27.8Q68 27.8 68 25.8L67.8 16Q67.8 14 70 14Z",
      fill: "paper",
    },
    {
      d: "M70 42L82 41.6Q84 41.6 84 43.6L84.2 53.4Q84.2 55.4 82.2 55.4L70 55.8Q68 55.8 68 53.8L67.8 44Q67.8 42 70 42Z",
      fill: "accent",
    },
    {
      d: "M70 70L82 69.6Q84 69.6 84 71.6L84.2 81.4Q84.2 83.4 82.2 83.4L70 83.8Q68 83.8 68 81.8L67.8 72Q67.8 70 70 70Z",
      fill: "paper",
    },
  ],
};

export default art;
