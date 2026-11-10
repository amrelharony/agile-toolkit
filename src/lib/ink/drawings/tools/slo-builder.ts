import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** SLO & Error Budget Builder: a notched candle clock burning down its budget towards a red dashed floor line. */
const art: InkDrawing = {
  name: "slo-builder",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 36, ry: 34, seed: 2385, tone: "info" }],
  strokes: [
    {
      d: "M34.4 76.6Q33.8 56 34.6 36M57.6 36Q58.4 56 57.8 76.6",
      fill: "paper",
      fillD: "M34.4 76.6L34.6 36Q46 42.4 57.6 36L57.8 76.6Z",
    },
    { d: ring(46, 36, 11.6, 3.2, -2.6), fill: "paper", fillD: disc(46, 36, 11.6, 3.2) },
    { d: "M38.4 38.6Q37.6 45 39 48.4Q40.6 50.4 40.8 45.6L41 39.4", w: 1.8 },
    { d: "M50.4 46.6L56.8 46.6M50.4 54.6L56.8 54.6M50.4 70.6L56.8 70.6", tone: "sub", w: 1.6 },
    {
      d: "M27.6 62.6L31.8 62.6M36 62.4L40.2 62.4M44.2 62.6L48.4 62.6M52.4 62.4L56.6 62.4M60.6 62.6L64.8 62.6",
      tone: "danger",
      w: 2.4,
    },
    { d: "M17.8 77Q46 71.6 74.2 77Q72.6 85.4 46 85.6Q19.4 85.4 17.8 77Z", fill: "paper" },
    { d: "M25 77.6Q46 74.8 67 77.6", tone: "sub", w: 1.6 },
    { d: ring(79.6, 79.4, 4.8, 4.2, -3), w: 2.2 },
    {
      d: "M46.6 29.6Q39.6 24.4 45 13.4Q47 18 50.2 20.6Q53.4 26 46.6 29.6Z",
      tone: "accent",
      fill: "paper",
      w: 2.2,
    },
    {
      d: "M46 35.6Q45.4 32 46.6 27.4",
      w: 1.8,
      fill: "accent",
      fillD: "M46.6 29.6Q39.6 24.4 45 13.4Q47 18 50.2 20.6Q53.4 26 46.6 29.6Z",
    },
  ],
};

export default art;
