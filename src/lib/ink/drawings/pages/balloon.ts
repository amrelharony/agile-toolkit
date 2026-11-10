import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const balloonArt: InkDrawing = {
  name: "balloon",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 46, rx: 40, ry: 32, seed: 271, tone: "accent2" }],
  strokes: [
    {
      d: "M34.4 63Q14 58 14.2 40.4Q14.6 16.6 48.2 16Q82 16.6 82 40.2Q81.8 64 48.4 64.4Q43.8 64.4 40 63.8L27.6 79.6L34.4 63",
      fill: "paper",
    },
    { d: "M29 34.4L67.2 33.6M29 42.4L60 41.8M29 50.4L48.2 50", tone: "sub", w: 1.8 },
    {
      d: "M70 50.2C68 46 63.4 47.4 65 51.4L70 55.4L75 51.4C76.6 47.4 72 46 70 50.2",
      tone: "accent",
      fill: "accent",
      w: 1.8,
    },
  ],
};
