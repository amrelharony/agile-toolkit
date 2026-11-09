import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Threat Model Registry: a quartered shield, one quarter ticked as mitigated, as a lightning bolt strikes its rim. */
const art: InkDrawing = {
  name: "threat-model",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 46, cy: 50, rx: 38, ry: 34, seed: 2434, tone: "info" }],
  strokes: [
    {
      d: "M14 19Q26.6 22.8 39 15.6Q51.4 22.8 64 19Q65 40 62 58Q56 76 39 86Q22 76 16 58Q13 40 14 19Z",
      fill: "paper",
    },
    { d: "M39 16.4Q38.4 50 39.2 85.2M15 44.4Q39 43.6 63.6 44.6", tone: "sub", w: 1.6 },
    { d: "M20.6 31L25.6 36.4L33.8 25.4", tone: "success", w: 2.6 },
    {
      d: "M80 8L69.4 26L76 27L66.6 42L84 22L77.6 21.4L87.4 8Z",
      tone: "danger",
      fill: "paper",
      w: 2,
    },
    {
      d: "M69.8 46L74.6 49.6M65.8 47.6L66.4 53.2M71.6 42.6L76.8 44",
      tone: "danger",
      w: 1.8,
      fill: "danger",
      fillD: "M80 8L69.4 26L76 27L66.6 42L84 22L77.6 21.4L87.4 8Z",
    },
  ],
};

export default art;
