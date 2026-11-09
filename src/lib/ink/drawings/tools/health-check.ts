import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Squad Health Check: a traffic light on its pole, the green lamp lit. */
const art: InkDrawing = {
  name: "health-check",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 36, ry: 36, seed: 2189, tone: "plum" }],
  strokes: [
    {
      d: "M33.8 15.4L25.2 17.2Q26.4 24.6 33.6 30.8M33.8 33.4L25.2 35.2Q26.4 42.6 33.6 48.8M33.8 51.4L25.2 53.2Q26.4 60.6 33.6 66.8",
      w: 2,
    },
    {
      d: "M62.2 15.4L70.8 17.2Q69.6 24.6 62.4 30.8M62.2 33.4L70.8 35.2Q69.6 42.6 62.4 48.8M62.2 51.4L70.8 53.2Q69.6 60.6 62.4 66.8",
      w: 2,
    },
    {
      d: "M37.6 10.4Q48 9.4 58.4 10.2Q63 10.6 63 15L62.6 65.8Q62.6 70.6 58 70.6L38 70.8Q33.2 70.6 33.2 66L33.4 14.8Q33.4 10.6 37.6 10.4Z",
      fill: "paper",
    },
    { d: "M48.2 70.8Q47.4 78.6 48 86.6", w: 2.8 },
    { d: "M38.2 87.2Q48 85.8 58 87.4", w: 2 },
    { d: ring(48, 22, 7.4), tone: "sub", w: 2 },
    { d: ring(48, 40, 7.4, 7.4, -2), tone: "sub", w: 2 },
    {
      d: ring(48, 58, 7.4, 7.4, -2.6),
      tone: "success",
      w: 2.6,
      fill: "success",
      fillD: disc(48, 58, 7.4),
    },
    {
      d: "M20.6 52.4L14.8 49.6M20 58.6L13.6 58.8M20.6 64.8L14.8 67.8M75.4 52.4L81.2 49.6M76 58.6L82.4 58.8M75.4 64.8L81.2 67.8",
      tone: "success",
      w: 1.8,
    },
  ],
};

export default art;
