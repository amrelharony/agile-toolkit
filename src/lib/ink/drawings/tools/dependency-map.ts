import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Dependency Map: work items linked by arrows, the longest blocking chain inked in rust. */
const art: InkDrawing = {
  name: "dependency-map",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 49, rx: 40, ry: 34, seed: 2308, tone: "accent2" }],
  strokes: [
    { d: "M73.6 26.9Q64 33 53.4 42.4M58.9 42.2L53.4 42.4L55 37.1", tone: "sub", w: 1.8 },
    { d: "M21.8 70.5Q31.6 63.6 39.4 54.1M38.3 59.5L39.4 54.1L33.9 54.9", tone: "sub", w: 1.8 },
    { d: ring(18, 24, 7.4, 7), fill: "accent2", fillD: disc(18, 24, 7.4, 7) },
    { d: ring(46, 48, 7.4, 7, -2), fill: "accent2", fillD: disc(46, 48, 7.4, 7) },
    { d: ring(76, 74, 7.4, 7, -2.6), fill: "accent2", fillD: disc(76, 74, 7.4, 7) },
    { d: ring(80, 22, 6.8, 6.4, -2.2), fill: "paper", fillD: disc(80, 22, 6.8, 6.4) },
    { d: ring(16, 76, 6.8, 6.4, -2), fill: "paper", fillD: disc(16, 76, 6.8, 6.4) },
    { d: "M24.1 29.2Q30.4 36.6 39.2 42.2M33.7 41.7L39.2 42.2L37.9 36.9", tone: "accent", w: 2.8 },
    { d: "M52 53.2Q59.4 61.6 69.2 68.1M63.7 67.5L69.2 68.1L67.9 62.7", tone: "accent", w: 2.8 },
  ],
};

export default art;
