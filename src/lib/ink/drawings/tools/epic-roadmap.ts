import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Epic Roadmap: a folded paper map with a dashed route past milestones to a pin. */
const art: InkDrawing = {
  name: "epic-roadmap",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 32, seed: 2231, tone: "accent2" }],
  strokes: [
    {
      d: "M9.6 28.4L36 22L60.2 28.4L68 26.5M81.2 23.4L86.6 21.8",
      fill: "paper",
      fillD: "M9.6 28.4L36 22L60.2 28.4L86.6 21.8L86.2 78L60 84.2L36.2 78.2L10.4 84.2Z",
    },
    { d: "M10.4 84.2L36.2 78.2L60 84.2L86.4 77.6" },
    { d: "M10.2 27.6Q9.6 56 10.4 84.8M86 21.2Q86.6 50 86 78.6" },
    {
      d: "M36 22.4L36.2 78M60.2 28.6L60 84",
      w: 1.8,
      fill: "accent2",
      fillD: "M36 22L60.2 28.4L60 84.2L36.2 78.2Z",
    },
    {
      d: "M17.2 67.6L23.8 60.4M28.4 58.8L35.6 61.2M40 60.4L46 55.6M49.6 51.6L54.4 44.4M58 42.8L64 45.2M67.6 44.4L72.4 39.6",
      tone: "accent",
      w: 2.4,
    },
    { d: `${dot(15, 70)}${dot(38, 62)}${dot(56, 42)}`, w: 4.2 },
    {
      d: "M74.6 37.4Q67.4 29 68.2 23.8Q69.4 17.6 74.6 17.6Q79.8 17.6 81 23.8Q81.8 29 74.6 37.4",
      tone: "accent",
      fill: "accent",
      fillD:
        "M74.6 37.4Q67.4 29 68.2 23.8Q69.4 17.6 74.6 17.6Q79.8 17.6 81 23.8Q81.8 29 74.6 37.4Z",
    },
    { d: ring(74.6, 24.2, 2.4), w: 1.6, fill: "paper", fillD: disc(74.6, 24.2, 2.4) },
  ],
};

export default art;
