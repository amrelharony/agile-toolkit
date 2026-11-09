import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** AI Safety Review Checklist: a shield carrying the pre-launch checklist, every safety check ticked. */
const art: InkDrawing = {
  name: "ai-safety-checklist",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 36, ry: 36, seed: 2637, tone: "accent2" }],
  strokes: [
    {
      d: "M48 13.6Q60 19.4 73.6 18.8Q75.4 44 70 60Q63.4 76 48 86.4Q32.6 76 26 60Q20.6 44 22.4 18.8Q36 19.4 48 13.6Z",
      fill: "paper",
    },
    { d: "M43.6 33Q55 32.4 66 32.6M43.6 47Q54 46.4 65 46.6M45.6 61L61 60.6", tone: "sub", w: 1.8 },
    {
      d: "M28.8 32.4L32.4 36L38.6 28.6M29.4 46.4L33 50L39.2 42.6M31.4 60.4L35 64L41.2 56.6",
      tone: "success",
      w: 2.6,
    },
  ],
};

export default art;
