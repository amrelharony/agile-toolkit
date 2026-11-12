import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Product Goal: a flag planted on top of a hill, with the winding path up to it. */
const art: InkDrawing = {
  name: "product-goal",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 34, seed: 4207, tone: "accent2" }],
  strokes: [
    {
      d: "M6.4 84.6Q22.6 53.4 48.4 50.4Q73.6 52.6 89.6 84.4",
      fill: "moss",
      fillD: "M6.4 84.6Q22.6 53.4 48.4 50.4Q73.6 52.6 89.6 84.4Z",
    },
    { d: "M5.6 84.8Q48 86.6 90.4 84.4", w: 2.2 },
    {
      d: "M24.6 83.6L28.8 81.4M32.4 78.4L33.6 74.4M31.2 70.2L29.8 66.4M33.6 62.6L37.8 60.6M42 58.2L45.8 55.4",
      tone: "sub",
      w: 1.8,
    },
    { d: "M49.8 51.2L50.2 13.4", w: 2.8 },
    {
      d: "M50.2 14.4Q59.4 11 68.4 15.8Q76.6 20.2 84.2 17.2L83.2 33.4Q76.4 36.6 68.2 32.4Q59.4 28 50.2 31.4",
      fill: "accent",
      fillD:
        "M50.2 14.4Q59.4 11 68.4 15.8Q76.6 20.2 84.2 17.2L83.2 33.4Q76.4 36.6 68.2 32.4Q59.4 28 50.2 31.4Z",
    },
    { d: "M14.4 30.4L17.4 32.4M20.4 22.6L21 26.2M26.6 30.6L23.8 32.6", tone: "warning", w: 1.8 },
  ],
};

export default art;
