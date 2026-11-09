import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** DACI Decision Doc: a decision sheet listing four roles, with a steering wheel for the Driver on its corner. */
const art: InkDrawing = {
  name: "daci",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 48, rx: 38, ry: 34, seed: 2770, tone: "warning" }],
  strokes: [
    {
      d: "M16.2 13.8Q34 12.8 51.8 13L62 23Q62.8 50 62.2 79.6Q39.4 80.8 16.6 80Q15.4 46 16.2 13.8Z",
      fill: "paper",
    },
    { d: "M51.6 13.6L52.2 23.4L61.6 23", w: 1.8 },
    { d: `${dot(23.4, 27)}${dot(23.4, 38)}${dot(23.4, 49)}${dot(23.4, 60)}`, w: 4.2 },
    {
      d: "M29.4 27.2Q38 26.6 46.6 27M29.4 38.2Q38.6 37.6 47.8 38M29.4 49.2Q36 48.8 42.6 49M29.4 60.2Q34.6 59.8 39.8 60",
      tone: "sub",
      w: 1.8,
    },
    { d: ring(64, 62, 17, 17, -2.2), fill: "paper", fillD: disc(64, 62, 17), w: 2.4 },
    {
      d: ring(64, 62, 12.6, 12.6, -1),
      fill: "accent",
      fillD:
        "M81 62A17 17 0 0 1 47 62A17 17 0 0 1 81 62ZM76.6 62A12.6 12.6 0 0 0 51.4 62A12.6 12.6 0 0 0 76.6 62Z",
      w: 1.8,
    },
    { d: "M51.6 62.4L60 62.2M68 62.2L76.4 62.6M64 66L64.2 74.4", w: 2.4 },
    { d: ring(64, 62, 4), tone: "accent", fill: "accent", fillD: disc(64, 62, 4), w: 2.2 },
  ],
};

export default art;
