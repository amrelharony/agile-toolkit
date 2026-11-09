import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Standup Tracker: a teammate standing at the sprint board, pointing at the card they're on. */
const art: InkDrawing = {
  name: "standup",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 50, rx: 38, ry: 32, seed: 2154, tone: "accent" }],
  strokes: [
    { d: "M40.6 12.8Q63 11.6 85.6 12.6L85 54Q63 55 40.2 54.2Z", fill: "paper" },
    { d: "M66 20L79.4 20.4L79 33L65.6 32.6Z", tone: "sub", w: 1.8 },
    { d: "M55 38.4L68.4 38.8L68 50.6L54.6 50.2Z", tone: "sub", w: 1.8 },
    { d: "M19.2 62L18.2 85.6M29.4 62L30.4 85.6" },
    {
      d: "M13.6 62.4Q13 41.6 24 40.6Q35 41.6 34.6 62.4",
      fill: "paper",
      fillD: "M13.6 62Q13 41.6 24 40.6Q35 41.6 34.6 62Z",
    },
    { d: "M12.8 62.6Q24 63.6 35.4 62.2", w: 2 },
    { d: ring(24, 28.6, 7.4, 7.6, -2.4), fill: "paper", fillD: disc(24, 28.6, 7.4, 7.6) },
    { d: "M46.6 19.4L60 18.8L60.4 31.6L47 32Z", tone: "accent", fill: "accent", w: 2 },
    { d: "M32 46.6Q39.6 42 46.4 34.6", w: 2.6 },
    { d: "M8 86.6Q48 88 88 86", tone: "sub", w: 1.6 },
  ],
};

export default art;
