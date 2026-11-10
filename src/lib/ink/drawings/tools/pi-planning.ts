import { dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** PI Planning Board: a teams-by-iterations board with a red string tying two dependent cards. */
const art: InkDrawing = {
  name: "pi-planning",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 47, rx: 41, ry: 33, seed: 2224, tone: "accent2" }],
  strokes: [
    { d: "M8.6 18.6Q48 17 87.4 18.2" },
    { d: "M86.6 17Q88 46 86.8 76.4" },
    { d: "M88 75.6Q48 77 8 75.4" },
    { d: "M9.6 77Q8.2 47 9.8 17.4" },
    { d: "M9.4 29Q48 28 86.8 28.6M9.4 52.4Q48 51.6 86.8 52.2", tone: "sub", w: 1.6 },
    {
      d: "M24.4 18.6L24 75.8M45.4 18.4Q46 47 45.2 76M66.4 18.2Q65.8 47 66.6 76",
      tone: "sub",
      w: 1.4,
    },
    { d: "M30 23.6L39.6 23.4M51 23.6L60.4 23.4M72 23.6L81.4 23.4", tone: "sub", w: 1.8 },
    { d: `${ring(16.8, 36.4, 3)}${ring(16.8, 59.8, 3)}`, w: 2 },
    {
      d: "M11 47Q11.2 40.8 16.8 40.6Q22.4 40.8 22.6 47M11 70.4Q11.2 64.2 16.8 64Q22.4 64.2 22.6 70.4",
      w: 2,
    },
    { d: "M28.4 33L41.2 32.6L41.6 47.2L28.8 47.6Z", fill: "accent2" },
    { d: "M49.6 57L62.4 56.6L62.8 71.2L50 71.6Z", fill: "paper" },
    { d: "M70.2 56.6L83 57L82.6 71.4L69.8 71Z", fill: "accent2" },
    { d: "M38 43Q50 40 56 48T74 62", tone: "danger", w: 2 },
    { d: `${dot(38, 43)}${dot(74, 62)}`, tone: "danger", w: 4.2 },
  ],
};

export default art;
