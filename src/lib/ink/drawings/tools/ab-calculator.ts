import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** A/B Calculator: two round flasks marked A and B, B fuller, under a small bell curve. */
const art: InkDrawing = {
  name: "ab-calculator",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 34, seed: 4312, tone: "accent" }],
  strokes: [
    { d: "M26 30.6L70 30.2", tone: "sub", w: 1.4 },
    { d: "M28 30Q36 29.6 40 22Q44 12.4 48 12.4Q52 12.4 56 22Q60 29.6 68 30", w: 2.2 },
    {
      d: "M26.4 40.4L26.4 54Q17 57.4 17 66.4Q17.4 79.4 30 79.6Q42.6 79.4 43 66.4Q43 57.4 33.6 54L33.6 40.4M24.4 40.4L35.6 40.2",
      fill: "paper",
      fillD:
        "M26.4 40.4L26.4 54Q17 57.4 17 66.4Q17.4 79.4 30 79.6Q42.6 79.4 43 66.4Q43 57.4 33.6 54L33.6 40.4Z",
    },
    {
      d: "M17.8 70.4Q30 72.6 42.2 70.2",
      tone: "accent",
      w: 1.6,
      fill: "accent",
      fillD: "M17.8 70.4Q30 72.6 42.2 70.2Q40.4 79.2 30 79.4Q19.6 79.2 17.8 70.4Z",
    },
    { d: "M25.8 67.4L29.8 56.8L33.8 67.2M27.2 63.4L32.4 63.2", w: 2 },
    {
      d: "M62.4 40.4L62.4 54Q53 57.4 53 66.4Q53.4 79.4 66 79.6Q78.6 79.4 79 66.4Q79 57.4 69.6 54L69.6 40.4M60.4 40.4L71.6 40.2",
      fill: "paper",
      fillD:
        "M62.4 40.4L62.4 54Q53 57.4 53 66.4Q53.4 79.4 66 79.6Q78.6 79.4 79 66.4Q79 57.4 69.6 54L69.6 40.4Z",
    },
    {
      d: "M54.2 60.6Q66 62.8 77.8 60.4",
      tone: "accent",
      w: 1.6,
      fill: "accent",
      fillD:
        "M54.2 60.6Q66 62.8 77.8 60.4Q79.2 63 79 66.4Q78.6 79.4 66 79.6Q53.4 79.4 53 66.4Q53 63 54.2 60.6Z",
    },
    {
      d: "M62.6 57.6L62.8 69M62.6 57.6Q69 57.2 69 60.6Q68.8 63 62.8 63Q70 62.8 70 66Q69.8 69 62.8 69",
      w: 2,
    },
  ],
};

export default art;
