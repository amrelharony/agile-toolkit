import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/**
 * Two links of a chain, snapped apart: their cut ends bent open, a few sparks
 * where they parted. For a link that doesn't lead anywhere (/s, /join).
 */
export const brokenLinkArt: InkDrawing = {
  name: "broken-link",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 30, seed: 351, tone: "accent2" }],
  strokes: [
    {
      d: "M41.6 42.4Q41 46.2 38 46.2L22.4 45.8A10 10 0 0 0 22.2 65.8L38.2 65.6Q41.2 65.8 42 69.4",
      w: 3.2,
    },
    { d: "M34.4 51.8L23 51.6A4.4 4.4 0 0 0 22.8 60.4L34.6 60.2", tone: "sub", w: 1.5 },
    {
      d: "M54.4 26.6Q55 30.4 58 30.4L73.6 30A10 10 0 0 1 73.8 50L58 50.2Q54.8 50.2 54.2 53.8",
      w: 3.2,
    },
    { d: "M61.6 35.8L73.4 35.6A4.4 4.4 0 0 1 73.6 44.4L61.4 44.6", tone: "sub", w: 1.5 },
    { d: "M46.6 38.4L45.8 32.2M41.4 39.4L37.4 35.6", tone: "warning", w: 1.8 },
    { d: "M49.6 57.8L50.4 64M54.8 56.8L58.8 60.6", tone: "warning", w: 1.8 },
    { d: "M12.6 84.4Q48 86.6 84.4 84", tone: "sub", w: 1.6 },
  ],
};
