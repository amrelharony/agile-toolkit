import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Runbook Maturity Scorer: a ring-bound runbook with a play mark on its cover, rated two stars out of three. */
const art: InkDrawing = {
  name: "runbook-scorer",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 48, rx: 36, ry: 36, seed: 2427, tone: "info" }],
  strokes: [
    {
      d: "M24.6 12.6Q50 11.6 72.4 12.4Q72.9 48 72 83.6Q50 84.6 24.2 83.4Q23.4 48 24.6 12.6Z",
      fill: "paper",
    },
    { d: "M72.2 22L77.6 22.4L77.8 32.6L72.2 32.8M72.2 40L77.6 40.2L77.8 50.4L72.2 50.6", w: 2 },
    { d: "M31.2 13Q30.6 48 31 83.4", tone: "sub", w: 1.6 },
    { d: `${ring(25, 26, 4.4, 2.6)}${ring(25, 48, 4.4, 2.6)}${ring(25, 70, 4.4, 2.6)}`, w: 2 },
    { d: ring(51.6, 34.6, 11, 11, -2.2), w: 2.2 },
    { d: "M38.6 51Q51.6 50.4 64.6 51", tone: "sub", w: 1.6 },
    {
      d: "M39.4 59L40.9 62.9L45.1 63.1L41.9 65.8L42.9 69.9L39.4 67.6L35.9 69.9L36.9 65.8L33.7 63.1L37.9 62.9ZM51.6 59L53.1 62.9L57.3 63.1L54.1 65.8L55.1 69.9L51.6 67.6L48.1 69.9L49.1 65.8L45.9 63.1L50.1 62.9Z",
      tone: "wood",
      fill: "wood",
      w: 1.8,
    },
    {
      d: "M63.8 59L65.3 62.9L69.5 63.1L66.3 65.8L67.3 69.9L63.8 67.6L60.3 69.9L61.3 65.8L58.1 63.1L62.3 62.9Z",
      tone: "sub",
      w: 1.6,
    },
    { d: "M47.8 29L57.6 34.6L47.8 40.2Z", tone: "accent", fill: "accent", w: 2.2 },
  ],
};

export default art;
