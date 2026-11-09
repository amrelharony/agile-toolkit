import { ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Liberating Structures Picker: a birdcage with its door swung open and the bird flying free. */
const art: InkDrawing = {
  name: "liberating-structures",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 50, rx: 38, ry: 34, seed: 2497, tone: "accent3" }],
  strokes: [
    {
      d: "M26.4 75L25.8 42Q26 18.6 48 18.2Q70 18.6 70.2 42L70 75",
      fill: "paper",
      fillD: "M26.4 75L25.8 42Q26 18.6 48 18.2Q70 18.6 70.2 42L70 75Z",
    },
    { d: "M37 21.6L37 74.4M48 18.6L48 74.6M59 21.6L59 50.2", tone: "sub", w: 1.8 },
    { d: "M52.4 74.4L52.6 50.2L66.6 50", w: 2 },
    { d: "M20.4 74.6Q48 76.4 75.6 74.4L73.6 81.4Q48 83.4 22.4 81.4Z", fill: "paper" },
    { d: "M48 18.2L48 15", w: 2 },
    { d: ring(48, 11.6, 3.4, 3.4, 1.2), w: 2 },
    { d: "M66.6 50L77 45.6L77.2 70L66.6 74.4Z", fill: "paper", w: 2 },
    { d: "M71.8 48L71.8 72.2", tone: "sub", w: 1.6 },
    { d: "M78.6 41.6L79 37.8M79.6 34.4L80 30.6", tone: "sub", w: 1.6 },
    { d: "M68.4 24.2Q74 16.2 79.6 23.6Q84.6 15.6 89.6 20.6", tone: "accent", w: 2.8 },
  ],
};

export default art;
