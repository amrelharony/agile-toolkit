import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Bug Triage: a beetle sitting in one square of a severity × priority grid, the other three squares empty. */
const art: InkDrawing = {
  name: "bug-triage",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 48, rx: 40, ry: 36, seed: 4303, tone: "info" }],
  strokes: [
    {
      d: "M17 14L79 13.6Q82 13.6 82 16.6L82.2 79Q82.2 82 79.2 82L17 82.4Q14 82.4 14 79.4L13.8 17Q13.8 14 17 14Z",
      fill: "paper",
    },
    {
      d: "M48.2 14.4L47.8 82M14.2 48.2L82 47.8",
      w: 2,
      fill: "danger",
      fillD: "M16.6 16.4L47 16.2L47 47L16.4 47.2Z",
    },
    { d: "M7.6 82.4L7.8 22.4M4.8 26.6L7.8 21.4L10.8 26.4", tone: "sub", w: 1.6 },
    { d: "M14.4 89.2L74.4 88.8M70.2 85.8L75.4 88.8L70.4 91.8", tone: "sub", w: 1.6 },
    {
      d: "M25.6 29.4L21 27.2M25 34.6L20.2 34.8M25.6 39.6L21.4 42.4M37.2 29.4L41.8 27.2M37.8 34.6L42.6 34.8M37.2 39.6L41.4 42.4",
      w: 1.8,
    },
    { d: "M30 22.6Q28.6 19.4 25.6 18.8M32.8 22.6Q34.2 19.4 37.2 18.8", w: 1.6 },
    { d: ring(31.4, 35, 6.6, 8, -2.3), fill: "paper", fillD: disc(31.4, 35, 6.6, 8) },
    { d: ring(31.4, 25, 3.4, 3, -2), fill: "paper", fillD: disc(31.4, 25, 3.4, 3) },
    { d: "M31.4 28.4Q30.8 35 31.4 42.6", tone: "sub", w: 1.4 },
    { d: `${dot(28.2, 32.6)}${dot(34.4, 37.8)}${dot(28.6, 39.4)}`, tone: "danger", w: 2.8 },
  ],
};

export default art;
