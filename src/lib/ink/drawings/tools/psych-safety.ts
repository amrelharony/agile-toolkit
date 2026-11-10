import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Psychological Safety Assessment: two teammates sheltering dry under one umbrella while rain falls round them. */
const art: InkDrawing = {
  name: "psych-safety",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 36, seed: 2546, tone: "plum" }],
  strokes: [
    {
      d: "M13.6 42.4Q14.6 13 48 12.4Q81.4 13 82.4 42.2Q73.8 36.2 65.2 42Q56.6 36 48 42Q39.4 36 30.8 42Q22.2 36.2 13.6 42.4Z",
      fill: "accent",
    },
    {
      d: "M48 12.8Q37.6 24 30.8 41.6M48 12.8Q47.6 27 48 41.6M48 12.8Q58.4 24 65.2 41.6",
      tone: "sub",
      w: 1.6,
    },
    { d: "M48 12.4Q48.2 9.6 47.8 7.4", w: 2.2 },
    { d: "M48 42Q47.6 52 48 60.6Q48.2 64.8 51 64.6Q53.2 64.4 53 62", w: 2.2 },
    {
      d: "M19.6 87Q20.4 70.4 33.4 70Q46 70.4 46.8 87M49.2 87Q50 70.4 62.6 70Q75.6 70.4 76.4 87",
      fill: "paper",
      fillD:
        "M19.6 87Q20.4 70.4 33.4 70Q46 70.4 46.8 87ZM49.2 87Q50 70.4 62.6 70Q75.6 70.4 76.4 87Z",
    },
    {
      d: `${ring(33.4, 57.4, 7.4)}${ring(62.6, 57.4, 7.4, 7.4, -2)}`,
      fill: "paper",
      fillD: `${disc(33.4, 57.4, 7.4)}${disc(62.6, 57.4, 7.4)}`,
    },
    {
      d: "M11.4 50L9 56.4M17.2 56.6L14.8 63M9.6 66L7.2 72.4M85 49L82.6 55.4M88.4 58L86 64.4M80.8 63L78.4 69.4",
      tone: "accent2",
      w: 1.8,
    },
  ],
};

export default art;
