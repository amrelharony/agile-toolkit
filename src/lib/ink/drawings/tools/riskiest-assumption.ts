import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Riskiest Assumption Canvas: a block tower whose risky block is sliding out, the top block already wobbling. */
const art: InkDrawing = {
  name: "riskiest-assumption",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 52, rx: 36, ry: 36, seed: 2511, tone: "accent" }],
  strokes: [
    { d: "M13.6 85.4Q41 84.2 70 85.4", tone: "sub", w: 1.6 },
    {
      d: "M24.4 34.2Q41 33.6 57.8 34.4Q58.6 59 58.2 84.2Q41 84.8 23.8 84Q23.4 59 24.4 34.2Z",
      fill: "paper",
    },
    {
      d: "M23.8 74.2Q41 73.6 58.2 74M24 64Q41 64.6 58.2 63.8M24.2 54.2Q41 53.6 58 54M24.2 44Q41 44.6 58 43.8",
      w: 2,
    },
    {
      d: "M35.4 74.2L35.2 84.2M46.8 74L46.6 84.4M35.2 54.2L35.4 64M46.6 54L46.8 64.2M35.4 34.2L35.2 44M46.8 34.2L46.6 44",
      w: 2,
    },
    { d: "M25.2 33.8Q42 32.2 58.6 31.4L57.9 21.4Q41 22.2 24.5 23.8Z", fill: "paper" },
    {
      d: "M58.2 44Q68 43.6 78.4 44.2L78.6 54Q68 54.4 58 54",
      fill: "danger",
      fillD: "M58.2 44Q68 43.6 78.4 44.2L78.6 54Q68 54.4 58 54Z",
      w: 2.4,
    },
    { d: "M81.6 46.6Q84.8 46.4 88.2 46.8M82.4 51.8Q85.4 51.6 88.4 52", tone: "danger", w: 1.8 },
    { d: "M18.2 20.6Q15.2 25.4 17.8 30.4", tone: "sub", w: 1.6 },
  ],
};

export default art;
