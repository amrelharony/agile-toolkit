import { dot } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** OKR Tracker: the objective as a gold star over a card of three key-result bars, each filled part-way to its target. */
const art: InkDrawing = {
  name: "okrs",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 38, ry: 34, seed: 2336, tone: "accent" }],
  strokes: [
    {
      d: "M13.4 37Q48 35.6 82.8 36.8Q83.6 60.4 83.4 84.2Q48 85.6 12.8 84Q12.4 60.4 13.4 37Z",
      fill: "paper",
    },
    { d: "M23.4 44.2Q48 43.4 74.4 44.2L74.6 51.8Q48 52.6 23.2 51.8Z", w: 1.8 },
    {
      d: "M66.4 43.8L66.6 52.2",
      w: 1.8,
      fill: "accent",
      fillD: "M23.4 44.2L66.4 43.9L66.6 52L23.2 51.8Z",
    },
    { d: "M23.4 57.2Q48 56.4 74.4 57.2L74.6 64.8Q48 65.6 23.2 64.8Z", w: 1.8 },
    {
      d: "M51.2 56.8L51.4 65.2",
      w: 1.8,
      fill: "accent",
      fillD: "M23.4 57.2L51.2 56.9L51.4 65L23.2 64.8Z",
    },
    { d: "M23.4 70.2Q48 69.4 74.4 70.2L74.6 77.8Q48 78.6 23.2 77.8Z", w: 1.8 },
    {
      d: "M37.4 69.8L37.6 78.2",
      w: 1.8,
      fill: "accent",
      fillD: "M23.4 70.2L37.4 69.9L37.6 78L23.2 77.8Z",
    },
    { d: `${dot(18, 48)}${dot(18, 61)}${dot(18, 74)}`, tone: "sub", w: 3.2 },
    {
      d: "M48 7.4L51.4 15.4L60 16.2L53.2 21.8L55.4 30.2L48.2 25.6L40.6 30L42.8 21.6L36 16L44.6 15.6Z",
      fill: "warning",
    },
  ],
};

export default art;
