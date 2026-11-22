import { disc, ring, turn } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Product Canvas: an easel holding a sheet ruled into boxes, a sticky note on one box and a small lightbulb in another. */
const art: InkDrawing = {
  name: "product-canvas",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 36, seed: 4307, tone: "accent" }],
  strokes: [
    { d: "M30.4 64L18.4 90.4M65.6 64L77.6 90.4M48 64L48.4 88.6", tone: "wood", w: 2.6 },
    { d: "M48 7.4L48.2 14", tone: "wood", w: 2.6 },
    {
      d: "M16.6 14L79.4 13.6Q82 13.6 82 16.2L82.2 63.4Q82.2 66 79.6 66L16.6 66.4Q14 66.4 14 63.8L13.8 16.6Q13.8 14 16.6 14Z",
      fill: "paper",
    },
    { d: "M10.4 67.2L85.8 66.6", tone: "wood", w: 3.2 },
    { d: "M36.2 14.4L36 46M60 14.2L60.2 46M14.4 46.2L81.8 45.8M48.2 46L48 66", w: 1.8 },
    {
      d: "M18.4 22L31.4 21.8M18.4 27.4L28.6 27.2M64.4 22L77.6 21.8M64.4 27.4L74.8 27.2M18.4 53L42.4 52.6M18.4 58.4L37 58.2",
      tone: "sub",
      w: 1.4,
    },
    {
      d: turn(
        "M41.6 20L54.4 19.6Q56 19.6 56 21.2L56.2 34.4Q56.2 36 54.6 36L41.6 36.4Q40 36.4 40 34.8L39.8 21.6Q39.8 20 41.6 20Z",
        -6,
        48,
        28
      ),
      fill: "warning",
      w: 1.8,
    },
    { d: turn("M43.4 25.8L52.4 25.4M43.4 30.4L50 30.2", -6, 48, 28), tone: "sub", w: 1.4 },
    {
      d: ring(65, 55.4, 4.6, 4.6, -2.3),
      tone: "warning",
      fill: "warning",
      fillD: disc(65, 55.4, 4.6),
    },
    { d: "M62.6 61.2L67.4 61M63.2 63.6L66.8 63.4", w: 1.8 },
    { d: "M65 47.8L65 49.6M58.2 50.6L59.6 51.6M71.8 50.6L70.4 51.6", tone: "warning", w: 1.6 },
  ],
};

export default art;
