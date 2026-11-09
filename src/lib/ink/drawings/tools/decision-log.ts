import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Decision Log (ADR): a card-file box of tabbed records, the newest decision card pulled up and ticked. */
const art: InkDrawing = {
  name: "decision-log",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 32, seed: 2287, tone: "warning" }],
  strokes: [
    { d: "M26 52L25.6 30.6L54.6 30.2L55.6 24.8L67 24.6L68 30.2L74.4 30.4L74.2 52Z", fill: "paper" },
    {
      d: "M22.4 52L22.2 37.4L64.4 37L65.4 31.6L76.6 31.4L77.4 37L78.6 37.2L78.4 52Z",
      fill: "paper",
    },
    { d: "M15.2 52.4L17.6 18L49.6 19.6L47.2 53.4Z", fill: "paper" },
    { d: "M23.4 42.4L39.6 43.2M23 47.4L34.6 48", tone: "sub", w: 1.6 },
    { d: "M12.4 50.4Q48 49.2 84.2 50.2L80.8 82.4Q48 83.6 15.6 82.4Z", fill: "paper" },
    { d: "M39.6 60.6L56.6 60.4L56.8 69L39.8 69.2Z", tone: "sub", w: 1.6 },
    { d: "M23.8 29.2L29.4 35.4L41.6 23.8", tone: "success", w: 3 },
  ],
};

export default art;
