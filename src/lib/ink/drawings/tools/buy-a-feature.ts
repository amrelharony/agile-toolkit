import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Buy-a-Feature Game: a shopping cart carrying a feature card, a price tag hanging off the card. */
const art: InkDrawing = {
  name: "buy-a-feature",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 47, cy: 50, rx: 39, ry: 33, seed: 2742, tone: "warning" }],
  strokes: [
    { d: "M36.2 15.6Q47.6 14 59.2 12.8L62.4 44L39.4 46.4Z", fill: "paper" },
    { d: "M40.8 22.6L54.4 21M41.6 29L52.6 27.6", tone: "sub", w: 1.6 },
    { d: "M21.6 33.6Q53 32.4 84.6 33.8L76.4 62.4Q53 63.4 29.8 62.2Z", fill: "paper" },
    { d: "M45 34.4L46.8 62.4M61.6 34.2L60.4 62.6M25.6 48Q53 48.8 80.6 48", tone: "sub", w: 1.6 },
    { d: "M8.4 22.8Q12.8 21.8 16.8 23.4L21.8 34" },
    { d: "M30 62.4L27.6 70.4Q53 71.4 80 69.8" },
    { d: `${ring(34, 77.2, 4.4)}${ring(72, 77.2, 4.4, 4.4, -1.6)}`, w: 2.4 },
    { d: "M64.4 14L71.7 12.4L83.9 21L77.6 30L65.3 21.4Z", tone: "accent", fill: "accent" },
    { d: ring(69.3, 17.4, 1.6), tone: "accent", w: 1.6 },
    { d: "M58.8 13.4Q64.6 10.6 68.8 16.4", tone: "sub", w: 1.4 },
  ],
};

export default art;
