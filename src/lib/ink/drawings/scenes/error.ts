import { disc, ring } from "../../pen";
import { SCENE_PEN, SCENE_VIEWBOX, type InkDrawing } from "../../types";

/** Something broke: an ink bottle knocked over, the ink running out across the desk. */
export const ERROR_SCENE: InkDrawing = {
  name: "error",
  viewBox: SCENE_VIEWBOX,
  pen: SCENE_PEN,
  bleed: true,
  washes: [{ cx: 160, cy: 132, rx: 142, ry: 56, seed: 701, tone: "accent2" }],
  strokes: [
    { d: "M22.4 151.6Q160 156.4 298.4 150.6", tone: "sub", w: 2 },
    {
      d: "M188.4 140.4Q220.4 133.6 250.6 141.6Q281.4 148.4 270.4 156.6Q240.4 162.4 206.4 158.4Q182.4 154.4 188.4 140.4",
      tone: "accent2",
      fill: "accent2",
    },
    {
      d: ring(282.4, 147.4, 4, 3, -2),
      tone: "accent2",
      fill: "accent2",
      fillD: disc(282.4, 147.4, 4, 3),
    },
    {
      d: ring(293.6, 152.6, 2.6, 2, -2),
      tone: "accent2",
      fill: "accent2",
      fillD: disc(293.6, 152.6, 2.6, 2),
    },
    {
      d: "M70.4 120.4Q70.6 100.4 92.4 100.2L150.4 100.4Q164.4 100.6 164.6 116.4L164.4 132.4Q164.2 146.4 150.4 146.6L92.4 146.4Q70.2 146.2 70.4 126",
      fill: "paper",
      fillD:
        "M70.4 120.4Q70.6 100.4 92.4 100.2L150.4 100.4Q164.4 100.6 164.6 116.4L164.4 132.4Q164.2 146.4 150.4 146.6L92.4 146.4Q70.2 146.2 70.4 120.4Z",
    },
    { d: "M164.6 112.4L184.4 114.2L184.2 134.4L164.4 136.4" },
    { d: "M184.4 109.6L190.6 109.8L190.4 138.6L184.2 138.4", fill: "ink", w: 2.2 },
    { d: "M96.4 108.4L136.6 108.2L136.4 138.6L96.6 138.4Z", fill: "accent" },
    { d: "M104.4 118.4L128.4 118M104.4 126.6L122.4 126.4", tone: "paper", w: 2 },
    { d: "M190.6 124.4Q196.4 130.4 194.4 140.6", tone: "accent2", w: 3 },
    {
      d: "M37.6 133.4L41.4 118.6L51.6 111.6L62.4 113.8L67.6 124.2L64.4 138.6L52.4 143.4L42.2 140.6Z",
      fill: "paper",
      w: 2.2,
    },
    {
      d: "M44.4 121.6L52.6 128.4L60.6 119.6M52.6 128.4L50.4 140.4M41.4 118.6L44.4 121.6",
      tone: "sub",
      w: 1.5,
    },
  ],
};
