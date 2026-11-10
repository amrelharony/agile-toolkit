import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Kano Model Builder: the three Kano curves on crossed axes, the delighter curve sweeping up to a sparkle. */
const art: InkDrawing = {
  name: "kano-model",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 48, rx: 40, ry: 34, seed: 2714, tone: "warning" }],
  strokes: [
    { d: "M10.4 50.6Q48 49.4 85.6 50.2M47.6 87.2Q48.6 48 47.8 11.2", w: 2 },
    { d: "M80.4 46.2L86.2 50.2L80.6 54.4M43.6 16.6L47.8 10.8L52 16.8", w: 2 },
    { d: "M15.4 84.6Q24 58.4 48 56Q70 54.6 83.6 55", tone: "sub", w: 2.2 },
    { d: "M15.6 80.6Q48.6 50.8 80.4 19.4" },
    { d: "M12.6 45.4Q66 45.6 76 13.6", tone: "accent", w: 2.8 },
    {
      d: "M83.4 14.6Q84.4 21 89.4 22.4Q84.4 23.8 83.4 30.2Q82.4 23.8 77.4 22.4Q82.4 21 83.4 14.6Z",
      tone: "accent",
      w: 1.6,
      fill: "accent",
    },
  ],
};

export default art;
