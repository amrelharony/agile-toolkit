import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Parking Lot: a parking sign on its post, with a sticky note parked on the post for later. */
const art: InkDrawing = {
  name: "parking-lot",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 38, ry: 34, seed: 4204, tone: "accent" }],
  strokes: [
    { d: "M48 54L48.4 86", w: 3.2 },
    { d: "M28.4 86.6Q48 87.8 67.6 86.4", tone: "sub", w: 1.8 },
    {
      d: "M30.4 10.4L65.8 9.8Q70.6 9.8 70.6 14.6L70.4 50Q70.4 54.8 65.6 54.8L30.6 55.2Q25.8 55.2 25.8 50.4L26 15Q26 10.4 30.4 10.4Z",
      fill: "info",
    },
    {
      d: "M40.6 46.4L40.4 20.4L51 20.4Q60.4 20.6 60.2 29.4Q60 38 50.6 38L40.6 38",
      tone: "info",
      w: 4.6,
    },
    { d: "M49.4 62.6L64 60.4L66.4 75.2L51.8 77.4Z", fill: "warning", w: 2 },
    { d: "M53.4 67.2L61.4 66M54.2 71.6L60 70.8", tone: "sub", w: 1.4 },
    { d: "M45.6 63.2L52.6 62.2", tone: "danger", w: 3 },
  ],
};

export default art;
