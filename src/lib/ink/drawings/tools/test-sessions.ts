import { dot, turn } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** The flashlight and its beam, drawn pointing right, then turned up towards the page. */
const AIM = -35;
const PIVOT = [18, 78] as const;
const BEAM = "M27 69L84 58L84 98L27.2 87Z";

/** Test Sessions: a flashlight's beam across a page, lighting a dotted trail that ends in a cross where something was found. */
const art: InkDrawing = {
  name: "test-sessions",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 48, rx: 40, ry: 34, seed: 4305, tone: "info" }],
  strokes: [
    {
      d: "M37 10L85 9.6Q88 9.6 88 12.6L88.2 77Q88.2 80 85.2 80L37 80.4Q34 80.4 34 77.4L33.8 13Q33.8 10 37 10Z",
      fill: "paper",
    },
    { d: "M40.4 17.6L66 17.2M40.4 23.4L58.4 23.2", tone: "sub", w: 1.6 },
    {
      d: turn("M27 69L84 58M27.2 87L84 98", AIM, ...PIVOT),
      tone: "warning",
      w: 1.6,
      fill: "warning",
      fillD: turn(BEAM, AIM, ...PIVOT),
    },
    {
      d: `${dot(42.4, 62)}${dot(46.4, 58.4)}${dot(51, 56.8)}${dot(55, 53.2)}${dot(58.4, 49.2)}${dot(62.6, 47.4)}${dot(66.2, 44.6)}`,
      w: 2.8,
    },
    { d: "M68 38.6L73.6 44.2M73.6 38.6L68 44.2", tone: "danger", w: 2.6 },
    {
      d: turn(
        "M6 74L18 73.6Q20 73.6 20 75.6L20.2 80Q20.2 82 18.2 82L6 82.4Q4 82.4 4 80.4L3.8 76Q3.8 74 6 74Z",
        AIM,
        ...PIVOT
      ),
      fill: "paper",
    },
    { d: turn("M20 72.4L27 69L27.2 87L20.2 83.6Z", AIM, ...PIVOT), fill: "paper" },
    { d: turn("M9.4 78.2L14.4 78", AIM, ...PIVOT), tone: "sub", w: 2.4 },
  ],
};

export default art;
