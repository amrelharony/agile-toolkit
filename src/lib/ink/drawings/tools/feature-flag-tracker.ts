import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Feature Flag Tracker: a flag carrying an on/off toggle, with an owner-and-date tag tied to its pole. */
const art: InkDrawing = {
  name: "feature-flag-tracker",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 48, rx: 38, ry: 36, seed: 2588, tone: "success" }],
  strokes: [
    { d: "M27.6 10.4Q27 48 27.8 82", w: 2.4 },
    {
      d: "M16.6 85.6Q18 80.4 27.6 80.2Q37.4 80.4 38.8 85.6",
      fill: "paper",
      fillD: "M16.6 85.6Q18 80.4 27.6 80.2Q37.4 80.4 38.8 85.6Z",
    },
    {
      d: "M28 13.4Q40 9.6 52 13.6Q64 17.6 78 13.6L72 28.6L78.4 43.2Q64 47.4 52 43.4Q40 39.4 28 43.4",
      fill: "accent",
      fillD:
        "M28 13.4Q40 9.6 52 13.6Q64 17.6 78 13.6L72 28.6L78.4 43.2Q64 47.4 52 43.4Q40 39.4 28 43.4Z",
    },
    {
      d: "M44.4 22.4L56.2 22.4Q62.6 22.6 62.6 29Q62.6 35.4 56.2 35.6L44.4 35.6Q38 35.4 38 29Q38 22.6 44.4 22.4Z",
      fill: "paper",
      w: 2,
    },
    { d: ring(55.6, 29, 4), tone: "success", fill: "success", fillD: disc(55.6, 29, 4), w: 2 },
    { d: "M28 54Q32 57.4 40 58.4", tone: "sub", w: 1.4 },
    {
      d: "M36.4 58.4L42.4 52Q52.6 51.6 63 52.4L62.6 64.8Q52.4 65.4 42.2 65L36.4 58.4Z",
      fill: "paper",
      w: 2,
    },
    { d: ring(42.6, 58.4, 2), tone: "sub", w: 1.4 },
    { d: "M47 56.4L58 56.4M47 61L54 61", tone: "sub", w: 1.6 },
  ],
};

export default art;
