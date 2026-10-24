import type { SixHatsHat } from "@/lib/stores/workspace-types";

/**
 * The six hats: what each one looks at, and how it is drawn.
 *
 * Colours are theme tokens, never hex: the old light-grey White was
 * unreadable on the light themes and the mid-grey Black was faint on the
 * dark ones. The
 * hat's name is always written next to its colour, so colour is never the
 * only cue.
 */
export interface HatInfo {
  id: SixHatsHat;
  /** "White" */
  name: string;
  /** What the hat looks at: "Facts". */
  focus: string;
  /** The question the hat asks, shown under the thought form and the round. */
  hint: string;
  /** The hat's name colour. */
  text: string;
  /** Its column's left edge. */
  edge: string;
  /** A small swatch beside the name. */
  swatch: string;
}

export const HATS: readonly HatInfo[] = [
  {
    id: "white",
    name: "White",
    focus: "Facts",
    hint: "Just the data: what do we know, and what do we still need to find out?",
    text: "text-text",
    edge: "border-l-text/50",
    swatch: "border border-border bg-text/10",
  },
  {
    id: "red",
    name: "Red",
    focus: "Feelings",
    hint: "Gut reactions and hunches. No one has to justify them.",
    text: "text-danger",
    edge: "border-l-danger",
    swatch: "bg-danger",
  },
  {
    id: "black",
    name: "Black",
    focus: "Risks",
    hint: "What could go wrong? Cautions, weak points and downsides.",
    text: "text-sub",
    edge: "border-l-sub",
    swatch: "bg-sub",
  },
  {
    id: "yellow",
    name: "Yellow",
    focus: "Benefits",
    hint: "Why could this work? The value, and who gains from it.",
    text: "text-warning",
    edge: "border-l-warning",
    swatch: "bg-warning",
  },
  {
    id: "green",
    name: "Green",
    focus: "New ideas",
    hint: "Alternatives, what-ifs and wild ideas. No criticism yet.",
    text: "text-success",
    edge: "border-l-success",
    swatch: "bg-success",
  },
  {
    id: "blue",
    name: "Blue",
    focus: "Process",
    hint: "Manage the thinking: the question, the order of the hats, the summary and next steps.",
    text: "text-info",
    edge: "border-l-info",
    swatch: "bg-info",
  },
];

const BY_ID = new Map(HATS.map((h) => [h.id, h]));

export const HAT_IDS: readonly SixHatsHat[] = HATS.map((h) => h.id);

/** A stored hat value is one of the six (legacy rows and hand edits may carry others). */
export function isHat(value: unknown): value is SixHatsHat {
  return typeof value === "string" && BY_ID.has(value as SixHatsHat);
}

export function hatInfo(id: SixHatsHat): HatInfo {
  return BY_ID.get(id) ?? HATS[0];
}

/** "Black hat" */
export const hatName = (id: SixHatsHat): string => `${hatInfo(id).name} hat`;
