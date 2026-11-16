import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Audience Wall: a wall of speech bubbles from the room, one picked out, and an upvote arrow beside the latest. */
const art: InkDrawing = {
  name: "audience-wall",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 34, seed: 4203, tone: "accent" }],
  strokes: [
    {
      d: "M15.4 13.6L46.6 12.8Q50.6 12.8 50.6 16.8L50.4 33.4Q50.4 37.4 46.4 37.4L22.6 37.6L15.2 44.6L16 37.6Q11.4 37.4 11.4 33.4L11.6 17.4Q11.6 13.6 15.4 13.6Z",
      fill: "paper",
    },
    { d: "M18 21.6L44 21.2M18 28.8L37.6 28.6", tone: "sub", w: 1.6 },
    {
      d: "M59 19.6L82 19.2Q86 19.2 86 23.2L85.8 36.4Q85.8 40.4 81.8 40.4L78 40.4L80.2 46.8L71.6 40.6L59.2 40.8Q55.2 40.8 55.2 36.8L55.2 23.6Q55.2 19.6 59 19.6Z",
      fill: "accent",
    },
    { d: "M61.6 27.6L79.4 27.4M61.6 33.6L73 33.4", tone: "accent", w: 1.8 },
    {
      d: "M26.4 50.4L64.6 49.6Q68.6 49.6 68.6 53.6L68.4 70.4Q68.4 74.4 64.4 74.4L36.4 74.6L27.2 82.6L28.2 74.6L26.4 74.6Q22.4 74.6 22.4 70.6L22.6 54.4Q22.6 50.4 26.4 50.4Z",
      fill: "paper",
    },
    { d: "M29.6 58.4L61.4 58M29.6 65.6L52.8 65.4", tone: "sub", w: 1.6 },
    { d: "M79.4 56.6L86.4 66L72.4 66Z", tone: "accent", fill: "accent", w: 1.8 },
    { d: "M79.4 66L79.4 79.4", tone: "accent", w: 3 },
  ],
};

export default art;
