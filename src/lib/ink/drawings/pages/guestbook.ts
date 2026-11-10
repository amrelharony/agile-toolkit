import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const guestbookArt: InkDrawing = {
  name: "guestbook",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 46, cy: 54, rx: 40, ry: 32, seed: 321, tone: "moss" }],
  strokes: [
    { d: "M12.4 38.6L52.4 30.4L82.6 42.6L42.4 52.6Z", fill: "paper" },
    { d: "M12.6 38.8L12.4 64.4L42.6 78.6L82.4 66.4L82.6 42.6", w: 2.2 },
    { d: "M42.4 52.6L42.6 78.4", tone: "sub", w: 1.6 },
    { d: "M24 42.4Q30 39 36 41.4T46 40", tone: "accent", w: 1.8 },
    { d: "M50.6 44.6L60.2 42.4M54 48.6L66.4 45.8", tone: "sub", w: 1.5 },
    { d: "M60.6 36.6L82.4 12.4L87.4 17.2L65.6 41.4Z", tone: "ink", fill: "moss", w: 2 },
    { d: "M60.6 36.6L58.4 43.6L65.6 41.4", w: 2 },
  ],
};
