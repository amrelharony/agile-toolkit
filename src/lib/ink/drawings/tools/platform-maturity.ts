import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Platform Engineering Maturity: a raised platform with a golden path winding across it to a signpost. */
const art: InkDrawing = {
  name: "platform-maturity",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 54, rx: 40, ry: 30, seed: 2392, tone: "info" }],
  strokes: [
    {
      d: "M10.4 54Q29 44.4 48 35.8Q67 44.6 85.6 54Q67 63.4 48 72.2Q29 63.6 10.4 54Z",
      fill: "paper",
    },
    { d: "M10.2 53.6L10.6 63.4Q29 72.6 48 81.4Q67 72.6 85.4 63.2L85.8 53.4" },
    { d: "M48 72.4L48.2 81.2", w: 2 },
    {
      d: "M35.6 66.2Q28 56 48 51Q60 48 57.4 40.4M45.2 70.6Q40 61 52 57Q68 52.4 65.2 44.2",
      tone: "sub",
      w: 1.6,
      fill: "wood",
      fillD: "M35.6 66.2Q28 56 48 51Q60 48 57.4 40.4L65.2 44.2Q68 52.4 52 57Q40 61 45.2 70.6Z",
    },
    {
      d: "M40.2 66Q38.2 62.6 39.2 59.8M41.8 56.4Q44.6 54.6 48 53.8M53.6 52.6Q57.6 51 59.6 48.6",
      tone: "wood",
      w: 2.4,
    },
    { d: "M16 46.6L23 43.2L30.2 46.6L30 55.6L23 59.2L15.8 55.6Z", fill: "paper", w: 2 },
    { d: "M16.2 46.8L23 50.2L30 46.8M23 50.4L23.2 58.8", w: 1.6 },
    { d: "M72.4 51Q71.6 37 72 23.6", w: 2.2 },
    {
      d: "M60.4 18.6Q68 18 76.8 18.4L82 23.4L76.8 28.4Q68 28.8 60.6 28.4Q60 23.6 60.4 18.6Z",
      fill: "paper",
    },
  ],
};

export default art;
