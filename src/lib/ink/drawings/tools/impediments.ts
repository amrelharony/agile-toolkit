import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Impediment Tracker: a striped road barrier across the way, its warning lamp lit. */
const art: InkDrawing = {
  name: "impediments",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 54, rx: 40, ry: 30, seed: 2217, tone: "accent" }],
  strokes: [
    { d: "M27 42L18.4 84.4M27 42L35.4 84.4M69 42L60.6 84.4M69 42L77.6 84.4" },
    { d: "M12.4 34.8Q48 33.2 83.8 34.4L83.4 53Q48 54.4 12 53.2Z", fill: "paper" },
    {
      d: "M25 34.6L34 34.2L26 53.2L17 53.3ZM46 33.9L55 33.8L47 53.6L38 53.6ZM67 34L76 34.3L68 53.3L59 53.5Z",
      tone: "danger",
      fill: "danger",
      w: 1.4,
    },
    { d: "M27 34.6L27 28.4", w: 2 },
    { d: ring(27, 24, 4.4, 4.4, -2.2), fill: "warning", fillD: disc(27, 24, 4.4) },
    { d: "M19.2 18.2L21.8 20.8M27 13.2L27 16.4M34.8 18.2L32.2 20.8", tone: "warning", w: 1.8 },
    { d: "M8 85Q48 86.6 88 84.6", tone: "sub", w: 1.6 },
  ],
};

export default art;
