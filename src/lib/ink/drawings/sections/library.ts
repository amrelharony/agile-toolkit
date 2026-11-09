import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

export const libraryArt: InkDrawing = {
  name: "library",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 60, rx: 40, ry: 30, seed: 101, tone: "moss" }],
  strokes: [
    { d: "M13.6 70.6L78.4 68.6L80.6 82.4L15.8 84.6Z", fill: "accent2" },
    { d: "M23.6 70.6L25.6 84M69.6 68.8L71.6 82.6", tone: "sub", w: 1.6 },
    { d: "M19.6 56.2L73.4 54.6L74.2 68.8L20.2 70.4Z", fill: "accent" },
    { d: "M28.4 56L29 70.2M64.4 54.8L65 69", tone: "sub", w: 1.6 },
    { d: "M60.4 69L60.4 77.6L63.2 75L66.2 77.4L66.2 68.8", tone: "accent", fill: "accent", w: 1.8 },
    { d: "M24.6 41.8L70.6 37.6L72.4 52.6L26 55.4Z", fill: "moss" },
    { d: "M33 41L34.4 55M62.2 38.4L63.6 53.4", tone: "sub", w: 1.6 },
    { d: "M36.6 47.4L54.8 46", tone: "sub", w: 1.4 },
    { d: "M60 37.6Q64 26 72 22.4Q76 31 71.6 37.4", tone: "moss", w: 2 },
    { d: "M66 35.4Q68.6 29.6 71.6 26.8", tone: "moss", w: 1.4 },
  ],
};
