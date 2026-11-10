import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Cost of Quality Calculator: the quarter's till receipt, prevention and detection lines, and the failure cost totted up in red. */
const art: InkDrawing = {
  name: "quality-cost",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 36, ry: 38, seed: 2483, tone: "info" }],
  strokes: [
    {
      d: "M28.6 10.6Q48 9.6 67.4 10.8L66.6 80.4L62.4 85.6L58.2 80.6L54 85.8L49.8 80.4L45.6 85.6L41.4 80.6L37.2 85.8L33 80.4L28.8 85.4L29.4 80.6Z",
      fill: "paper",
    },
    { d: "M35.4 20.4L60.6 20M38.6 26.2L57.4 25.8", tone: "sub", w: 1.5 },
    { d: "M35.2 37.6L48.4 37.4M54.6 37.4L60.8 37.2", w: 2 },
    { d: "M35.2 47.4L46.4 47.2M54.6 47.2L60.8 47", w: 2 },
    { d: "M34.8 57.4Q48 56.2 61.4 57", tone: "sub", w: 1.4 },
    { d: "M35.2 66.6L49.4 66.4", tone: "danger", w: 2.6 },
    { d: "M53.6 63L62 62.6L62.2 70.4L53.8 70.8Z", tone: "danger", fill: "danger", w: 2.2 },
    { d: "M72.4 61.4Q80.4 63.4 81.6 72.4", tone: "danger", w: 2.4 },
    { d: "M77 70.4L81.8 73.4L85.2 68.6", tone: "danger", w: 2.4 },
  ],
};

export default art;
