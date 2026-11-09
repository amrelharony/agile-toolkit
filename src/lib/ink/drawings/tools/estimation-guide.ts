import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Estimation Reference Guide: three pinned reference cards of growing size above a ruler. */
const art: InkDrawing = {
  name: "estimation-guide",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 32, seed: 2070, tone: "accent2" }],
  strokes: [
    { d: "M12.9 51.2L28.4 49.6L29.9 63.8L14.4 65.4Z", fill: "paper" },
    { d: "M35.9 37.7L55.5 38.7L54.1 64.9L34.5 63.9Z", fill: "paper" },
    { d: "M39.9 46.2L50.8 46.8M39.5 52.2L46.9 52.6", tone: "sub", w: 1.6 },
    { d: "M60.3 24.7L84.3 23.7L86.1 63.7L62.1 64.7Z", fill: "paper" },
    { d: "M65.3 33.7L79.5 33.1M65.6 40.1L75.8 39.7M65.9 46.5L78.1 46", tone: "sub", w: 1.6 },
    { d: "M8.6 70.4L87.6 68.6L88 81.2L9 83Z", fill: "warning" },
    {
      d: "M16 70.2L16 76.4M24 70L24 73.6M32 69.9L32 76M40 69.7L40 73.2M48 69.5L48 75.6M56 69.3L56 72.8M64 69.1L64 75.2M72 69L72 72.4M80 68.8L80 75",
      tone: "sub",
      w: 1.6,
    },
    {
      d: `${ring(20.8, 53, 1.8)}${ring(45.5, 42, 1.8)}${ring(72.5, 28.2, 1.8)}`,
      tone: "accent",
      w: 3.4,
      fill: "accent",
      fillD: `${disc(20.8, 53, 1.8)}${disc(45.5, 42, 1.8)}${disc(72.5, 28.2, 1.8)}`,
    },
  ],
};

export default art;
