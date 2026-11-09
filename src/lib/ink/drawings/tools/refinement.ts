import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Refinement Checklist: loose stories go into the funnel; a ready one comes out ticked. */
const art: InkDrawing = {
  name: "refinement",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 38, ry: 34, seed: 2175, tone: "accent2" }],
  strokes: [
    { d: "M30.2 11.6L42.4 9.8L43.8 20.6L31.6 22.4Z", fill: "accent2", w: 2 },
    { d: "M34.2 15.2L39.6 14.4", tone: "sub", w: 1.4 },
    { d: "M52.6 8.8L64.6 10.8L62.8 21.4L50.8 19.4Z", fill: "paper", w: 2 },
    { d: "M55.4 13.6L60.8 14.6", tone: "sub", w: 1.4 },
    {
      d: "M20.4 27.4L39.8 55.2L39.6 66.8L56.6 66.6L56.4 55L75.6 27.2",
      fill: "paper",
      fillD: "M20.4 27.4Q48 31.6 75.6 27.2L56.4 55L56.6 66.6L39.6 66.8L39.8 55.2Z",
    },
    { d: ring(48, 27.4, 27.6, 4.4, -2.8), w: 2.2 },
    { d: "M40.2 55.4Q48 57.2 56.2 55.2", tone: "sub", w: 1.4 },
    { d: "M35.6 72.6L60.4 72.2L60.8 88.4L36 88.8Z", fill: "paper" },
    { d: "M41.4 80.4L46 84.8L55.6 75.6", tone: "success", w: 2.8 },
  ],
};

export default art;
