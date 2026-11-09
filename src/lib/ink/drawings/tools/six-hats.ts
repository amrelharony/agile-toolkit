import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Six Thinking Hats: a top hat with a bright band and a blue bowler beside it, two of the six hats. */
const art: InkDrawing = {
  name: "six-hats",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 32, seed: 2791, tone: "accent3" }],
  strokes: [
    { d: ring(40, 70, 26, 7, -2.6), fill: "paper", fillD: disc(40, 70, 26, 7) },
    {
      d: "M25.6 70.4Q24.4 48 25 22.8M55 22.8Q55.6 48 54.4 70.4",
      fill: "paper",
      fillD: "M25 22.8L55 22.8L54.4 70.4Q40 74.6 25.6 70.4Z",
    },
    { d: "M25.6 70.4Q40 74.8 54.4 70.4", w: 2 },
    {
      d: "M25.4 56.4Q40 60.6 54.8 56.4L54.6 64Q40 68.2 25.6 64Z",
      tone: "ink",
      fill: "accent",
      w: 1.8,
    },
    { d: ring(40, 22.8, 15, 4.2, -2.6), fill: "paper", fillD: disc(40, 22.8, 15, 4.2) },
    { d: ring(66, 77.4, 21, 5, -2.8), fill: "paper", fillD: disc(66, 77.4, 21, 5) },
    {
      d: "M51.4 77.6Q50.6 54.6 66 54Q81.4 54.6 80.6 77.6",
      fill: "accent2",
      fillD: "M51.4 77.6Q50.6 54.6 66 54Q81.4 54.6 80.6 77.6Q66 80 51.4 77.6Z",
    },
    { d: "M51.6 70.4Q66 73.8 80.4 70.4", w: 2 },
  ],
};

export default art;
