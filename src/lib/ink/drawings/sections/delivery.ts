import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const deliveryArt: InkDrawing = {
  name: "delivery",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 38, ry: 36, seed: 41, tone: "success" }],
  strokes: [
    {
      d: "M15.6 13.6Q44 12.4 72.4 13.4",
      fill: "paper",
      fillD: "M16 13.6L72 13.4L80.4 21.6L80 84.4L16 85Z",
    },
    { d: "M72 13L80.8 21.8" },
    { d: "M80.2 21Q81.4 52 80.2 84.8" },
    { d: "M80.8 84.4Q48 86 15.4 84.6" },
    { d: "M16.2 85.2Q14.6 50 16.6 13" },
    { d: "M72 13.4L72 21.6L80.4 21.6", tone: "sub", w: 1.6 },
    { d: "M26 25.6L26 74.4L72.4 74.2", w: 1.8 },
    { d: "M27.4 30.6L69.4 72", tone: "sub", w: 1.4 },
    {
      d: "M27.2 30.4Q32 33 35 38.2T43.8 46.4T52 52.6T59.8 62.2T67.8 70",
      tone: "accent",
      w: 2.8,
    },
    { d: "M67.8 70.2L67.8 51.8" },
    { d: "M68 52L78.4 55.6L68 59.2", tone: "success", fill: "success" },
  ],
};
