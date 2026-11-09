import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Sprint Cockpit: a pocket compass on its loop, the needle pointing the sprint's way. */
const art: InkDrawing = {
  name: "sprint",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 50, rx: 38, ry: 32, seed: 2322, tone: "accent" }],
  strokes: [
    { d: "M43.6 20.2Q48 12.8 52.6 20.4", w: 2.4 },
    { d: ring(48, 51, 30.4, 30, -2.4), fill: "paper", fillD: ring(48, 51, 30.4, 30, 0, 0) },
    { d: ring(48, 51, 24.4, 24, -1.9), tone: "sub", w: 1.4 },
    { d: "M48 21.4L48.2 27M48 75L48.2 80.6M18 51L23.6 51.2M72.4 51L78 50.8", w: 2 },
    {
      d: "M26.6 29.8L29.6 32.8M66.6 69.4L69.6 72.4M69.6 29.6L66.6 32.6M29.6 69.4L26.6 72.4",
      tone: "sub",
      w: 1.4,
    },
    { d: "M56.2 29.6L52.2 52.6L43.8 49.4Z", tone: "accent", fill: "accent", w: 2 },
    { d: "M40 72.4L43.8 49.4L52.2 52.6Z", fill: "paper", w: 2 },
    { d: ring(48, 51, 1.8, 1.8, -2), w: 2.2 },
  ],
};

export default art;
