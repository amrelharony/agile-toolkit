import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Prompt Registry: three tabbed prompt cards filed one behind another, the published version in front. */
const art: InkDrawing = {
  name: "prompt-registry",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 34, seed: 2602, tone: "accent2" }],
  strokes: [
    {
      d: "M30.6 64L30.2 19.6L62.4 19.4L64.2 13.4L75.8 13.2L77.6 19.2L82.4 19.4L82 64Z",
      fill: "paper",
    },
    { d: "M22.4 72L22 28.4L44.6 28.2L46.4 22.2L58 22L59.8 28L75.8 28.2L75.4 72Z", fill: "paper" },
    {
      d: "M13.6 83.4Q14 60 13.8 37.2L19.4 37L21.2 31L33 30.8L34.8 36.8L69.6 37Q70.2 60 69.8 83.6Q42 84.4 13.6 83.4Z",
      fill: "paper",
    },
    { d: "M19.4 37L21.2 31L33 30.8L34.8 36.8Z", tone: "accent", w: 2, fill: "accent" },
    { d: "M22 50.6L30.4 56L22 61.4", w: 2.8 },
    { d: "M36 56Q47 55.4 58 55.8M22.6 70Q39 69.2 56 69.6", tone: "sub", w: 1.8 },
  ],
};

export default art;
