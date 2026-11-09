import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Job Story Mapper: the milkshake from the classic jobs-to-be-done story, with straw and cherry. */
const art: InkDrawing = {
  name: "jtbd-mapper",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 36, ry: 34, seed: 2525, tone: "accent2" }],
  strokes: [
    {
      d: "M54.2 26.6L58.6 11.8L62.8 13L58.8 26.4",
      fill: "accent2",
      fillD: "M51.2 36.4L58.6 11.8L62.8 13L55.6 37.4Z",
    },
    {
      d: "M28.6 43.6Q30 66 43.4 73.4L43.6 81M67.4 43.6Q66 66 52.6 73.4L52.4 81",
      fill: "paper",
      fillD: "M28.4 42.4Q30 66 43.4 73.4L52.6 73.4Q66 66 67.6 42.2Z",
    },
    { d: "M34.8 85.8Q35.2 80.6 48 80.4Q60.8 80.6 61.2 85.8Q48 87.8 34.8 85.8", fill: "paper" },
    { d: "M31 54.6Q48 58.4 65 54.4", tone: "sub", w: 1.6 },
    {
      d: "M25.8 43Q22.6 35.4 30.6 33.6Q32 26.6 40.6 27.4Q46 21.8 53.6 26.4Q61.6 24.8 64.4 32Q72.6 33.4 70.2 43Q48 46 25.8 43Z",
      fill: "paper",
    },
    { d: "M48.4 19Q49.6 12.4 55.4 9.6", w: 1.8 },
    { d: ring(47, 21, 2.2), tone: "accent", w: 3.2, fill: "accent", fillD: disc(47, 21, 2.2) },
  ],
};

export default art;
