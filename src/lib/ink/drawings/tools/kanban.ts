import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Kanban Board: a three-column flow board, cards waiting, one in progress, one done. */
const art: InkDrawing = {
  name: "kanban",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 32, seed: 2301, tone: "accent" }],
  strokes: [
    { d: "M10.6 14.6Q48 13.2 85.6 14.4L85.2 81.6Q48 82.8 10.2 81.8Z", fill: "paper" },
    { d: "M10.8 26.4Q48 25.4 85.4 26.2", w: 2 },
    { d: "M35.4 14.6Q34.8 48 35.6 81.6M60.6 14.4Q61.2 48 60.4 81.8", w: 2 },
    { d: "M16.4 20.4L29.6 20.2M41.6 20.2L54.6 20.4M66.6 20.2L79.6 20.4", tone: "sub", w: 1.6 },
    { d: "M15.6 32.2L30.6 31.8L30.8 44L15.8 44.4ZM15.8 50L30.8 49.8L31 62L16 62.4Z", w: 1.8 },
    { d: "M40.6 32.4L55.6 32L55.8 44.4L40.8 44.8Z", tone: "accent", fill: "accent", w: 2 },
    { d: "M65.6 32L80.6 32.4L80.4 44.6L65.4 44.2Z", w: 1.8 },
    { d: "M68.4 38.6L71.8 42L78 34.6", tone: "success", w: 2.6 },
  ],
};

export default art;
