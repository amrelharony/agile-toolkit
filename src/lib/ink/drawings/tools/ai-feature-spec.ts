import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** AI Feature Spec: a spec sheet with the AI feature sketched as a sparkle card, its budgets marked by dimension arrows. */
const art: InkDrawing = {
  name: "ai-feature-spec",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 38, ry: 34, seed: 2609, tone: "accent2" }],
  strokes: [
    {
      d: "M15.6 13.6Q38 12.4 64 13.2L77.6 26.8L78 85.4Q46 86.6 15.8 85.6Q16.4 50 15.6 13.6Z",
      fill: "paper",
    },
    { d: "M64 13.4L63.8 27L77.4 26.8", w: 1.8 },
    { d: "M23.6 20.6Q36 20 48 20.4", w: 2.6 },
    {
      d: "M29.6 36.4Q42 35.8 54.6 36.2Q58.2 36.4 58.2 40L58 58Q58 61.4 54.4 61.4L29.8 61.6Q26 61.4 26 57.8L26.2 40Q26.4 36.6 29.6 36.4Z",
    },
    {
      d: "M42 40.4Q43.2 47.6 50.6 49Q43.2 50.4 42 57.6Q40.8 50.4 33.4 49Q40.8 47.6 42 40.4Z",
      w: 2,
      fill: "warning",
    },
    { d: "M51.6 39.8L51.8 45.2M49 42.6L54.4 42.4", w: 1.6 },
    { d: "M23.6 72.4Q44 71.6 64 72.2M23.6 79.4L50 79", tone: "sub", w: 1.6 },
    {
      d: "M26.2 29.6Q42 29 58.2 29.6M29.8 26.8L26.2 29.6L29.8 32.4M54.6 26.8L58.2 29.6L54.6 32.4",
      tone: "accent",
      w: 2,
    },
    {
      d: "M66 36.6Q66.6 49 66 61.4M63.2 40.2L66 36.6L68.8 40.2M63.2 57.8L66 61.4L68.8 57.8",
      tone: "accent",
      w: 2,
    },
  ],
};

export default art;
