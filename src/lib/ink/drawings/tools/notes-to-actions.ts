import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Notes to Actions: a torn notepad page with three arrows fanning out to a tick box, a decision's flag and a blocker's stop sign. */
const art: InkDrawing = {
  name: "notes-to-actions",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 34, seed: 4306, tone: "accent" }],
  strokes: [
    {
      d: "M8.4 18L12 14.6L15.6 18.2L19.2 14.4L22.8 18L26.4 14.6L30 18.2L33.6 14.4L37.2 18L40.2 15.2L40 81.6L8.6 82Z",
      fill: "paper",
    },
    {
      d: "M13.6 28L34 27.6M13.6 37L31.6 36.8M13.6 46L34.4 45.6M13.6 55L28 54.8M13.6 64L33 63.8M13.6 73L26.6 72.8",
      tone: "sub",
      w: 1.6,
    },
    {
      d: "M43.4 40.4Q53.6 30 62.6 24.4M57.6 23.4L63 24L60.4 28.8M43.6 48.2L63.2 48M58.8 44.4L63.4 48L58.8 51.6M43.4 56Q53.6 66.4 62.8 71.8M57.8 72.6L63.2 72L60.6 67.2",
      w: 2,
    },
    {
      d: "M68 14L80 13.6Q82 13.6 82 15.6L82.2 28Q82.2 30 80.2 30L68 30.4Q66 30.4 66 28.4L65.8 16Q65.8 14 68 14Z",
      fill: "paper",
    },
    { d: "M69.4 21.8L73.2 26.4L81.6 14.6", tone: "success", w: 2.8 },
    { d: "M68.2 60.4L68.4 37.6", w: 2.4 },
    {
      d: "M68.4 38.6Q74 36.6 79 39.2Q83.4 41.4 87.4 39.8L87 50.2Q82.8 51.8 78.6 49.6Q73.8 47.2 68.4 49.2",
      fill: "warning",
      fillD:
        "M68.4 38.6Q74 36.6 79 39.2Q83.4 41.4 87.4 39.8L87 50.2Q82.8 51.8 78.6 49.6Q73.8 47.2 68.4 49.2Z",
    },
    {
      d: "M72.7 66.1L79.3 66L84 70.7L84.1 77.3L79.3 82L72.7 81.9L68 77.3L68 70.6Z",
      tone: "danger",
      w: 2.4,
      fill: "danger",
    },
    { d: "M71.8 74.1L80.4 73.9", tone: "danger", w: 2.6 },
  ],
};

export default art;
