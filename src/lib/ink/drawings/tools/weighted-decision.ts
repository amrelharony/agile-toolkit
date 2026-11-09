import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Weighted Decision Matrix: a pan balance tipping toward the side holding the heavier kettlebell weight. */
const art: InkDrawing = {
  name: "weighted-decision",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 39, ry: 33, seed: 2784, tone: "warning" }],
  strokes: [
    { d: "M48 25Q47.2 52 48.2 79", w: 2.4 },
    {
      d: "M36 85Q38.4 78.4 48 78.2Q57.6 78.4 60 85",
      fill: "paper",
      fillD: "M36 85Q38.4 78.4 48 78.2Q57.6 78.4 60 85Z",
    },
    { d: "M31.6 85.2Q48 84 64.4 85.4" },
    { d: "M21 30L11 60M21 30L31 60M75 18.6L65 48.6M75 18.6L85 48.6", tone: "sub", w: 1.4 },
    { d: "M17.6 30.8Q48 23.6 78.6 17.8", w: 2.8 },
    { d: ring(48, 24, 3), fill: "paper", fillD: disc(48, 24, 3), w: 2 },
    {
      d: "M8.8 60.2Q21 59.4 33.2 60.4Q32 70.4 21 70.6Q10 70.4 8.8 60.2",
      fill: "paper",
      fillD: "M8.8 60.2Q21 59.4 33.2 60.4Q32 70.4 21 70.6Q10 70.4 8.8 60.2Z",
    },
    {
      d: "M62.8 48.8Q75 48 87.2 49Q86 59 75 59.2Q64 59 62.8 48.8",
      fill: "paper",
      fillD: "M62.8 48.8Q75 48 87.2 49Q86 59 75 59.2Q64 59 62.8 48.8Z",
    },
    {
      d: "M17.2 50.4Q16.2 43.6 21 43.4Q25.8 43.6 24.8 50.4M72.4 41.2Q71.8 36.4 75 36.2Q78.2 36.4 77.6 41.2",
      w: 2,
    },
    { d: ring(21, 54, 6, 6, -2), fill: "accent", fillD: disc(21, 54, 6) },
    { d: ring(75, 44, 4.4, 4.4, -1.2), fill: "paper", fillD: disc(75, 44, 4.4), w: 2 },
  ],
};

export default art;
