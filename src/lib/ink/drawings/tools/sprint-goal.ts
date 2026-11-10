import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Sprint Goal Builder: one flag planted on top of a hill, with the path up to it. */
const art: InkDrawing = {
  name: "sprint-goal",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 32, seed: 2077, tone: "accent2" }],
  strokes: [
    { d: "M59.6 56.1Q74.3 46.9 89.4 58.6", tone: "sub", w: 1.6 },
    {
      d: "M6.4 84.4Q20 58 44 53Q66 50.4 84.6 84",
      fill: "paper",
      fillD: "M6.4 84.4Q20 58 44 53Q66 50.4 84.6 84Z",
    },
    { d: "M6 85Q48 87 90 84.4", tone: "sub", w: 1.6 },
    {
      d: "M24.6 82L27.4 78.4M30.6 74.6L33.6 71M36.6 67.4L38.8 63.6M40.8 60L42.2 57",
      tone: "sub",
      w: 1.8,
    },
    { d: "M44.4 54.4L44 13.6", w: 2.4 },
    {
      d: "M44.2 15Q54 10.6 62 15T80.4 15.6L79.6 34Q71 30 63 34.4T44.4 33.8",
      tone: "accent",
      w: 2.6,
      fill: "accent",
      fillD: "M44.2 15Q54 10.6 62 15T80.4 15.6L79.6 34Q71 30 63 34.4T44.4 33.8Z",
    },
  ],
};

export default art;
