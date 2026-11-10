import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Agentic Workflow Designer: a flow of agent steps forking at a decision, one branch to a tool, one to a human checkpoint. */
const art: InkDrawing = {
  name: "agentic-workflow",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 36, seed: 2651, tone: "accent2" }],
  strokes: [
    {
      d: "M36.4 10.6Q48 10 59.6 10.4Q63 10.6 63 14L63 20.4Q62.8 23.8 59.4 23.8L36.6 24Q33.2 23.8 33.2 20.4L33.2 14Q33.4 10.8 36.4 10.6Z",
      fill: "paper",
    },
    { d: "M39 17.2Q48 16.8 57 17", tone: "sub", w: 1.6 },
    { d: "M48.2 24.2L48 31M45 27.8L48 31.4L51 27.8", w: 2 },
    { d: "M48 32.4L58.8 42.6L48 52.8L37.2 42.6Z", fill: "paper" },
    {
      d: "M45.2 39.4Q45.4 36.6 48.2 36.6Q51 36.8 50.8 39.4Q50.6 41.4 48.2 42.4L48.2 44.4",
      tone: "sub",
      w: 1.8,
    },
    { d: dot(48.2, 48.2), tone: "sub", w: 2.8 },
    { d: "M37.4 42.6Q24.4 42.4 24.4 60.6M21 57.4L24.4 61.4L27.8 57.4", w: 2 },
    { d: "M58.6 42.6Q72 42.4 72 58.6M68.6 55.4L72 59.4L75.4 55.4", w: 2 },
    {
      d: "M15.4 63.6Q24 63 32.8 63.4Q36.4 63.6 36.4 67L36.2 80.6Q36 84 32.6 84L15.6 84.2Q12.2 84 12.2 80.6L12.4 67Q12.4 63.8 15.4 63.6Z",
      fill: "paper",
    },
    { d: `M17.6 80Q21.4 76.6 25.6 72.6${ring(28.4, 69.6, 4, 4, -0.1, -1.5)}`, w: 2.4 },
    { d: ring(72, 73, 12), tone: "accent", w: 2.6, fill: "accent", fillD: disc(72, 73, 12) },
    { d: ring(72, 68.6, 3.8, 3.8, -2), fill: "paper", fillD: disc(72, 68.6, 3.8) },
    { d: "M64.6 81.6Q65 75.4 72 75.2Q79 75.4 79.4 81.6", w: 2.2 },
  ],
};

export default art;
