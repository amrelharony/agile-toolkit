import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const bookArt: InkDrawing = {
  name: "book",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 54, rx: 42, ry: 30, seed: 211, tone: "accent3" }],
  strokes: [
    {
      d: "M9.6 30.4L10 78.4Q30 74.2 48 82.6Q66 74.2 86.2 78.2L86.4 30.2",
      tone: "accent3",
      fill: "accent3",
      fillD: "M10 30.4L10 78.4Q30 74.2 48 82.6Q66 74.2 86 78.2L86 30.2Z",
    },
    {
      d: "M48 30.4Q34 22 14 26.2L14.2 74.4Q34 70.2 48 78.4",
      fill: "paper",
      fillD: "M48 30.4Q34 22 14 26.2L14.2 74.4Q34 70.2 48 78.4Z",
    },
    {
      d: "M48 30.4Q62 22 82 26.2L81.8 74.4Q62 70.2 48 78.4",
      fill: "paper",
      fillD: "M48 30.4Q62 22 82 26.2L81.8 74.4Q62 70.2 48 78.4Z",
    },
    { d: "M48 30.6L48 78.2", w: 1.8 },
    {
      d: "M20 36.4Q32 33.2 42 37.2M20 44.4Q32 41.2 42 45.2M20 52.4Q30 49.6 42 53.2",
      tone: "sub",
      w: 1.5,
    },
    { d: "M54 37.2Q64 33.2 76 36.4M54 45.2Q64 41.2 76 44.4", tone: "sub", w: 1.5 },
    { d: "M62 26.4L62 40L65.4 37L68.8 40L68.8 25.2", tone: "accent", fill: "accent", w: 1.8 },
  ],
};
