import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Polarity Map: an infinity loop flowing between two tinted poles, a plus for the upsides above and a minus for the downsides below. */
const art: InkDrawing = {
  name: "polarity-map",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 48, rx: 40, ry: 32, seed: 2819, tone: "warning" }],
  strokes: [
    {
      d: "M48.6 49C42 36.7 36 27.1 27.4 26.9C17 26.9 10.4 36.7 10.4 48C10.6 59.5 17.4 69.1 27.8 68.9C36.4 68.6 42 59.5 48 48.5",
      fill: "accent",
      fillD:
        "M48.6 49C42 36.7 36 27.1 27.4 26.9C17 26.9 10.4 36.7 10.4 48C10.6 59.5 17.4 69.1 27.8 68.9C36.4 68.6 42 59.5 48 48.5Z",
      w: 2.6,
    },
    {
      d: "M47.6 47.3C54 36.5 60 27.1 68.6 27.1C79 27.1 85.8 36.7 85.6 48.2C85.4 59.8 78.6 69.1 68.2 68.9C59.6 68.6 54 59.5 48.4 49",
      fill: "accent2",
      fillD:
        "M47.6 47.3C54 36.5 60 27.1 68.6 27.1C79 27.1 85.8 36.7 85.6 48.2C85.4 59.8 78.6 69.1 68.2 68.9C59.6 68.6 54 59.5 48.4 49Z",
      w: 2.6,
    },
    { d: "M30.8 22.4L25.6 26.9L30.8 31.4M65.2 22.6L70.4 27.1L65.2 31.6", w: 2.4 },
    { d: "M42.6 15.4Q48 14.8 53.4 15.2M48 10Q48.4 15 48.2 20.6", tone: "sub", w: 2.4 },
    { d: "M42.6 81Q48 80.4 53.4 80.8", tone: "sub", w: 2.4 },
  ],
};

export default art;
