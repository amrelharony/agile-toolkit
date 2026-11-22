import { turn } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Relative Sizing: three open buckets of growing size holding cards, and one more card dropping into the middle bucket. */
const art: InkDrawing = {
  name: "relative-sizing",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 54, rx: 40, ry: 32, seed: 4302, tone: "accent2" }],
  strokes: [
    {
      d: "M15.6 58L20.4 57.6Q22 57.6 22 59.2L22.2 68.4Q22.2 70 20.6 70L15.6 70.4Q14 70.4 14 68.8L13.8 59.6Q13.8 58 15.6 58Z",
      fill: "warning",
      w: 1.8,
    },
    {
      d: "M39.6 50L44.4 49.6Q46 49.6 46 51.2L46.2 60.4Q46.2 62 44.6 62L39.6 62.4Q38 62.4 38 60.8L37.8 51.6Q37.8 50 39.6 50Z",
      fill: "warning",
      w: 1.8,
    },
    {
      d: "M48.1 48L52.9 47.6Q54.5 47.6 54.5 49.2L54.7 59.4Q54.7 61 53.1 61L48.1 61.4Q46.5 61.4 46.5 59.8L46.3 49.6Q46.3 48 48.1 48Z",
      fill: "warning",
      w: 1.8,
    },
    {
      d: "M68.6 40L73.4 39.6Q75 39.6 75 41.2L75.2 50.4Q75.2 52 73.6 52L68.6 52.4Q67 52.4 67 50.8L66.8 41.6Q66.8 40 68.6 40Z",
      fill: "warning",
      w: 1.8,
    },
    {
      d: "M75.6 37L80.4 36.6Q82 36.6 82 38.2L82.2 48.4Q82.2 50 80.6 50L75.6 50.4Q74 50.4 74 48.8L73.8 38.6Q73.8 37 75.6 37Z",
      fill: "warning",
      w: 1.8,
    },
    {
      d: "M82.6 41L87.4 40.6Q89 40.6 89 42.2L89.2 51.4Q89.2 53 87.6 53L82.6 53.4Q81 53.4 81 51.8L80.8 42.6Q80.8 41 82.6 41Z",
      fill: "warning",
      w: 1.8,
    },
    {
      d: "M9.8 65.8L12.2 84.2L25.8 84L28.4 66.2",
      fill: "paper",
      fillD: "M9.8 65.8L12.2 84.2L25.8 84L28.4 66.2Z",
    },
    {
      d: "M33.6 57.8L37 84.2L55 84L58.6 58.2",
      fill: "paper",
      fillD: "M33.6 57.8L37 84.2L55 84L58.6 58.2Z",
    },
    {
      d: "M63.2 47.8L66.6 84.2L87.6 84L91 48.2",
      fill: "paper",
      fillD: "M63.2 47.8L66.6 84.2L87.6 84L91 48.2Z",
    },
    { d: "M5.6 84.8Q48 86.4 90.6 84.4", tone: "sub", w: 1.6 },
    {
      d: turn(
        "M42.6 21L51.4 20.6Q53 20.6 53 22.2L53.2 33.4Q53.2 35 51.6 35L42.6 35.4Q41 35.4 41 33.8L40.8 22.6Q40.8 21 42.6 21Z",
        -10,
        47,
        28
      ),
      fill: "warning",
      w: 1.8,
    },
    { d: "M42.2 9.4L42.6 15.4M50.6 8.6L50.8 14.4", tone: "sub", w: 1.8 },
  ],
};

export default art;
