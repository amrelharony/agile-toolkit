import { dot } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** 1:1 Meeting Tracker: two chairs facing across a little coffee table, a conversation bubble between them. */
const art: InkDrawing = {
  name: "one-on-one",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 54, rx: 40, ry: 32, seed: 2539, tone: "plum" }],
  strokes: [
    { d: "M8.4 84.6Q48 86.4 87.6 84.4", tone: "sub", w: 1.6 },
    { d: "M14.4 34.4Q16.4 48 18.6 61.6M81.6 34.4Q79.6 48 77.4 61.6", w: 3.2 },
    {
      d: "M15.8 61.4Q27 60.4 38.4 61.2L38.2 66Q27 66.8 16.4 66.2ZM80.2 61.4Q69 60.4 57.6 61.2L57.8 66Q69 66.8 79.6 66.2Z",
      fill: "paper",
    },
    { d: "M18.6 66.2L16.4 84.4M35.6 66.2L37 84.4M77.4 66.2L79.6 84.4M60.4 66.2L59 84.4", w: 2 },
    { d: "M48 56Q47.6 70 48.2 84.2M42 84.4Q48 83.4 54 84.6", w: 2.2 },
    { d: "M38.6 52.4Q48 51.6 57.4 52.2L57.2 55.8Q48 56.4 38.8 55.8Z", fill: "paper" },
    {
      d: "M41.2 46.2L46 46L45.6 52L41.6 52.2ZM50 46L54.8 46.2L54.4 52.2L50.4 52Z",
      w: 1.8,
      fill: "paper",
    },
    { d: "M41.2 47.6Q38.8 48.6 41.4 51M54.8 47.6Q57.2 48.6 54.6 51", w: 1.6 },
    {
      d: "M36 16.4Q48 15 60 16.4Q64 17 64 21.4L63.8 27.4Q63.6 31.6 59.6 31.8L50.6 32L46 37.6L46.4 32L36.4 32.2Q32.2 32 32.2 27.6L32.4 21.2Q32.6 16.8 36 16.4Z",
      fill: "paper",
    },
    { d: `${dot(41, 24)}${dot(48, 24)}${dot(55, 24)}`, tone: "accent", w: 3.6 },
  ],
};

export default art;
