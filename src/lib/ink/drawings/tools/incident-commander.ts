import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Incident Commander: a red siren beacon on its base, flashing for a live incident. */
const art: InkDrawing = {
  name: "incident-commander",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 38, ry: 32, seed: 2399, tone: "info" }],
  strokes: [
    { d: "M20.6 66.2Q48 64.4 75.4 66L76.2 78.8Q48 80.6 19.8 78.6Z", fill: "paper" },
    {
      d: "M28.6 65.8Q27 30.4 48 27.6Q69 30.4 67.4 65.8",
      fill: "paper",
      fillD: "M28.6 65.8Q27 30.4 48 27.6Q69 30.4 67.4 65.8Z",
    },
    {
      d: "M40.4 64.6Q38.6 45 43 33.6M55.6 64.6Q57.4 45 53 33.6",
      tone: "sub",
      w: 1.6,
      fill: "danger",
      fillD: "M28.6 65.8Q27 30.4 48 27.6Q69 30.4 67.4 65.8Z",
    },
    { d: "M44.6 28L45 22.6Q48 21.6 51 22.6L51.4 28", w: 2 },
    { d: "M27 72.6Q48 71.6 69 72.6", tone: "sub", w: 1.6 },
    {
      d: "M19.4 45.4L8.8 41.6M19.6 56.2L9 58M24.8 34.2L17.4 27.4M76.6 45.4L87.2 41.6M76.4 56.2L87 58M71.2 34.2L78.6 27.4",
      tone: "danger",
      w: 2.4,
    },
  ],
};

export default art;
