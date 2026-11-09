import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Value vs Effort Matrix: a 2x2 board, a pointer dragging a card along a dashed trail into the quick-wins corner. */
const art: InkDrawing = {
  name: "value-effort-matrix",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 49, rx: 40, ry: 34, seed: 2735, tone: "warning" }],
  strokes: [
    {
      d: "M12.2 13.4Q48 12 84.6 13",
      fill: "paper",
      fillD: "M12.2 13.2L84.2 12.6L83.8 84L12 83.6Z",
    },
    { d: "M83.4 11.8Q84.8 48 83.6 84.8M85 83.4Q48 84.8 11.4 83.6M12.8 85Q11.4 48 12.8 11.8" },
    {
      d: "M48.4 13.4Q47.4 48 48.6 83.4M12.6 48.6Q48 47.4 83.8 48.2",
      tone: "sub",
      w: 2,
      fill: "success",
      fillD: "M13.6 14.4L47.4 14.2L47.2 47.6L13.8 47.8Z",
    },
    { d: "M59.4 21.8L74.4 21.2L74.8 35.8L59.8 36.2Z", fill: "paper" },
    { d: "M21.4 60L35.6 59.6L36 73.4L21.8 73.8Z", fill: "paper" },
    { d: "M73 73.2L68.8 69M65.2 65.4L61 61.2M57.4 57.6L53.6 53.8", tone: "accent", w: 2.2 },
    { d: "M21 24.4L36.6 21.6L39.4 37L23.8 39.8Z", fill: "paper" },
    { d: "M35.6 34.8L36.2 52L40.6 47.6L44.6 55.6L48.4 53.8L44.4 45.8L50.6 45.4Z", fill: "paper" },
  ],
};

export default art;
