import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Velocity Tracker: a speedometer dial with its needle up in the high range, over three sprint bars. */
const art: InkDrawing = {
  name: "velocity",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 34, seed: 2105, tone: "success" }],
  strokes: [
    {
      d: "M12.6 58.4A35.6 35.6 0 0 1 84 58",
      fill: "paper",
      fillD: "M12 58A36 36 0 0 1 84 58Z",
    },
    { d: "M10.4 58.2Q48 60 85.8 57.8" },
    {
      d: "M21.4 49.3L16.6 47.8M31.5 35.3L28.6 31.3M48 30L48 25M64.5 35.3L67.4 31.3M74.6 49.3L79.4 47.8",
      tone: "sub",
      w: 1.8,
    },
    { d: "M48 58L68.6 40.8", tone: "accent", w: 3 },
    { d: ring(48, 58, 4.6), fill: "paper", fillD: disc(48, 58, 4.6), w: 2 },
    {
      d: "M31 86.2L31.2 78.2L38.8 78L39 86ZM44 86.2L44.2 74.2L51.8 74L52 86ZM57 86.2L57.2 70.2L64.8 70L65 86Z",
      fill: "success",
      w: 2,
    },
  ],
};

export default art;
