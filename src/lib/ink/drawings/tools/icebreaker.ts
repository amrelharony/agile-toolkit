import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Ice Breaker Generator: an ice cube in its little meltwater puddle, cracking open with chips flying off. */
const art: InkDrawing = {
  name: "icebreaker",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 38, ry: 34, seed: 2182, tone: "accent3" }],
  strokes: [
    {
      d: "M22 72Q9.6 76.4 15.4 81.6Q28 87.6 48 87.4Q68 87.6 80.6 81.6Q86.4 76.4 74 72",
      tone: "sub",
      fill: "accent2",
      fillD: "M22 72Q9.6 76.4 15.4 81.6Q28 87.6 48 87.4Q68 87.6 80.6 81.6Q86.4 76.4 74 72Z",
      w: 1.6,
    },
    {
      d: "M44.4 19.7Q48 18 51.6 19.7L74.4 30.3Q78 32 78 36L78.2 62Q78 66 74.4 67.7L51.6 78.3Q48 80 44.4 78.3L21.6 67.7Q18 66 18 62L17.8 36Q18 32 21.6 30.3Z",
      fill: "paper",
    },
    {
      d: "M19 33L48 46.2L77 33",
      fill: "accent2",
      fillD: "M48 19.2L77 33L48 46.2L19 33Z",
    },
    { d: "M48 46.2Q48.4 63 48 79.4" },
    { d: "M23.6 41.6Q23.2 47 23.8 52.6M28.4 46Q28.2 49.6 28.6 53.2", tone: "sub", w: 1.6 },
    { d: "M56 29L64.4 38.8L60 49L67.4 55.4L61.4 64.4L64.6 71", tone: "accent", w: 2.6 },
    {
      d: "M80 20L85 17.4L83.6 22.8ZM70.6 11.6L75 9.6L74.8 14.4Z",
      tone: "accent",
      fill: "accent",
      w: 1.8,
    },
    { d: "M86.4 28.4L89.4 29.6", tone: "accent", w: 1.8 },
  ],
};

export default art;
