import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Design Sprint Tracker: a five-day calendar, Monday and Tuesday ticked, today circled. */
const art: InkDrawing = {
  name: "design-sprint",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 32, seed: 2504, tone: "accent3" }],
  strokes: [
    { d: "M14.6 21Q48 19.6 81.6 20.8L81 82Q48 83.2 14.2 82.2Z", fill: "paper" },
    {
      d: "M14.6 34Q48 33 81.4 34",
      fill: "accent3",
      fillD: "M14.6 21Q48 19.6 81.6 20.8L81.4 34Q48 33 14.6 34Z",
    },
    { d: "M27 15.6L27 25M41 15.6L41 25M55 15.6L55 25M69 15.6L69 25", w: 3 },
    {
      d: "M20.4 44.2Q48 43.4 75.8 44M75.6 43.6L76 72.4M76.4 72Q48 72.8 20 72.2M20.6 72.6L20.2 43.8",
      w: 2,
    },
    { d: "M31.4 44L31.6 72.2M42.6 44L42.4 72.2M53.8 44L54 72.2M65 44L64.8 72.2", w: 1.8 },
    { d: "M22.8 58L25.2 61L29.4 54.8M34 58L36.4 61L40.6 54.8", tone: "sub", w: 1.8 },
    { d: "M42.6 43.4L54.2 43.2L54.4 72.8L42.2 73Z", tone: "accent", fill: "accent", w: 2.6 },
  ],
};

export default art;
