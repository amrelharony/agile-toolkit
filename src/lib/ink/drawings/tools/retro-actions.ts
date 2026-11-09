import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Retro Actions: a clipboard of agreed actions, two ticked off, one still open. */
const art: InkDrawing = {
  name: "retro-actions",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 36, ry: 36, seed: 2147, tone: "accent3" }],
  strokes: [
    { d: "M21 17.4Q48 15.8 75.4 17L75 85.4Q48 86.6 20.6 85.2Z", fill: "paper" },
    {
      d: "M36.6 22.6L37.4 14.6Q38 12.2 41 12.2L55 12.2Q58 12.2 58.6 14.6L59.4 22.6Z",
      fill: "accent3",
    },
    { d: ring(48, 9.6, 2.6, 2.4, -2), w: 2 },
    {
      d: "M28.4 32.4L37.4 32.2L37.6 41.2L28.6 41.4ZM28.6 49.4L37.6 49.2L37.8 58.2L28.8 58.4ZM28.6 66.4L37.6 66.2L37.8 75.2L28.8 75.4Z",
      w: 2,
    },
    { d: "M43 37L67 36.6M43 54L64 53.8M43 71L66 70.8", tone: "sub", w: 1.8 },
    { d: "M29.4 35.6L32.6 39.6L40.6 29.6M29.6 52.6L32.8 56.6L40.8 46.6", tone: "success", w: 2.8 },
  ],
};

export default art;
