import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const toolboxArt: InkDrawing = {
  name: "toolbox",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 56, rx: 40, ry: 32, seed: 221, tone: "accent2" }],
  strokes: [
    { d: "M22.6 46.6L30.2 21.6L34.6 23.2L28.6 46.4", tone: "wood", w: 2 },
    { d: "M30.2 21.8L31.4 16.2L34.6 23", tone: "ink", w: 1.6 },
    { d: "M63.4 46.4L69.6 24L76.4 26L71.2 46.6", tone: "accent", fill: "accent", w: 2 },
    { d: "M68.4 30.2L71.6 31M67 35.4L70.2 36.2M65.6 40.6L68.8 41.4", tone: "accent", w: 1.4 },
    {
      d: "M13.6 46.2Q48 44.6 82.4 46.4L80.4 80.4Q48 82.4 15.6 80.6Z",
      fill: "accent2",
    },
    { d: "M14.4 56.4Q48 54.8 81.6 56.6" },
    { d: "M37.6 46.2L37.8 36.4Q48 31.6 58.2 36.4L58.4 46" },
    { d: "M43.6 56.4L43.8 62.6L52.4 62.4L52.2 56.2", w: 2 },
  ],
};
