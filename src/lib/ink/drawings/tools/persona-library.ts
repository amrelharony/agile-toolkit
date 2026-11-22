import { disc, dot, ring, turn } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Persona Library: two overlapping ID cards, the front one with a head and shoulders, text lines and a little speech bubble. */
const art: InkDrawing = {
  name: "persona-library",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 34, seed: 4310, tone: "accent" }],
  strokes: [
    {
      d: turn(
        "M15 16L61 15.6Q64 15.6 64 18.6L64.2 49Q64.2 52 61.2 52L15 52.4Q12 52.4 12 49.4L11.8 19Q11.8 16 15 16Z",
        -6,
        38,
        34
      ),
      fill: "accent",
    },
    {
      d: "M27 34L81 33.6Q84 33.6 84 36.6L84.2 75Q84.2 78 81.2 78L27 78.4Q24 78.4 24 75.4L23.8 37Q23.8 34 27 34Z",
      fill: "paper",
    },
    { d: "M48.4 38.2L59.6 38", w: 2.2 },
    {
      d: "M31 42L47 41.6Q49 41.6 49 43.6L49.2 62Q49.2 64 47.2 64L31 64.4Q29 64.4 29 62.4L28.8 44Q28.8 42 31 42Z",
      fill: "accent",
      w: 1.8,
    },
    { d: ring(39, 49.4, 4.4, 4.4, -2.3), fill: "paper", fillD: disc(39, 49.4, 4.4) },
    { d: "M31.6 63.6Q32 56.6 39 56.4Q46 56.6 46.4 63.6", w: 2 },
    {
      d: "M54 47L76.4 46.6M54 53.4L72 53.2M54 59.8L74.6 59.4M30 71.2L62 70.8",
      tone: "sub",
      w: 1.8,
    },
    {
      d: "M62.4 16.6Q62.4 11.4 68 11.4L80.6 11.2Q86 11.4 86 16.4L86 21.6Q86 26.6 80.6 26.6L72 26.8L66 31.6L67.2 26.6Q62.4 26 62.4 21.4Z",
      fill: "paper",
    },
    { d: `${dot(68.6, 19)}${dot(74.2, 19)}${dot(79.8, 19)}`, w: 2.6 },
  ],
};

export default art;
