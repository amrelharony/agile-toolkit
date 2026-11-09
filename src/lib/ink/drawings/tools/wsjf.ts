import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** WSJF Calculator: shortest job first, the small valuable parcel hops to the front of the queue. */
const art: InkDrawing = {
  name: "wsjf",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 38, ry: 32, seed: 2721, tone: "warning" }],
  strokes: [
    { d: "M8.6 74.6Q48 76.4 87.4 74", tone: "sub", w: 1.8 },
    { d: "M57.4 40.4L84.6 39.8L85.2 74.2L58 74.6Z", fill: "paper" },
    { d: "M71 40.2L71.4 74.4M57.6 47.4L85 46.8", tone: "sub", w: 1.4 },
    { d: "M35.4 52.6L53.6 52L54 74.4L35.8 74.6Z", fill: "paper" },
    { d: "M44.6 52.4L44.8 74.4", tone: "sub", w: 1.4 },
    { d: "M12.6 59.8L28.2 59.4L28.6 74.6L13 74.8Z", tone: "ink", fill: "warning" },
    { d: "M20.4 59.6L20.6 66.2", tone: "sub", w: 1.4 },
    { d: "M74.6 33.6Q50 6.6 22.8 50.6", tone: "accent", w: 2.6 },
    { d: "M18.8 44.2L22.4 51.4L29.2 47.2", tone: "accent", w: 2.6 },
  ],
};

export default art;
