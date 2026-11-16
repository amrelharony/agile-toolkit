import { turn } from "../../pen";
import { SPOT_VIEWBOX, type InkDrawing } from "../../types";

/** One playing card, drawn square on: the three in the fan are this card turned. */
const CARD =
  "M36.6 28.4L59.4 28.4Q62.6 28.4 62.6 31.6L62.6 74.4Q62.6 77.6 59.4 77.6L36.6 77.6Q33.4 77.6 33.4 74.4L33.4 31.6Q33.4 28.4 36.6 28.4Z";
/** A card back's printed panel, inside the card's edge. */
const BACK = "M38.6 33.6L57.4 33.4L57.6 72.4L38.4 72.6Z";

/** Card Decks: three cards fanned out in a hand, the top one showing a heart for an appreciation card. */
const art: InkDrawing = {
  name: "card-decks",
  viewBox: SPOT_VIEWBOX,
  washes: [{ cx: 48, cy: 52, rx: 40, ry: 34, seed: 4210, tone: "accent3" }],
  strokes: [
    { d: turn(CARD, -22, 48, 86), fill: "paper" },
    { d: turn(BACK, -22, 48, 86), tone: "accent2", fill: "accent2", w: 1.4 },
    { d: turn(CARD, 22, 48, 86), fill: "paper" },
    { d: turn(BACK, 22, 48, 86), tone: "accent", fill: "accent", w: 1.4 },
    { d: CARD, fill: "paper" },
    {
      d: "M48 48.8Q43.8 41.6 39.6 45.2Q35.6 49.2 39.6 54.4Q43 58.8 48 62.8Q53 58.8 56.4 54.4Q60.4 49.2 56.4 45.2Q52.2 41.6 48 48.8Z",
      tone: "danger",
      fill: "danger",
      w: 1.8,
    },
    { d: "M37.4 33.2L41.6 33.2M54.4 72.8L58.6 72.8", tone: "sub", w: 1.6 },
  ],
};

export default art;
