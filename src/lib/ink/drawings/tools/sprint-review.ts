import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Sprint Review Kit: a demo playing on a pull-down screen, two stakeholders watching from the front row. */
const art: InkDrawing = {
  name: "sprint-review",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 46, rx: 38, ry: 32, seed: 2161, tone: "accent" }],
  strokes: [
    { d: "M20.4 14Q48 12.6 76 13.8L75.4 54.6Q48 55.8 20.8 54.8Z", fill: "paper" },
    { d: "M15.6 12.8Q48 11 80.6 12.4", w: 3 },
    { d: "M48 55.6L48.2 66M48.2 66L38.6 84.4M48.2 66L58 84.4", w: 2 },
    { d: "M41.6 24.6L58.4 34L41.8 43.6Z", tone: "accent", fill: "accent", w: 2.6 },
    {
      d: "M6.4 89.6Q6.8 77 18.4 76.6Q30 77 30.4 89.6",
      fill: "paper",
      fillD: "M6.4 89.2Q6.8 77 18.4 76.6Q30 77 30.4 89.2Z",
    },
    { d: ring(18.4, 67.6, 7, 7.2, -2.4), fill: "paper", fillD: disc(18.4, 67.6, 7, 7.2) },
    {
      d: "M65.6 89.6Q66 77 77.6 76.6Q89.2 77 89.6 89.6",
      fill: "paper",
      fillD: "M65.6 89.2Q66 77 77.6 76.6Q89.2 77 89.6 89.2Z",
    },
    { d: ring(77.6, 67.6, 7, 7.2, -2.2), fill: "paper", fillD: disc(77.6, 67.6, 7, 7.2) },
  ],
};

export default art;
