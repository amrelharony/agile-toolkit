import { dot } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** RICE Scoring Calculator: a pocket calculator with times and divide keys and a big equals key. */
const art: InkDrawing = {
  name: "rice-scoring",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 48, rx: 38, ry: 36, seed: 2693, tone: "warning" }],
  strokes: [
    {
      d: "M30.6 12.4L65.6 12Q71.2 12.2 71.2 18L70.8 74.4Q70.8 80.4 65 80.4L31 80.8Q25 80.6 25.2 74.6L25.4 18.4Q25.4 12.6 30.6 12.4Z",
      fill: "paper",
    },
    { d: "M31.6 19.6L64.6 19.2L64.8 33.2L31.8 33.6Z", fill: "accent2" },
    { d: "M53.4 23L60.4 22.8Q57.6 26.4 56.8 30", w: 2.2 },
    { d: "M31.4 40.4L45.2 40.2L45.6 53.8L31.6 54Z", w: 2 },
    { d: "M35.2 44.2L41.6 50.2M41.6 44.2L35.2 50.2", w: 2.2 },
    { d: "M50.8 40.2L64.6 40L64.8 53.6L51 53.8Z", w: 2 },
    { d: "M53.8 47L61.6 46.8", w: 2.2 },
    { d: `${dot(57.6, 43.2)}${dot(57.6, 50.6)}`, w: 3 },
    { d: "M31.6 60L64.6 59.6L64.8 73.2L31.8 73.6Z", tone: "accent", fill: "accent", w: 2.4 },
    { d: "M42.4 64.6L54 64.4M42.4 69L54 68.8", w: 2.4 },
  ],
};

export default art;
