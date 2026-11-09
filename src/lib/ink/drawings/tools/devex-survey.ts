import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** DevEx Survey: a developer in flow behind their laptop, headphones on and smiling. */
const art: InkDrawing = {
  name: "devex-survey",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 38, ry: 34, seed: 2378, tone: "plum" }],
  strokes: [
    {
      d: "M14 85Q15 57 48 56Q81 57 82 85",
      fill: "paper",
      fillD: "M14 85Q15 57 48 56Q81 57 82 85Z",
    },
    { d: ring(48, 39, 12.4, 13, -2.2), fill: "paper", fillD: disc(48, 39, 12.4, 13) },
    { d: `${dot(44, 39.6)}${dot(52, 39.6)}`, w: 3.4 },
    { d: "M44.2 45.2Q48 47.8 51.8 45.2", w: 1.8 },
    { d: "M23.6 59.4Q48 58.2 72.4 59.2L75.4 83.4Q48 84.6 20.6 83.4Z", fill: "paper" },
    { d: ring(48, 71, 3.2), tone: "sub", w: 1.6 },
    { d: "M13.6 84.8Q48 86.4 82.4 84.6", w: 2.4 },
    { d: "M34.4 40Q32.6 21 48 20.6Q63.4 21 61.6 40", tone: "accent", w: 2.8 },
    {
      d: "M31.2 35.4Q36.4 34.6 37 38L37.2 45Q36.8 48.4 31.4 47.6Q29.4 47.2 29.4 43L29.4 39Q29.4 35.6 31.2 35.4ZM64.8 35.4Q59.6 34.6 59 38L58.8 45Q59.2 48.4 64.6 47.6Q66.6 47.2 66.6 43L66.6 39Q66.6 35.6 64.8 35.4Z",
      tone: "accent",
      w: 2.2,
      fill: "accent",
    },
  ],
};

export default art;
