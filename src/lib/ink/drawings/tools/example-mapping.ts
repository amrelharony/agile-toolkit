import { dot, turn } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** The question card, drawn square on and then tilted. */
const QUESTION_CARD =
  "M76.4 40L87.6 39.6Q90 39.6 90 42L90.2 57.6Q90.2 60 87.8 60L76.4 60.4Q74 60.4 74 58L73.8 42.4Q73.8 40 76.4 40Z";

/** Example Mapping: the story's card on top, three rule cards under it, two examples hanging from the first rule and a tilted question card. */
const art: InkDrawing = {
  name: "example-mapping",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 46, rx: 40, ry: 34, seed: 4301, tone: "accent2" }],
  strokes: [
    {
      d: "M15 10L69 9.6Q72 9.6 72 12.6L72.2 23Q72.2 26 69.2 26L15 26.4Q12 26.4 12 23.4L11.8 13Q11.8 10 15 10Z",
      fill: "warning",
    },
    { d: "M18 16.2L52.4 15.8M18 21L40.6 20.8", tone: "sub", w: 1.6 },
    {
      d: "M14.4 32L27.6 31.6Q30 31.6 30 34L30.2 42.6Q30.2 45 27.8 45L14.4 45.4Q12 45.4 12 43L11.8 34.4Q11.8 32 14.4 32Z",
      fill: "info",
    },
    {
      d: "M35.4 32L48.6 31.6Q51 31.6 51 34L51.2 42.6Q51.2 45 48.8 45L35.4 45.4Q33 45.4 33 43L32.8 34.4Q32.8 32 35.4 32Z",
      fill: "info",
    },
    {
      d: "M56.4 32L69.6 31.6Q72 31.6 72 34L72.2 42.6Q72.2 45 69.8 45L56.4 45.4Q54 45.4 54 43L53.8 34.4Q53.8 32 56.4 32Z",
      fill: "info",
    },
    {
      d: "M16 50L26 49.6Q28 49.6 28 51.6L28.2 58Q28.2 60 26.2 60L16 60.4Q14 60.4 14 58.4L13.8 52Q13.8 50 16 50Z",
      fill: "success",
    },
    {
      d: "M16 64L26 63.6Q28 63.6 28 65.6L28.2 72Q28.2 74 26.2 74L16 74.4Q14 74.4 14 72.4L13.8 66Q13.8 64 16 64Z",
      fill: "success",
    },
    { d: "M17.6 55.2L24.4 55M17.6 69.2L23.2 69", tone: "sub", w: 1.4 },
    { d: turn(QUESTION_CARD, 12, 82, 50), fill: "danger" },
    {
      d: turn(
        "M78.6 46.4Q78.8 42.8 82.2 42.8Q85.6 43 85.4 46.2Q85.2 48.6 82.6 49.8Q81.8 50.4 81.8 53",
        12,
        82,
        50
      ),
      tone: "danger",
      w: 2.4,
    },
    { d: dot(80.4, 56.8), tone: "danger", w: 3.4 },
  ],
};

export default art;
