import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Retro Board: two retro stickies, the front one carrying three dot votes. */
const art: InkDrawing = {
  name: "retro",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 32, seed: 2140, tone: "accent3" }],
  strokes: [
    { d: "M12.4 26L48 20.4L53 56L17.2 61.2Z", fill: "warning" },
    { d: "M17.4 33.6L40 30.2M18.6 41.4L35 39", tone: "sub", w: 1.6 },
    { d: "M38 30.4L80.2 33.2L78.6 64L67 75.6L35.6 73.4Z", fill: "paper" },
    { d: "M78.6 64.2L69.8 66L67.2 75.4", w: 1.8 },
    { d: "M43.6 41.4L71.6 43.2M43 49.8L64 51.2", tone: "sub", w: 1.8 },
    {
      d: `${ring(46.4, 62.6, 3.8)}${ring(55.6, 63.2, 3.8)}${ring(64.8, 63.8, 3.8)}`,
      tone: "accent",
      fill: "accent",
      fillD: `${disc(46.4, 62.6, 3.8)}${disc(55.6, 63.2, 3.8)}${disc(64.8, 63.8, 3.8)}`,
      w: 2.2,
    },
    { d: `${dot(46.2, 62.6)}${dot(55.4, 63.2)}${dot(64.6, 63.8)}`, tone: "accent", w: 4.4 },
  ],
};

export default art;
