import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Definition of Done Builder: a rubber stamp lifting off a story card it has just stamped with a green tick. */
const art: InkDrawing = {
  name: "dod-builder",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 52, rx: 38, ry: 36, seed: 2294, tone: "plum" }],
  strokes: [
    { d: "M34.4 46.6Q59 45 83.4 47L82.6 88Q58 89.4 33.6 87.6Z", fill: "paper" },
    { d: ring(58.6, 67.4, 16.4, 15, -2.4), tone: "success", w: 2.4 },
    { d: "M49.6 67.6L56 74.4L68.4 60", tone: "success", w: 3.2 },
    { d: "M17.6 38.2Q31 37.2 44.4 38L44.8 50.4Q31 51.2 17.2 50.6Z", fill: "paper" },
    { d: "M19.6 50.8L42.6 50.6L42.8 55.6L19.4 55.8Z", fill: "success" },
    { d: "M27.8 37.6Q27.2 30 28.4 23.4M34.2 37.6Q34.8 30 33.6 23.4", w: 2 },
    { d: ring(31, 16.4, 8, 7.2, -2), fill: "paper", fillD: disc(31, 16.4, 8, 7.2) },
  ],
};

export default art;
