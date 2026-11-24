import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Kickoff: a poster pinned with two tacks, its 2×2 boxes with one ticked, and a paper plane lifting off its top corner. */
const art: InkDrawing = {
  name: "kickoff",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 46, cy: 52, rx: 40, ry: 34, seed: 4316, tone: "plum" }],
  strokes: [
    {
      d: "M10 34L52 33.6Q54 33.6 54 35.6L54.2 86Q54.2 88 52.2 88L10 88.4Q8 88.4 8 86.4L7.8 36Q7.8 34 10 34Z",
      fill: "paper",
    },
    {
      d: ring(14.4, 39.4, 2.4, 2.4, -2.3),
      tone: "danger",
      fill: "danger",
      fillD: disc(14.4, 39.4, 2.4),
    },
    {
      d: ring(47.6, 39.4, 2.4, 2.4, -2),
      tone: "danger",
      fill: "danger",
      fillD: disc(47.6, 39.4, 2.4),
    },
    { d: "M20.6 40.4L41.4 40", tone: "sub", w: 1.8 },
    {
      d: "M15.6 47L26.4 46.6Q28 46.6 28 48.2L28.2 59.4Q28.2 61 26.6 61L15.6 61.4Q14 61.4 14 59.8L13.8 48.6Q13.8 47 15.6 47ZM34.6 47L45.4 46.6Q47 46.6 47 48.2L47.2 59.4Q47.2 61 45.6 61L34.6 61.4Q33 61.4 33 59.8L32.8 48.6Q32.8 47 34.6 47ZM15.6 66L26.4 65.6Q28 65.6 28 67.2L28.2 78.4Q28.2 80 26.6 80L15.6 80.4Q14 80.4 14 78.8L13.8 67.6Q13.8 66 15.6 66ZM34.6 66L45.4 65.6Q47 65.6 47 67.2L47.2 78.4Q47.2 80 45.6 80L34.6 80.4Q33 80.4 33 78.8L32.8 67.6Q32.8 66 34.6 66Z",
      w: 1.8,
    },
    { d: "M35.6 54L39.4 58.4L46.4 48.4", tone: "success", w: 2.6 },
    { d: "M56 32L58.6 29.6M61.2 27.4L63.8 25.2M66.4 23L69 20.8", tone: "sub", w: 1.8 },
    { d: "M91 5.6L72 13.6L78.6 18.6Z", fill: "paper" },
    { d: "M91 5.6L78.6 18.6L80.6 25Z", fill: "plum" },
  ],
};

export default art;
