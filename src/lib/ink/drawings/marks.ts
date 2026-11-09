import { dot } from "../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../types";

/**
 * Small marks the interface draws: the tick a finished moment gets, the
 * scribble a loading placeholder writes over and over, the wash Amr stands on
 * in an empty state, and the empty chart a tool shows before it has data.
 */

export const TICK: InkDrawing = {
  name: "tick",
  viewBox: "0 0 24 24",
  pen: 3,
  strokes: [{ d: "M3.6 13.2Q6.6 15.4 9.4 18.6Q13.4 10.6 20.6 4.8", tone: "success" }],
};

export const SCRIBBLE: InkDrawing = {
  name: "scribble",
  viewBox: "0 0 96 24",
  pen: 2.4,
  strokes: [
    {
      d: "M5 15.4C11 4.6 17.4 4.4 19.6 13.4S27.6 22.6 31.6 12.4S41.2 4 45.4 13.6S55.4 21.6 59.4 11.2S70.6 5.4 73 13.4S82.4 19.6 90.6 9.6",
      tone: "accent",
    },
    { d: "M14 20.6Q40 18.6 72 20", tone: "sub", w: 1.4 },
  ],
};

export const PUDDLE: InkDrawing = {
  name: "puddle",
  viewBox: "0 0 96 24",
  washes: [{ cx: 48, cy: 13, rx: 44, ry: 8, seed: 401, tone: "accent2" }],
  strokes: [],
};

export const NO_DATA: InkDrawing = {
  name: "no-data",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 32, seed: 411, tone: "accent2" }],
  strokes: [
    { d: "M18.4 15.6L18.2 78.4L84.4 78.2", w: 2.4 },
    { d: "M18.6 62.4L80.4 62M18.6 46.4L80.4 46M18.6 30.4L80.4 30", tone: "sub", w: 1 },
    {
      d: `${dot(26.4, 70.4)}${dot(34.4, 66.6)}${dot(42.4, 64.2)}${dot(50.4, 58.6)}`,
      tone: "accent",
      w: 3.6,
    },
    { d: "M58.6 60.4L74.4 42.4L80.6 48L64.6 66Z", tone: "ink", fill: "wood", w: 2 },
    { d: "M58.6 60.4L55.4 69.4L64.6 66", w: 2 },
    { d: "M74.4 42.4L77.6 38.8L83.6 44.4L80.6 48", tone: "accent", w: 2 },
  ],
};

export const MARKS = { TICK, SCRIBBLE, PUDDLE, NO_DATA };
