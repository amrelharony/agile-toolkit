import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Cynefin Decision Picker: the four domains split by wavy borders around the small confused space at the centre. */
const art: InkDrawing = {
  name: "cynefin",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 49, rx: 40, ry: 36, seed: 2805, tone: "warning" }],
  strokes: [
    {
      d: "M32 15.5Q48 13 63 15.5Q78 18 83.5 33Q89 48 83.5 64Q78 80 62.5 83Q47 86 32 82.5Q17 79 12 64.5Q7 50 11.5 34Q16 18 32.6 15.4",
      fill: "paper",
      fillD:
        "M32 15.5Q48 13 63 15.5Q78 18 83.5 33Q89 48 83.5 64Q78 80 62.5 83Q47 86 32 82.5Q17 79 12 64.5Q7 50 11.5 34Q16 18 32 15.5Z",
      tone: "sub",
      w: 1.8,
    },
    {
      d: "M48.4 40.2Q43 32.6 48.6 26.6Q54.2 20.4 47.2 13.6",
      fill: "warning",
      fillD:
        "M48.4 40.2Q43 32.6 48.6 26.6Q54.2 20.4 47.8 14.3Q40 14.3 32 15.5Q16 18 11.5 34Q9.3 42 9.4 48.8Q19.4 45 26.4 51.2Q33.4 57 40.2 51.2Q39.4 48 40.6 45Q41.6 39.8 48.4 40.2Z",
      w: 2.4,
    },
    { d: "M56.4 46.8Q63 40.6 70.6 46.6Q77.8 52.8 87 47.6", w: 2.4 },
    { d: "M49.4 56.8Q54.6 63.4 49.8 69.8Q45 76 48.8 85.2", w: 2.4 },
    { d: "M40.2 51.2Q33.4 57 26.4 51.2Q19.4 45 8.6 49.6", w: 2.4 },
    {
      d: "M40.6 45Q41.6 39.8 48 40.2Q55.4 39.6 56.2 46.6Q57.4 54.4 49.6 56.6Q41.4 57.6 40.2 51.4Q39.4 48 40.8 44.4",
      tone: "accent",
      fill: "accent",
      fillD:
        "M40.6 45Q41.6 39.8 48 40.2Q55.4 39.6 56.2 46.6Q57.4 54.4 49.6 56.6Q41.4 57.6 40.2 51.4Q39.4 48 40.6 45Z",
      w: 2.6,
    },
  ],
};

export default art;
