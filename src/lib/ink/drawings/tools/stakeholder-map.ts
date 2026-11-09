import { disc, ring } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** Stakeholder Map: people placed on an interest-by-authority grid, one being moved up into the manage-closely corner. */
const art: InkDrawing = {
  name: "stakeholder-map",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 50, cy: 48, rx: 40, ry: 36, seed: 2574, tone: "plum" }],
  strokes: [
    { d: "M15.2 86Q14.4 50 15.4 12.4M11 18L15.4 11.6L19.8 18", w: 2.4 },
    { d: "M12.4 83.6Q50 84.4 86.4 83.4M80.4 79.2L87 83.4L80.4 87.6", w: 2.4 },
    {
      d: "M51 15.6L51.2 21.6M51.2 26.6L51 32.6M51 37.6L51.2 43.6M51.2 52.6L51 58.6M51 63.6L51.2 69.6M51.2 74.6L51 80.6M19.6 48.2L25.6 48M30.6 48L36.6 48.2M41.6 48.2L47.6 48M54.6 48L60.6 48.2M65.6 48.2L71.6 48M76.6 48L82.6 48.2",
      tone: "sub",
      w: 1.6,
    },
    {
      d: `${ring(33, 25, 4.4)}M25.8 39.6Q26.2 32 33 31.8Q39.8 32 40.2 39.6`,
      w: 2,
      fill: "paper",
      fillD: `${disc(33, 25, 4.4)}M25.8 39.6Q26.2 32 33 31.8Q39.8 32 40.2 39.6Z`,
    },
    {
      d: `${ring(33, 62, 4.4, 4.4, -2)}M25.8 76.6Q26.2 69 33 68.8Q39.8 69 40.2 76.6`,
      w: 2,
      fill: "paper",
      fillD: `${disc(33, 62, 4.4)}M25.8 76.6Q26.2 69 33 68.8Q39.8 69 40.2 76.6Z`,
    },
    {
      d: `${ring(69, 61, 4.4, 4.4, -2.6)}M61.8 75.6Q62.2 68 69 67.8Q75.8 68 76.2 75.6`,
      w: 2,
      fill: "paper",
      fillD: `${disc(69, 61, 4.4)}M61.8 75.6Q62.2 68 69 67.8Q75.8 68 76.2 75.6Z`,
    },
    {
      d: `${ring(69, 23.4, 5)}M60.8 39.6Q61.4 31 69 30.8Q76.6 31 77.2 39.6`,
      tone: "accent",
      w: 2.2,
      fill: "accent",
      fillD: `${disc(69, 23.4, 5)}M60.8 39.6Q61.4 31 69 30.8Q76.6 31 77.2 39.6Z`,
    },
    { d: "M80.4 66Q87 53 81.2 42.4M79.4 47.4L81 42L86 44.6", tone: "accent", w: 2 },
  ],
};

export default art;
