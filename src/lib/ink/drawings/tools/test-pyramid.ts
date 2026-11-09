import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Test Pyramid Analyzer: a brick pyramid in three layers, a broad green base of unit tests up to a small e2e tip. */
const art: InkDrawing = {
  name: "test-pyramid",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 54, rx: 40, ry: 32, seed: 2462, tone: "info" }],
  strokes: [
    { d: "M11.6 80.2Q29.4 45.6 48 12.2Q66.6 45.6 84.4 80.2Q48 81.2 11.6 80.2Z", fill: "paper" },
    {
      d: "M23.6 57.8Q48 56.8 72.4 57.6",
      fill: "success",
      fillD: "M23.9 57.6L72.1 57.6L84 80L12 80Z",
    },
    {
      d: "M18 68.8Q48 68 78 69M36 57.8L36 68.6M60 57.6L60 68.8M30 69L30 80M48 68.6L48 80.4M66 69L66 80",
      tone: "sub",
      w: 1.4,
    },
    {
      d: "M30 46.4Q48 45.8 66 46.4M48 35.4L48 46M39 46.6L39 57.4M57 46.4L57 57.6",
      tone: "sub",
      w: 1.4,
    },
    { d: "M6.6 83.6Q48 85 89.4 83.2", tone: "sub", w: 1.6 },
    {
      d: "M35.6 35.2Q48 34.4 60.4 35",
      tone: "accent",
      w: 2.4,
      fill: "accent",
      fillD: "M48 12.4L60.2 35L35.8 35Z",
    },
  ],
};

export default art;
