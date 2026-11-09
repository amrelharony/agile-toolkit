import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const planArt: InkDrawing = {
  name: "plan",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 47, rx: 41, ry: 33, seed: 11, tone: "accent2" }],
  strokes: [
    { d: "M10.5 19.5Q48 17 86 19" },
    { d: "M84.5 17.5Q86 46 84.8 75" },
    { d: "M86.5 73.8Q48 76 10 74.2" },
    { d: "M12.2 76Q10.6 47 12.4 17.6" },
    { d: "M25 74.5L20.5 88.5M71 74.5L75.5 88.5", w: 2 },
    { d: "M20 28.5L40.2 27.4L40.6 46.4L20.8 47Z", fill: "warning" },
    { d: "M24.4 34.2L36 33.6M24.4 39.4L32.6 39", tone: "sub", w: 1.6 },
    { d: "M46.4 25.8L66.4 26.6L65.6 45.2L45.8 44.4Z", fill: "accent" },
    { d: "M50.6 32.6L61.6 33.2M50.4 38L58 38.4", tone: "sub", w: 1.6 },
    { d: ring(56, 24.2, 1.6), tone: "accent", w: 2.4 },
    { d: "M28.6 52.4L47.4 51.8L47.8 68.4L29.2 68.8Z", fill: "accent2" },
    { d: "M33 58.4L43 58", tone: "sub", w: 1.6 },
    { d: "M56 60L60.6 64.8L72 51.4", tone: "success", w: 2.8 },
  ],
};
