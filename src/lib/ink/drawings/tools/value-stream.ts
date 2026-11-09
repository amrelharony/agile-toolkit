import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Value Stream Map: three process boxes linked by arrows (the bottleneck shaded), over the stepped lead-time line. */
const art: InkDrawing = {
  name: "value-stream",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 32, seed: 2315, tone: "success" }],
  strokes: [
    { d: "M9.4 20.6Q19 19.8 29 20.4L28.8 42.2Q19 42.8 9.2 42Z", fill: "paper" },
    { d: "M38.4 20.4Q48 19.8 58 20.6L57.8 42Q48 42.8 38.2 42.2Z", fill: "accent" },
    { d: "M67.2 20.6Q77 19.8 87 20.4L86.8 42.2Q77 42.8 67 42Z", fill: "paper" },
    {
      d: "M9.6 27.2Q19 26.6 28.8 27M38.6 27Q48 26.6 57.8 27.2M67.4 27.2Q77 26.6 86.8 27",
      tone: "sub",
      w: 1.4,
    },
    {
      d: "M29.8 31.4L37 31.4M34 28.4L37.2 31.4L34 34.4M58.8 31.4L66 31.4M63 28.4L66.2 31.4L63 34.4",
      w: 2,
    },
    {
      d: "M8.6 68.2L29.2 68L29 56.2L38.2 56L38.4 68.2L58.2 68L58 56.2L67.2 56L67.4 68.2L87.6 68",
      tone: "accent",
      w: 2.6,
    },
    { d: "M10 80Q48 81 86 80M10 76.6L10 83.4M86 76.6L86 83.4", tone: "sub", w: 1.6 },
  ],
};

export default art;
