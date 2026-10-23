/**
 * The Estimation Guide's example: a checkout team's own words for each card,
 * and a few stories it finished that it now compares against.
 *
 * The built-in descriptions already show what a card can mean, so the
 * example fills in the part a new guide is missing: the team examples and
 * the pinned reference stories. It only fills cards that are still empty,
 * never over the team's own text.
 *
 * Example entries are recognised by value (a team example that still reads
 * exactly as the example wrote it) and example pins by their `example-` id,
 * so "Clear example" removes exactly those and keeps anything the team
 * wrote or pinned. The reference stories here live only in this module:
 * they are never written into the workspace's stories.
 */

import { exampleId, isExampleId } from "@/components/tool-frame/example-data";
import type { EstimationScale } from "@/lib/constants/scales";
import { entryKey } from "./entries";

/** A team example per card, by bare value, for every scale's values. */
export const EXAMPLE_NOTES: Readonly<Record<string, string>> = {
  "1": "Change the wording of the order-confirmation email.",
  "2": "Add a “Copy order number” button to the receipt screen.",
  "3": "Show the card brand logo next to each saved card.",
  "4": "Remember the last delivery address on the shipping form.",
  "5": "Apply a promo code at checkout, with its error messages.",
  "6": "Split the payment step into card and wallet tabs.",
  "7": "Email a PDF receipt after every order.",
  "8": "Retry a declined card once, following the bank's retry rules.",
  "9": "Keep a signed-in shopper's cart across devices.",
  "10": "Guest checkout without creating an account.",
  "13": "Add a second payment provider behind the existing checkout.",
  "16": "Partial refunds, on the web and in the app.",
  "21": "Move checkout onto the new pricing service. Split it before planning.",
  "32": "Checkout for a second country: tax, currency, address formats. Split it.",
  XS: "Fix a typo on the payment screen.",
  S: "Add a “Copy order number” button to the receipt.",
  M: "Apply a promo code at checkout, with its error messages.",
  L: "Retry a declined card once, following the bank's retry rules.",
  XL: "Add a second payment provider behind the existing checkout.",
  XXL: "Checkout for a second country. Split it before planning.",
};

export interface ExampleReferenceStory {
  id: string;
  title: string;
  points: number;
}

/**
 * Stories the example team finished, as reference stories. Three of them
 * are the stories the Planning Poker example estimates, so the two
 * examples read as the same team.
 */
export const EXAMPLE_REFERENCE_STORIES: readonly ExampleReferenceStory[] = [
  { id: exampleId("guide-ref-1"), title: "Rename “Buy now” to “Place order”", points: 1 },
  { id: exampleId("guide-ref-2"), title: "Fix totals rounding on discounted orders", points: 2 },
  { id: exampleId("guide-ref-3"), title: "Show saved cards at checkout", points: 3 },
  { id: exampleId("guide-ref-5"), title: "Promo codes at checkout", points: 5 },
  { id: exampleId("guide-ref-8"), title: "Retry failed card payments", points: 8 },
  { id: exampleId("guide-ref-13"), title: "Pay by bank transfer", points: 13 },
];

export function exampleReferenceStory(id: string): ExampleReferenceStory | undefined {
  return EXAMPLE_REFERENCE_STORIES.find((s) => s.id === id);
}

type Entries = Record<string, string>;
type Pins = Record<string, string[]>;

export interface ExampleMaps {
  examples: Entries;
  referenceStoryIds: Pins;
}

const exampleNote = (value: string | number) => EXAMPLE_NOTES[String(value)];

/**
 * The example on `scale`'s empty cards: a team example where the card has
 * none, and the example reference stories with that many points where the
 * card has no pins. Cards the team already filled in are left alone.
 */
export function withExample(maps: ExampleMaps, scale: EstimationScale): ExampleMaps {
  const examples = { ...maps.examples };
  const referenceStoryIds = { ...maps.referenceStoryIds };
  for (const v of scale.values) {
    const key = entryKey(scale.name, v);
    const note = exampleNote(v);
    if (note && !(examples[key] ?? "").trim()) examples[key] = note;
    const refs = EXAMPLE_REFERENCE_STORIES.filter((s) => String(s.points) === String(v));
    if (refs.length > 0 && (referenceStoryIds[key] ?? []).length === 0) {
      referenceStoryIds[key] = refs.map((s) => s.id);
    }
  }
  return { examples, referenceStoryIds };
}

/** The value a per-scale key belongs to ("Fibonacci:8" → "8"), or null for a bare key. */
function valueOfKey(key: string): string | null {
  const i = key.indexOf(":");
  return i === -1 ? null : key.slice(i + 1);
}

/**
 * A team example (per-scale key, "Fibonacci:8") that still reads exactly as
 * the example wrote it. Exported so whatever else reads the guide's
 * examples (Planning Poker, the Team charter) can tell example data from
 * the team's own words.
 */
export function isExampleNote(key: string, text: string): boolean {
  const v = valueOfKey(key);
  return v !== null && exampleNote(v) === text;
}

/**
 * Whether example text or an example pin is still there: on `scale` when
 * given (the notice above the cards speaks for the scale on screen), else
 * on any scale.
 */
export function hasExample(maps: ExampleMaps, scale?: EstimationScale): boolean {
  const keys = scale ? new Set(scale.values.map((v) => entryKey(scale.name, v))) : null;
  const inScope = (key: string) => keys === null || keys.has(key);
  return (
    Object.entries(maps.examples ?? {}).some(([k, t]) => inScope(k) && isExampleNote(k, t)) ||
    Object.entries(maps.referenceStoryIds ?? {}).some(
      ([k, ids]) => inScope(k) && Array.isArray(ids) && ids.some((id) => isExampleId(id))
    )
  );
}

/** Every scale without the example's text and pins; the team's own entries stay. */
export function withoutExample(maps: ExampleMaps): ExampleMaps {
  const examples: Entries = {};
  for (const [k, t] of Object.entries(maps.examples ?? {})) {
    if (!isExampleNote(k, t)) examples[k] = t;
  }
  const referenceStoryIds: Pins = {};
  for (const [k, ids] of Object.entries(maps.referenceStoryIds ?? {})) {
    if (!Array.isArray(ids)) continue;
    const kept = ids.filter((id) => !isExampleId(id));
    if (kept.length > 0) referenceStoryIds[k] = kept;
  }
  return { examples, referenceStoryIds };
}
