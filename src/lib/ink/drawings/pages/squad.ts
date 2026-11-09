import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const squadArt: InkDrawing = {
  name: "squad",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 58, rx: 42, ry: 28, seed: 281, tone: "accent2" }],
  strokes: [
    {
      d: "M8.6 78.4Q8.6 60.2 22.4 60Q36.4 60.2 36.4 78.4",
      fill: "paper",
      fillD: "M8.6 78Q8.6 60.2 22.4 60Q36.4 60.2 36.4 78Z",
    },
    { d: ring(22.4, 46, 8.2, 8.4, -2.4), fill: "paper", fillD: disc(22.4, 46, 8.2, 8.4) },
    {
      d: "M59.6 78.4Q59.6 60.2 73.6 60Q87.4 60.2 87.4 78.4",
      fill: "paper",
      fillD: "M59.6 78Q59.6 60.2 73.6 60Q87.4 60.2 87.4 78Z",
    },
    { d: ring(73.6, 46, 8.2, 8.4, -2.2), fill: "paper", fillD: disc(73.6, 46, 8.2, 8.4) },
    {
      d: "M29.6 80.4Q29.6 56.2 48 56Q66.4 56.2 66.4 80.4",
      fill: "accent2",
      fillD: "M29.6 80Q29.6 56.2 48 56Q66.4 56.2 66.4 80Z",
    },
    { d: ring(48, 38.4, 10, 10.4, -2.6), fill: "paper", fillD: disc(48, 38.4, 10, 10.4) },
    { d: "M6 82.4Q48 84.4 90 81.6", tone: "sub", w: 1.6 },
    { d: "M40.6 17.4L44 21M48 14L48 19M55.4 17.4L52 21", tone: "accent", w: 1.8 },
  ],
};
