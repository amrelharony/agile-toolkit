import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Scrum Master Notebook: a spiral notebook of dated notes, with a pencil standing ready beside it. */
const art: InkDrawing = {
  name: "sm-notebook",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 38, ry: 36, seed: 4212, tone: "plum" }],
  strokes: [
    {
      d: "M27.6 12.6L68.4 12Q72.8 12 72.8 16.4L72.6 80.4Q72.6 84.8 68.2 84.8L27.8 85.2Q23.4 85.2 23.4 80.8L23.6 17Q23.6 12.6 27.6 12.6Z",
      fill: "paper",
    },
    { d: "M31.4 12.4L31.6 85", tone: "danger", w: 1.4 },
    {
      d: "M18.6 22.6Q24 18.4 29.2 22.6M18.6 34.6Q24 30.4 29.2 34.6M18.6 46.6Q24 42.4 29.2 46.6M18.6 58.6Q24 54.4 29.2 58.6M18.6 70.6Q24 66.4 29.2 70.6",
      w: 2.2,
    },
    { d: "M37.4 22.6L49.4 22.4", tone: "accent", w: 2.2 },
    {
      d: "M37.4 32.4L64.6 32.2M37.4 41.4L64.4 41.2M37.4 50.4L58.4 50.2M37.4 59.4L52.6 59.2",
      tone: "sub",
      w: 1.6,
    },
    { d: "M77.6 32.6L77.4 25.4Q81.4 22.6 85.4 25.4L85.2 32.4", fill: "danger", w: 1.8 },
    { d: "M77.4 74.6L77.6 32.6L85.2 32.4L85 74.4Z", fill: "warning", w: 2 },
    { d: "M81.3 33L81.2 74", tone: "warning", w: 1.4 },
    {
      d: "M77.4 74.6L81.2 85.6L85 74.4",
      fill: "paper",
      fillD: "M77.4 74.6L81.2 85.6L85 74.4Z",
      w: 1.8,
    },
    { d: "M80 81.6L81.2 85.6L82.4 81.6Z", fill: "ink", w: 1.2 },
  ],
};

export default art;
