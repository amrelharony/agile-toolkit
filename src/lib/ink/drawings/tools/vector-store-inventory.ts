import { dot } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Vector Store Inventory: three lidded jars of embedding dots on a shelf, each collection a different size. */
const art: InkDrawing = {
  name: "vector-store-inventory",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 32, seed: 2679, tone: "accent2" }],
  strokes: [
    {
      d: "M15.2 69.6Q14.4 56 15 46.4Q15.4 43 18.6 43L28.4 42.8Q31.6 43 31.8 46.2Q32.4 56 31.6 69.6Z",
      fill: "paper",
    },
    { d: "M16.6 43L16.4 37.4L30.2 37.2L30.4 43Z", fill: "paper" },
    {
      d: "M38.6 69.6Q37.6 48 38.2 31.2Q38.6 27.6 42 27.6L54.4 27.4Q57.8 27.6 58 31Q58.6 48 57.8 69.6Z",
      fill: "paper",
    },
    { d: "M40 27.6L39.8 21.4L56.4 21.2L56.6 27.4Z", fill: "paper" },
    {
      d: "M64.6 69.6Q63.8 54 64.4 40.4Q64.8 36.8 68 36.8L78.6 36.6Q81.8 36.8 82 40.2Q82.6 54 81.8 69.6Z",
      fill: "paper",
    },
    { d: "M66 36.8L65.8 31L80.6 30.8L80.8 36.6Z", fill: "paper" },
    { d: "M8.4 70Q48 68.8 87.6 70", w: 2.6 },
    {
      d: "M10.6 75.2Q48 74.2 85.4 75.2M20.4 75.4L20.6 82.4L26.6 75.4M75.6 75.4L75.4 82.4L69.4 75.4",
      tone: "sub",
      w: 1.6,
    },
    {
      d: `${dot(20.4, 52)}${dot(26.6, 56.4)}${dot(21.2, 62.6)}${dot(43.6, 36)}${dot(51.8, 39)}${dot(45.6, 47)}${dot(53, 51.6)}${dot(43.4, 58)}${dot(50.6, 62.4)}${dot(69.6, 46.4)}${dot(76.6, 50)}${dot(70.4, 58.4)}${dot(77, 62)}`,
      tone: "accent",
      w: 4.2,
    },
  ],
};

export default art;
