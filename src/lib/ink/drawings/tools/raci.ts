import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** RACI Matrix Builder: three teammates heading the columns of a who-does-what grid, one accountable dot per row. */
const art: InkDrawing = {
  name: "raci",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 35, seed: 2203, tone: "plum" }],
  strokes: [
    { d: "M12.4 40.2Q48 39 84.2 40L84.6 84.8Q48 86 12.2 84.6Z", fill: "paper" },
    {
      d: "M30.2 40.4Q29.8 62 30.4 84.8M48.2 40.2Q47.8 62 48.4 85M66.2 40.2Q65.8 62 66.4 85",
      tone: "sub",
      w: 1.6,
    },
    { d: "M12.4 55.2Q48 54.4 84.4 55M12.3 70Q48 69.4 84.5 69.8", tone: "sub", w: 1.6 },
    { d: "M16.4 47.6L26 47.4M16.4 62.6L24.6 62.4M16.4 77.4L26.2 77.2", tone: "sub", w: 1.8 },
    {
      d: "M31.4 37.4Q32 29.6 39 29.4Q46 29.6 46.6 37.4M49.4 37.4Q50 29.6 57 29.4Q64 29.6 64.6 37.4M67.4 37.4Q68 29.6 75 29.4Q82 29.6 82.6 37.4",
      w: 2,
      fill: "paper",
      fillD:
        "M31.4 37.4Q32 29.6 39 29.4Q46 29.6 46.6 37.4ZM49.4 37.4Q50 29.6 57 29.4Q64 29.6 64.6 37.4ZM67.4 37.4Q68 29.6 75 29.4Q82 29.6 82.6 37.4Z",
    },
    {
      d: `${ring(39, 21.6, 5)}${ring(57, 21.6, 5, 5, -2)}${ring(75, 21.6, 5, 5, -2.6)}`,
      w: 2,
      fill: "paper",
      fillD: `${disc(39, 21.6, 5)}${disc(57, 21.6, 5)}${disc(75, 21.6, 5)}`,
    },
    {
      d: "M35.4 62.6L38.2 65.4L43.2 59.2M53.4 47.8L56.2 50.6L61.2 44.4M53.4 77.6L56.2 80.4L61.2 74.2",
      tone: "sub",
      w: 2,
    },
    {
      d: `${ring(39, 47.6, 3.6)}${ring(57, 62.4, 3.6)}${ring(75, 77.4, 3.6)}`,
      tone: "accent",
      w: 2,
      fill: "accent",
      fillD: `${disc(39, 47.6, 3.6)}${disc(57, 62.4, 3.6)}${disc(75, 77.4, 3.6)}`,
    },
  ],
};

export default art;
