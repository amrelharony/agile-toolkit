import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Sprint Planning: two story cards in an open sprint box, with an arrow pulling them in. */
const art: InkDrawing = {
  name: "sprint-planning",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 54, rx: 38, ry: 32, seed: 2042, tone: "accent2" }],
  strokes: [
    { d: "M64 44.2Q72 43.9 80.6 44.4", w: 2 },
    {
      d: "M47 44.6L45 27.4L28.4 30.6L31 52.4",
      fill: "paper",
      fillD: "M28.4 30.6L45 27.4L48.6 58L32 60.6Z",
    },
    { d: "M32.6 35.6L42.6 33.8M33.4 41.6L40.6 40.4", tone: "sub", w: 1.6 },
    {
      d: "M45.7 52.2L50.6 24.4L67 28.6L62.7 52.2",
      fill: "accent2",
      fillD: "M50.6 24.4L67 28.6L61.6 58.6L45.2 55Z",
    },
    { d: "M53.4 31L62.6 33.2M52.4 37.4L58.8 38.8", tone: "sub", w: 1.6 },
    { d: "M18.4 52.6L70.6 52L70 86L19 86.4Z", fill: "paper" },
    { d: "M18.6 53.2L28.4 44", w: 2 },
    {
      d: "M70.4 52.2L80.8 44L80.2 77.6L69.8 85.8",
      fill: "paper",
      fillD: "M70.4 52.2L80.8 44L80.2 77.6L69.8 85.8Z",
    },
    { d: "M28.4 64.6Q40 63.6 52 64.4", tone: "sub", w: 1.6 },
    { d: "M9.6 14Q12 31.4 23.6 39.2", tone: "accent", w: 2.6 },
    { d: "M17.5 39.3L23.6 39.2L21.4 33.5", tone: "accent", w: 2.6 },
  ],
};

export default art;
