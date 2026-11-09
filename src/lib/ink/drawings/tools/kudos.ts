import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Kudos Wall: a thank-you card pinned over another on the wall, a big heart on the front. */
const art: InkDrawing = {
  name: "kudos",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 50, rx: 39, ry: 34, seed: 2357, tone: "plum" }],
  strokes: [
    { d: "M12.8 31.6Q33 26.6 53.8 22.8L63.4 70.6Q42.6 74.6 22.4 79.2Z", fill: "plum" },
    { d: "M17.4 46.4Q22 45.2 26.8 44.2M18.8 54.4Q23.4 53.2 28.2 52.2", tone: "sub", w: 1.6 },
    { d: "M33.6 23.6Q57 25 80.6 27.8L76.4 84.2Q53 82.6 29.4 80.2Z", fill: "paper" },
    { d: ring(56.4, 28.4, 3.6, 3.6, -2), w: 2, fill: "paper", fillD: disc(56.4, 28.4, 3.6) },
    {
      d: "M55 48.2C51.4 40.6 41 42 42 50.6Q43 57.8 54.6 67.4Q66.6 58.2 67.8 51C69 42.4 58.6 40.6 55 48.2Z",
      tone: "accent",
      w: 2.4,
      fill: "accent",
    },
    { d: "M83.4 18.4L85.6 13.2M86.2 23.6L89.4 22.4", tone: "accent", w: 1.8 },
  ],
};

export default art;
