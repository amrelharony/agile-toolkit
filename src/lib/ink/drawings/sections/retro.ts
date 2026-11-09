import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const retroArt: InkDrawing = {
  name: "retro",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 32, seed: 31, tone: "accent3" }],
  strokes: [
    { d: "M48.6 15.6L73 58.6L48.6 58.4Z", fill: "accent3" },
    { d: "M45.2 23L24.2 58.4L45.4 58.6Z", fill: "paper" },
    { d: "M47 64.4L47 12.6" },
    { d: "M47 12.8L58 16.4L47 20", tone: "accent", fill: "accent" },
    { d: "M19.4 63.6Q48 65.4 76.8 63" },
    { d: "M76.6 63.4L66.4 75" },
    { d: "M67 74.6Q48 76.2 29.8 74.6" },
    { d: "M30.4 75.2L19.8 63.2" },
    { d: "M9 76Q20 72.4 30 75.6T50 76T70 75.2T88 74", tone: "accent2", w: 2 },
    { d: "M17 84Q27 81 36 83.6T54 83.8T74 83", tone: "accent2", w: 1.6 },
    { d: "M77.6 27Q83 25.8 88.4 27.6M75.6 34Q81.4 32.8 87.4 34.6", tone: "sub", w: 1.6 },
  ],
};
