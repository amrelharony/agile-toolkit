import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Working Agreement Builder: a team charter scroll with the rules written up and signatures going on, the pen still at the last one. */
const art: InkDrawing = {
  name: "working-agreement",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 48, rx: 38, ry: 36, seed: 2490, tone: "plum" }],
  strokes: [
    { d: "M24.2 19Q48 17.8 71.8 19L72.4 77.4Q48 78.6 24.6 77.4Z", fill: "paper" },
    {
      d: "M20.4 12.6Q48 11.4 75.6 12.6Q80 13 80 17.4Q80 21.8 75.6 22Q48 23 20.6 21.8Q16.2 21.6 16.2 17.2Q16.2 12.8 20.4 12.6Z",
      fill: "paper",
    },
    {
      d: "M20.4 73.6Q48 72.4 75.6 73.6Q80 74 80 78.4Q80 82.8 75.6 83Q48 84 20.6 82.8Q16.2 82.6 16.2 78.2Q16.2 73.8 20.4 73.6Z",
      fill: "paper",
    },
    {
      d: `${ring(20.4, 17.2, 2.4)}${ring(75.8, 17.4, 2.4, 2.4, -2)}${ring(20.4, 78.2, 2.4, 2.4, -2)}${ring(75.8, 78.4, 2.4)}`,
      tone: "sub",
      w: 1.6,
    },
    {
      d: "M31 31.6Q48 30.8 65 31.6M31 39.4Q46 38.6 61 39.4M31 47.2Q44 46.6 57 47.2",
      tone: "sub",
      w: 1.8,
    },
    { d: "M30 62.4Q31.6 54.6 34 60.4Q35.6 64.6 38.2 58.4Q39.6 55.6 42.4 61.6", w: 2 },
    { d: "M47.6 62.2Q50 55 52 61Q53.8 65 56 57.6Q57.4 54.6 60.6 61.4", tone: "accent", w: 2.2 },
    { d: "M64.1 55.2L83.9 35.4Q87.6 35.6 87.6 39.1L67.8 58.9Z", fill: "plum" },
    { d: "M64.1 55.2L61 62L67.8 58.9", w: 2 },
  ],
};

export default art;
