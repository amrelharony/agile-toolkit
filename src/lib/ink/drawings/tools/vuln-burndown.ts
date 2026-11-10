import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Vulnerability Burn-Down: a security bug beside the count of open vulnerabilities stepping down to zero. */
const art: InkDrawing = {
  name: "vuln-burndown",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 32, seed: 2441, tone: "info" }],
  strokes: [
    { d: ring(30, 54, 11, 14, -2.3), fill: "paper", fillD: disc(30, 54, 11, 14) },
    { d: ring(30, 36, 5, 4.6, -2), fill: "paper", fillD: disc(30, 36, 5, 4.6) },
    { d: "M27.6 32.2Q24.4 26 19.8 25M32.4 32.2Q35.6 26 40.2 25", w: 1.8 },
    {
      d: "M19.6 48L12 44.4M19 55L10.8 55.4M19.8 62L12.2 66.4M40.4 48L48 44.4M41 55L49.2 55.4M40.2 62L47.8 66.4",
      w: 2,
    },
    {
      d: "M30 41Q29.4 54 30.2 67.6",
      tone: "sub",
      w: 1.6,
      fill: "danger",
      fillD: disc(30, 54, 11, 14),
    },
    { d: "M8.4 78.6Q48 80 87 78.2", tone: "sub", w: 1.6 },
    {
      d: "M51.6 20.4L61.6 20.6L62 34.4L71.6 34.6L72 48.4L80.6 48.6L81 66M76.4 61L81 66.8L85.6 60.8",
      tone: "success",
      w: 2.6,
    },
  ],
};

export default art;
