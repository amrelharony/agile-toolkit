import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** ADKAR Change Tracker: five stage chevrons, ticks over the three passed, a pin marking the barrier at the fourth. */
const art: InkDrawing = {
  name: "adkar",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 32, seed: 2581, tone: "plum" }],
  strokes: [
    { d: "M8.4 43.2L19.2 43L28 61L19.2 79L8.2 79.2Q7.6 61 8.4 43.2Z", fill: "plum" },
    { d: "M23 43L34 43.2L43 61L34 79L23 79.2L32 61Z", fill: "plum" },
    { d: "M38 43.2L49 43L58 61L49.2 79L38 78.8L47 61Z", fill: "plum" },
    { d: "M53 43L64 43.2L73 61L64 79.2L53.2 79L62 61Z", fill: "paper" },
    { d: "M68 43.2L79 43L88 61L79 79L68 79.2L77 61Z", fill: "paper" },
    { d: "M13.6 32.6L16.8 36L22.4 29M28.6 32.6L31.8 36L37.4 29M43.6 32.6L46.8 36L52.4 29", w: 2.4 },
    {
      d: "M63 39.6Q55.2 30.6 55.4 25.2Q55.8 17.6 63 17.4Q70.2 17.6 70.6 25.2Q70.8 30.6 63 39.6Z",
      tone: "accent",
      w: 2.2,
      fill: "accent",
    },
    {
      d: ring(63, 25, 2.6, 2.6, -2),
      tone: "accent",
      w: 1.8,
      fill: "paper",
      fillD: disc(63, 25, 2.6),
    },
  ],
};

export default art;
