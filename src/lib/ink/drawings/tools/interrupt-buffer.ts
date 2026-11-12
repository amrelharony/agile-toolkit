import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Interrupt Buffer: a shield with a lightning bolt across it, sparks of unplanned work glancing off. */
const art: InkDrawing = {
  name: "interrupt-buffer",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 38, ry: 36, seed: 4206, tone: "accent" }],
  strokes: [
    {
      d: "M48 11.6Q60.4 18.8 75.6 17.8Q78 45.4 70.2 61.8Q62.4 77.6 48.2 85.8Q33.8 77.6 26 61.8Q18.2 45.4 20.6 17.8Q35.8 18.8 48 11.6Z",
      fill: "paper",
    },
    {
      d: "M48 19.6Q57.6 25 68.8 24.6Q70 45.6 64 58.4Q58 70.4 48 76.8",
      tone: "sub",
      w: 1.4,
    },
    { d: "M54.6 21.4L35.6 52.2L47.4 52L41.6 76.8L62.6 42L50.4 42.2Z", fill: "warning", w: 2 },
    { d: "M81.4 30.6L87.6 27.4M83 40.4L89.4 40.6M80.6 50.4L86 53.4", tone: "warning", w: 2 },
    { d: "M14.6 30.6L8.6 27.4M13 40.4L6.6 40.6", tone: "warning", w: 2 },
  ],
};

export default art;
