/**
 * Card colours.
 *
 * A card stores its colour as the hex value the map has always saved (older
 * maps, the example and `tool.story_mapper.add_card` all send these), so the
 * stored value is an id, never painted. What's painted is a theme token: the
 * fixed hex was the same neon in every theme and washed out on the light one.
 * A colour from outside this list (a hand-edited map) is kept as stored and
 * drawn in the neutral tone.
 */
export interface CardColor {
  /** The stored value. */
  value: string;
  label: string;
  /** The dot on the card and the colour picker's swatch. */
  dot: string;
  /** The card's tinted border. */
  border: string;
}

export const CARD_COLORS: readonly CardColor[] = [
  { value: "#00f0ff", label: "Cyan", dot: "bg-accent", border: "border-accent/30" },
  { value: "#a78bfa", label: "Purple", dot: "bg-accent-3", border: "border-accent-3/30" },
  { value: "#34d399", label: "Green", dot: "bg-accent-green", border: "border-accent-green/30" },
  { value: "#fb923c", label: "Orange", dot: "bg-accent-amber", border: "border-accent-amber/30" },
  {
    value: "#f472b6",
    label: "Pink",
    dot: "bg-accent-magenta",
    border: "border-accent-magenta/30",
  },
];

/** New cards start cyan, as they always have. */
export const DEFAULT_CARD_COLOR = CARD_COLORS[0].value;

const NEUTRAL: CardColor = { value: "", label: "Other", dot: "bg-sub", border: "border-border" };

/** How a stored colour is drawn; unknown values get the neutral tone. */
export function cardColor(value: string | undefined): CardColor {
  const v = (value ?? "").trim().toLowerCase();
  return CARD_COLORS.find((c) => c.value === v) ?? NEUTRAL;
}
