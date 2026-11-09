import { dot, ring } from "../../pen";
import { SCENE_PEN, SCENE_VIEWBOX, type InkDrawing } from "../../types";

/** The 404: a folded map whose dotted path wanders off and ends in a question. */
export const NOT_FOUND_SCENE: InkDrawing = {
  name: "not-found",
  viewBox: SCENE_VIEWBOX,
  pen: SCENE_PEN,
  bleed: true,
  washes: [{ cx: 160, cy: 112, rx: 146, ry: 78, seed: 601, tone: "wood" }],
  strokes: [
    {
      d: "M38.6 50.4L110.2 35.6L180.4 51.6L251.4 37.6",
      fill: "paper",
      fillD: "M40 50.4L110 36L180 52L250 38L250 168L180 182L110 166L40 180Z",
    },
    { d: "M250.2 37.4L250.6 168.4" },
    { d: "M251.4 168L180.2 182.4L110.4 166.2L38.6 180.4" },
    { d: "M39.6 181.4L40.2 49.4" },
    { d: "M110.2 36.4L110.4 166M180.4 52.4L180.2 181.6", tone: "sub", w: 1.6 },
    { d: "M66.4 98.4L80.6 74.6L94.4 98.2M86.4 98.4L97.6 82.4L108.6 98.6", tone: "moss", w: 2.2 },
    {
      d: ring(206.4, 146.4, 18, 9, -2.4),
      tone: "accent2",
      fill: "accent2",
      fillD: ring(206.4, 146.4, 18, 9, 0, 0),
    },
    {
      d: `${dot(58.4, 156.4)}${dot(68.4, 150)}${dot(79, 146.4)}${dot(90.4, 140.4)}${dot(100.4, 132.4)}${dot(112.4, 128.6)}${dot(124.4, 122.4)}${dot(134.4, 114.4)}${dot(146.4, 110.4)}${dot(158.4, 104.4)}${dot(170.4, 100.6)}${dot(182.4, 98.4)}${dot(194.4, 92.4)}${dot(205, 86.4)}`,
      tone: "accent",
      w: 4,
    },
    {
      d: "M211.4 72.4Q211 56.4 224.6 56Q238.4 56.6 237.4 69Q236.4 77.6 226 81.6L225.6 91.6",
      tone: "accent",
      w: 4,
    },
    { d: dot(225.4, 103.4), tone: "accent", w: 5.4 },
    {
      d: "M276.6 120.4L282.6 136.4L276.4 152.6L270.4 136.4Z",
      tone: "danger",
      fill: "danger",
      w: 2,
    },
    { d: ring(276.6, 136.4, 21, 21, -2.6), tone: "ink", w: 2 },
    { d: "M276.4 108.4L276.6 113.4", w: 2.4 },
  ],
};
