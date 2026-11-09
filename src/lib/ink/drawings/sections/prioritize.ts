import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const prioritizeArt: InkDrawing = {
  name: "prioritize",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 46, cy: 50, rx: 37, ry: 36, seed: 61, tone: "warning" }],
  strokes: [
    { d: "M17.6 17.8L66.4 16.8L67 39.4L18.2 40.2Z", fill: "warning" },
    { d: "M24.2 27.4L27.4 24.6L27.4 36", w: 2.4 },
    { d: "M34.4 25.2L58.4 24.6M34.4 31.4L52 31", tone: "sub", w: 1.6 },
    { d: "M21.6 46.2L62.2 45.6L62.6 63.2L22.2 63.6Z", fill: "paper" },
    { d: "M27.4 50.4Q30.8 47.6 33 50.4Q34.2 53.4 27.8 58.6L34.2 58.4", w: 2.2 },
    { d: "M39.6 52.2L56.4 52M39.6 57.8L52 57.6", tone: "sub", w: 1.6 },
    { d: "M26 70L58 69.4L58.4 84L26.4 84.6Z", fill: "paper" },
    { d: "M31.6 76.6L52 76.2", tone: "sub", w: 1.6 },
    { d: "M80 81.4L80.4 22", tone: "accent", w: 2.6 },
    { d: "M73.6 29.4L80.4 21.4L86.8 29.6", tone: "accent", w: 2.6 },
  ],
};
