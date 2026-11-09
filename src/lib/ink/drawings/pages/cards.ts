import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const cardsArt: InkDrawing = {
  name: "cards",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 34, seed: 311, tone: "accent2" }],
  strokes: [
    { d: "M14.2 30.6L44.4 22.4L54.6 62.4L24.6 70.6Z", fill: "paper" },
    { d: "M24.4 36.6L40.4 32.4M26.4 44.2L38.4 41", tone: "sub", w: 1.6 },
    { d: "M42.4 26.4L72.6 20.4L80.4 62.6L50.4 68.4Z", fill: "accent2" },
    { d: "M52.6 32.6L68.6 29.6M54.4 40.6L66.4 38.4", tone: "sub", w: 1.6 },
    { d: "M60.4 50.2L64 54.4L71.4 45.4", tone: "success", w: 2.6 },
    { d: "M30.4 82.6Q48 79.4 66.4 82.4", tone: "accent", w: 2 },
  ],
};
