import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** User Interview Log: a participant speaking a quote, the quote bubble carrying a theme tag on a string. */
const art: InkDrawing = {
  name: "user-interviews",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 38, ry: 34, seed: 2252, tone: "accent" }],
  strokes: [
    {
      d: "M10.6 88.4Q11 70.4 26 70.2Q41 70.4 41.4 88.4",
      fill: "paper",
      fillD: "M10.6 88Q11 70.4 26 70.2Q41 70.4 41.4 88Z",
    },
    { d: ring(26, 57, 8.4, 8.6, -2.4), fill: "paper", fillD: disc(26, 57, 8.4, 8.6) },
    {
      d: "M50.4 48.6Q37.6 44.8 37.8 32.6Q38.4 13.4 62.6 13Q87.6 13.4 87.8 32.4Q87.6 51.6 63.4 52.2Q58.4 52.4 54.6 51.6L40.4 60.4L50.4 48.6",
      fill: "paper",
    },
    {
      d: "M55 38.2Q50.4 38.2 50.6 33.8Q51 26 58.6 23L59.2 24.8Q54.6 27.2 55.2 29.8Q59.4 30 59.4 34.2Q59.4 38.2 55 38.2ZM67 38.2Q62.4 38.2 62.6 33.8Q63 26 70.6 23L71.2 24.8Q66.6 27.2 67.2 29.8Q71.4 30 71.4 34.2Q71.4 38.2 67 38.2Z",
      fill: "ink",
      w: 1.8,
    },
    { d: "M77.6 49.6Q76.2 54.6 77.8 59.2", tone: "sub", w: 1.6 },
    {
      d: "M77.8 58.4L85.2 64.2Q84.8 72 85 79.6Q78 80.4 71 79.6Q71.2 72 70.8 64.2Z",
      tone: "accent",
      fill: "accent",
    },
    { d: ring(77.8, 65.4, 2.2, 2.2, -2), tone: "accent", w: 1.6 },
    { d: "M74 72.4Q78 71.8 82 72.4", tone: "accent", w: 1.6 },
  ],
};

export default art;
