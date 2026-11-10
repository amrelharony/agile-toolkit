import { disc, dot, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Squad Session Kit: a stopwatch with a 15-minute quarter shaded, standing on an open comic book. */
const art: InkDrawing = {
  name: "squad-session",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 54, rx: 40, ry: 32, seed: 2014, tone: "wood" }],
  strokes: [
    {
      d: "M7.4 51.6Q6.8 69 7.6 86.2Q28 83 48 88.2Q68 83 88.4 86Q89 68.6 88.2 51.4",
      fill: "accent3",
      fillD: "M7.6 51.6L7.6 86.2Q28 83 48 88.2Q68 83 88.4 86L88.4 51.4Z",
    },
    {
      d: "M48 52.4Q32 45.6 10.8 49.4Q10.2 66 11 82.8Q32 79.4 48 85.4",
      fill: "paper",
      fillD: "M48 52.4Q32 45.6 10.8 49.4L11 82.8Q32 79.4 48 85.4Z",
    },
    {
      d: "M48 52.4Q64 45.6 85.2 49.4Q85.8 66 85 82.8Q64 79.4 48 85.4",
      fill: "paper",
      fillD: "M48 52.4Q64 45.6 85.2 49.4L85 82.8Q64 79.4 48 85.4Z",
    },
    { d: "M48 52.6Q48.4 69 48 85.2", w: 1.8 },
    {
      d: "M15 55.6Q28 53.8 43.4 56.6L43.4 66Q28 63.6 15 65ZM15 69Q20.6 68.6 26.6 69L26.6 78.4Q20.6 78 15 78.6ZM30.4 69.4Q37 69.6 43.4 70.6L43.4 80Q37 78.8 30.4 78.6Z",
      tone: "sub",
      w: 1.5,
    },
    {
      d: "M52.6 56.6Q68 53.8 81 55.6L81 65Q68 63.6 52.6 66ZM52.6 70.6Q66 68.6 81 69L81 78.6Q66 78 52.6 80Z",
      tone: "sub",
      w: 1.5,
    },
    { d: "M48 14.2L48 10.2", w: 2.4 },
    { d: "M43.6 9.4Q48 8.6 52.4 9.4", w: 3 },
    { d: "M59.6 18.4L62.4 15.6", w: 2.8 },
    { d: ring(48, 30, 16, 16, -2.3), fill: "paper", fillD: disc(48, 30, 16) },
    { d: "M48 30L48 18.6A11.4 11.4 0 0 1 59.4 30Z", tone: "accent", fill: "accent", w: 1.8 },
    { d: "M48 41.4L48 38.4M36.6 30L39.6 30", tone: "sub", w: 1.6 },
    { d: dot(48, 30), w: 4.4 },
  ],
};

export default art;
