import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Token-Cost Tracker: a token dropping into a parking meter whose dial needle is nearing the red budget zone. */
const art: InkDrawing = {
  name: "token-cost-tracker",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 36, ry: 36, seed: 2623, tone: "accent2" }],
  strokes: [
    { d: "M29.6 66L29.8 38Q30 24 48 23.6Q66 24 66.2 38L66.4 66Z", fill: "paper" },
    { d: "M41.4 27.6Q48 27 54.6 27.6", w: 2.6 },
    { d: "M36.2 34.6Q48 34 59.8 34.4L59.6 54.2Q48 54.8 36.4 54.4Z", w: 1.8 },
    { d: "M39 50A9 9 0 0 1 55.4 44.8", tone: "sub", w: 1.6 },
    { d: "M55.4 44.8A9 9 0 0 1 57 50", tone: "danger", w: 3 },
    { d: "M48 50L54 43.6", w: 2.2 },
    { d: dot(48, 50), w: 3.4 },
    { d: "M30 60Q48 59.4 66.2 60", tone: "sub", w: 1.6 },
    { d: "M44.6 66.4Q44.2 76 44.8 84.6M51.4 66.4Q51.8 76 51.2 84.6", w: 2 },
    { d: "M36.6 85.4Q48 84.4 59.4 85.6", w: 2.6 },
    { d: "M58.4 20.6Q55.2 22.2 53.6 25.2", tone: "sub", w: 1.6 },
    { d: ring(66.4, 15.4, 7.6, 7.6, -2), fill: "warning", fillD: disc(66.4, 15.4, 7.6) },
    { d: ring(66.4, 15.4, 3.8, 3.8, -2.6), w: 1.6 },
    { d: "M24.8 34.6L20.4 31.4M23.4 42.6L18.2 42", tone: "danger", w: 1.8 },
  ],
};

export default art;
