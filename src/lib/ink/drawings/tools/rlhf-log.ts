import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** RLHF Feedback Log: two answers side by side and a thumbs-up leaning towards the winner, which is tinted green. */
const art: InkDrawing = {
  name: "rlhf-log",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 48, rx: 40, ry: 34, seed: 2672, tone: "accent2" }],
  strokes: [
    {
      d: "M14.4 10.8Q28 10.2 41.6 10.6Q46.4 10.8 46.4 15.6L46.2 37.6Q46.2 42.4 41.4 42.4L22.4 42.6L14.6 50.6L15.8 42.4Q10 42 10 37.4L10.2 15.6Q10.4 11 14.4 10.8Z",
      w: 2.8,
      fill: "success",
    },
    {
      d: "M54.4 10.8Q68 10.2 81.6 10.6Q86.2 10.8 86.2 15.4L86 37.4Q86 42 81.2 42.4L80.2 50.6L73.6 42.6L54.6 42.4Q49.8 42.4 49.8 37.6L50 15.6Q50.2 11 54.4 10.8Z",
      fill: "paper",
    },
    { d: "M16.6 20.4L40 20M16.6 27.6L38 27.2M16.6 34.8L32 34.6", tone: "sub", w: 1.6 },
    { d: "M56.4 20.4L80 20M56.4 27.6L76 27.2M56.4 34.8L70 34.6", tone: "sub", w: 1.6 },
    { d: "M32.6 68.1L38 66.1L44.5 85.5L39.1 87.5Z", fill: "paper" },
    {
      d: "M38.2 66.5L42.8 62.7L42.7 53.9Q42.8 49.7 46 49.9Q48.8 50.2 49.4 54.5L49.7 60L56.2 58.1Q59.6 57.5 60.1 60.9L63.2 75.6Q63.7 79 60.4 80.1L44.5 85.5Z",
      fill: "success",
    },
    { d: "M52.1 65.6L60.4 63.1M53.2 70.9L61.5 68.4M54.7 75.9L62.5 73.5", tone: "sub", w: 1.6 },
  ],
};

export default art;
