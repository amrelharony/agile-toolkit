import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Backlog Prioritizer: a winners' podium ranking three backlog cards, the top one on the "1" step. */
const art: InkDrawing = {
  name: "prioritizer",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 32, seed: 2063, tone: "warning" }],
  strokes: [
    {
      d: "M14.4 76.4Q13.8 65 14.2 53.8Q25 54.4 36.2 53.6L36 41.8Q48 42.4 60.2 41.6Q59.8 52 60.4 62Q71 62.4 82 61.6Q82.4 69 81.8 76.6Q48 77.4 14.4 76.4Z",
      fill: "paper",
    },
    { d: "M36.2 54L36 76.6M60.2 62L60.4 76.8", w: 2 },
    { d: "M8.6 78.2Q48 79.8 88.4 77.8", tone: "sub", w: 1.6 },
    { d: "M19.2 53.8L18.8 36.4L31.2 35.8L31.6 53.6Z", fill: "paper" },
    { d: "M22.2 42L28.4 41.8", tone: "sub", w: 1.6 },
    { d: "M65.2 61.8L64.8 47L77 46.6L77.4 61.6Z", fill: "paper" },
    { d: "M68.2 52.4L74.2 52.2", tone: "sub", w: 1.6 },
    { d: "M41.2 41.8L40.6 18.4L55.4 17.8L55.8 41.6Z", fill: "warning" },
    { d: "M44.4 25L52.4 24.8M44.4 30.4L50 30.2", tone: "sub", w: 1.6 },
    { d: "M44.8 50.6L49 47.4L49 71.4", tone: "accent", w: 2.8 },
  ],
};

export default art;
