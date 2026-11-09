import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const lightbulbArt: InkDrawing = {
  name: "lightbulb",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 46, rx: 36, ry: 36, seed: 241, tone: "warning" }],
  strokes: [
    {
      d: "M38.2 62.4Q24 52.4 25.8 36Q28 17.8 48 17.2Q68 17.8 70.2 36Q72 52.4 57.8 62.4",
      fill: "warning",
      fillD: "M38 62.4Q24 52.4 25.8 36Q28 17.8 48 17.2Q68 17.8 70.2 36Q72 52.4 58 62.4Z",
    },
    { d: "M38.2 62.2L38.4 70.2M57.8 62.2L57.6 70.2" },
    { d: "M37 70.2Q48 72.4 59 70M38 76.2Q48 78.4 58 76M42.2 82.2Q48 84.2 53.8 82", w: 2 },
    { d: "M42.4 60.4L44.2 44L48 50.2L51.8 44L53.6 60.4", tone: "accent", w: 1.8 },
    {
      d: "M48 5.6L48 10.8M19.8 13.8L23.8 17.8M76.2 13.8L72.2 17.8M11.6 36L17.2 36M84.4 36L78.8 36",
      tone: "warning",
      w: 2,
    },
  ],
};
