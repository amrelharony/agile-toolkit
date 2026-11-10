import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Compliance Control Map: a compliance certificate with a ribboned seal, its evidence paper-clipped on. */
const art: InkDrawing = {
  name: "control-map",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 46, cy: 50, rx: 40, ry: 32, seed: 2448, tone: "info" }],
  strokes: [
    {
      d: "M12.4 19.6Q46 18.4 80.6 19.8Q81.2 45 80.2 70.8Q46 72 12 70.6Q11.4 45 12.4 19.6Z",
      fill: "paper",
    },
    {
      d: "M18.2 25.4Q46 24.8 74.6 25.6Q75 45 74.4 65.2Q46 65.8 18 65Q17.6 45 18.2 25.4",
      tone: "sub",
      w: 1.4,
    },
    { d: "M30 34.4Q46 33.6 62 34.4", w: 2.4 },
    { d: "M24.6 43Q46 42.4 67.6 43M24.6 50.6Q38 50.2 50.4 50.6", tone: "sub", w: 1.6 },
    {
      d: "M59.4 68.6L54.8 84L59.6 81.4L63.2 85.6L66.4 71.4M66.4 71.4L70.6 85.6L73.8 81L78.8 83.4L73.4 68.4",
      fill: "accent",
      fillD:
        "M59.4 68.6L54.8 84L59.6 81.4L63.2 85.6L66.4 71.4ZM66.4 71.4L70.6 85.6L73.8 81L78.8 83.4L73.4 68.4Z",
      w: 2,
    },
    { d: ring(66, 62, 10.6, 10.6, -2.4), fill: "accent", fillD: disc(66, 62, 10.6) },
    { d: "M60.8 62L64.6 66L71.6 57.8", w: 2.4 },
    {
      d: "M25 30.4L24.8 13.4Q24.8 9.6 28.4 9.6Q32 9.6 32 13.4L32.2 34.6Q32.2 38.6 28 38.6Q24 38.6 24 34.6L24 26",
      tone: "sub",
      w: 2,
    },
  ],
};

export default art;
