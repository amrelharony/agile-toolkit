import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** User Story Mapper: a backbone of journey cards with stories beneath, cut by a dashed release slice. */
const art: InkDrawing = {
  name: "story-mapper",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 34, seed: 2056, tone: "accent2" }],
  strokes: [
    { d: "M11 17.6Q46 15.8 82.6 17.2", tone: "sub", w: 1.8 },
    { d: "M78.2 13.4L83.6 17.2L78.4 21.4", tone: "sub", w: 1.8 },
    { d: "M10.4 23.6L32.4 23L32.8 38.4L10.8 38.8Z", fill: "accent2" },
    { d: "M37.4 23.2L59.2 23.6L59 38.6L37 38.2Z", fill: "accent2" },
    { d: "M64.2 23.4L86 23L86.4 38.4L64.6 38.8Z", fill: "accent2" },
    { d: "M12 44.4L30.6 44L31 56.4L12.4 56.8Z", fill: "paper" },
    { d: "M39 44.2L57.6 44.6L57.2 56.6L38.6 56.2Z", fill: "paper" },
    { d: "M66 44.2L84.4 44L84.6 56.4L66.4 56.6Z", fill: "paper" },
    {
      d: "M7.6 63.6L15 63.4M19.4 63.4L27 63.2M31.4 63.2L39 63.2M43.4 63.2L51 63.4M55.4 63.4L63 63.4M67.4 63.6L75 63.6M79.4 63.6L88 63.8",
      tone: "accent",
      w: 2.6,
    },
    { d: "M12.2 70.4L30.8 70L31 82.6L12.6 83Z", fill: "paper" },
    { d: "M38.8 70.2L57.4 70.6L57 82.8L38.4 82.4Z", fill: "paper" },
  ],
};

export default art;
