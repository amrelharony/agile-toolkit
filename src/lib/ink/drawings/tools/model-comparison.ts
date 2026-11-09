import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Model Comparison Matrix: three models side by side as columns of a comparison table, the winning column framed and ticked. */
const art: InkDrawing = {
  name: "model-comparison",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 34, seed: 2630, tone: "accent2" }],
  strokes: [
    { d: "M12.4 19Q48 17.8 83.6 18.8L83.2 79.6Q48 80.8 12.8 79.6Z", fill: "paper" },
    {
      d: "M45.4 13.6Q55.6 13 65.8 13.4L66.2 85Q55.6 85.6 45.2 85.2Z",
      tone: "accent",
      w: 2.4,
      fill: "accent",
    },
    { d: "M13 33.6Q48 32.6 83.2 33.4", w: 2 },
    { d: "M27.4 19.2Q27 49 27.6 79.4", tone: "sub", w: 1.6 },
    { d: "M13 49.4Q48 48.6 83 49.2M13 64.6Q48 64 83 64.4", tone: "sub", w: 1.4 },
    { d: ring(36.6, 26.2, 4.4), w: 2.2 },
    { d: "M50.8 30.4L55.6 21.4L60.4 30.4Z", tone: "accent", w: 2.4 },
    { d: "M70.2 22L78.8 21.8L79 30.4L70.4 30.6Z", w: 2.2 },
    { d: "M16.6 41.4L23.4 41.2M16.6 57L23.4 56.8M16.6 72.2L23.4 72", tone: "sub", w: 1.6 },
    {
      d: "M32 41.2L41 41M32 57L37.6 56.8M32 72.2L39.6 72M70 41.2L75.2 41M70 57L79 56.8M70 72.2L74.8 72",
      tone: "sub",
      w: 2.4,
    },
    {
      d: "M51.2 41.2L54.2 44.2L59.8 37.8M51.2 56.8L54.2 59.8L59.8 53.4M51.2 72L54.2 75L59.8 68.6",
      tone: "success",
      w: 2.4,
    },
  ],
};

export default art;
