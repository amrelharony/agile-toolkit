import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Scrum of Scrums Tracker: four team reps round a table (top view) over one shared agenda. */
const art: InkDrawing = {
  name: "scrum-of-scrums",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 49, rx: 40, ry: 36, seed: 2238, tone: "accent2" }],
  strokes: [
    {
      d: "M37.6 23Q37.4 11 48 10.8Q58.6 11 58.4 23",
      fill: "accent2",
      fillD: "M37.6 23Q37.4 11 48 10.8Q58.6 11 58.4 23Z",
    },
    { d: ring(48, 21, 5.6), fill: "paper", fillD: disc(48, 21, 5.6) },
    {
      d: "M37.6 75Q37.4 87 48 87.2Q58.6 87 58.4 75",
      fill: "accent2",
      fillD: "M37.6 75Q37.4 87 48 87.2Q58.6 87 58.4 75Z",
    },
    { d: ring(48, 77, 5.6), fill: "paper", fillD: disc(48, 77, 5.6) },
    {
      d: "M21 38.6Q9 38.4 8.8 49Q9 59.6 21 59.4",
      fill: "accent2",
      fillD: "M21 38.6Q9 38.4 8.8 49Q9 59.6 21 59.4Z",
    },
    { d: ring(19, 49, 5.6), fill: "paper", fillD: disc(19, 49, 5.6) },
    {
      d: "M75 38.6Q87 38.4 87.2 49Q87 59.6 75 59.4",
      fill: "accent2",
      fillD: "M75 38.6Q87 38.4 87.2 49Q87 59.6 75 59.4Z",
    },
    { d: ring(77, 49, 5.6), fill: "paper", fillD: disc(77, 49, 5.6) },
    { d: ring(48, 49, 21, 20, -2.4), fill: "paper", fillD: disc(48, 49, 21, 20) },
    { d: "M38.6 37.4L56.4 36.4L57.6 60.6L39.8 61.4Z", w: 1.8 },
    { d: "M47.6 44L53.6 43.6M47.8 50L53.8 49.6M43.4 55.6L53.8 55.2", tone: "sub", w: 1.6 },
    { d: "M41.4 43.6L43.4 46L46 41.2M41.6 49.6L43.6 52L46.2 47.2", tone: "accent", w: 2 },
  ],
};

export default art;
