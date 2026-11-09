import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Sprint Capacity Planner: a measuring jug filled to the team's level, a dashed line marking the room left. */
const art: InkDrawing = {
  name: "capacity-planner",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 52, rx: 38, ry: 34, seed: 2049, tone: "accent2" }],
  strokes: [
    { d: "M62.4 32.4Q80.6 30.4 80 46.6Q79.6 62.6 61.8 68.4", w: 2.4 },
    { d: "M63 39.6Q73.4 38.8 73 48Q72.8 57.6 62.6 61.4", tone: "sub", w: 1.6 },
    {
      d: "M22.6 21Q27.6 23.6 28.4 29.4L30.4 81.8Q30.6 85.6 34.6 85.6L57.8 85.4Q61.6 85.4 61.8 81.6L64.4 24.6Q64.6 22 61.6 22Q42 21 22.6 21Z",
      fill: "paper",
    },
    { d: "M28.6 26.2Q46 28.6 64 26", tone: "sub", w: 1.4 },
    {
      d: "M29.6 50.4Q37 47.6 45 50.2T62.9 49.8",
      tone: "accent2",
      w: 2,
      fill: "accent2",
      fillD:
        "M29.6 50.4Q37 47.6 45 50.2T62.9 49.8L61.8 81.6Q61.6 85.2 57.8 85.2L34.6 85.4Q30.8 85.4 30.6 81.8Z",
    },
    { d: "M31 34L37.4 34M31.6 58.4L35.4 58.4M31.8 66L38 66M32 74L35.6 74", tone: "sub", w: 1.6 },
    { d: "M33.4 40.4L38.6 40.2M42.6 40L47.8 40M51.8 39.8L57 39.8", tone: "accent", w: 2.4 },
  ],
};

export default art;
