import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** SPACE Pulse: a pulse read-out over five rating sliders, one per SPACE dimension, set to different levels. */
const art: InkDrawing = {
  name: "space-pulse",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 50, rx: 40, ry: 35, seed: 2371, tone: "plum" }],
  strokes: [
    {
      d: "M15.4 16.4Q48 15 80.8 16.2Q85 16.6 85 20.8L84.6 77.8Q84.4 82.2 80.2 82.2L15.8 82.6Q11.4 82.4 11.4 78L11.8 20.6Q12 16.6 15.4 16.4Z",
      fill: "paper",
    },
    { d: "M18.6 21.4Q48 20.6 77.6 21.2L77.4 33.6Q48 34.2 18.8 33.8Z", w: 1.8, fill: "plum" },
    {
      d: "M23.6 41Q23.2 58 23.8 75M35.8 41Q36.2 58 35.6 75M48 41Q47.6 58 48.2 75M60.2 41Q60.6 58 60 75M72.4 41Q72 58 72.6 75",
      tone: "sub",
      w: 1.6,
    },
    {
      d: "M18.8 59L28.6 58.8L28.8 65.2L18.6 65.2ZM31 45L40.8 44.8L41 51.2L30.8 51.2ZM43.2 65L53 64.8L53.2 71.2L43 71.2ZM55.4 51L65.2 50.8L65.4 57.2L55.2 57.2ZM67.6 41L77.4 40.8L77.6 47.2L67.4 47.2Z",
      w: 2,
      fill: "paper",
    },
    {
      d: "M22.4 27.8Q29 27.4 35.6 27.8L39.2 23.4L43.4 31.6L46.8 25.2L49.6 27.8Q62 27.2 73.6 27.8",
      tone: "accent",
      w: 2.2,
    },
  ],
};

export default art;
