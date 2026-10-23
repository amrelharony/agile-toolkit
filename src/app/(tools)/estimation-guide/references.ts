/**
 * Estimation Guide: reference stories.
 *
 * A description says what an 8 means in words; a story the team already
 * finished at 8 says it in the team's own work, and that is what people
 * compare against when they pick a card. Each value can pin a few done
 * workspace stories, keyed like the entries ("Fibonacci:8" → story ids).
 * The guide suggests done stories with that many points; Planning Poker
 * shows the pins for the card being discussed, under the deck.
 *
 * Pins are ids, not copies, so a story renamed in Sprint Planning shows its
 * new title here. One that can't be found is skipped rather than pruned:
 * the guide's store can load before the workspace does, and pruning then
 * would drop every pin.
 */

import type { Story } from "@/lib/stores/workspace-types";
import { scales } from "@/lib/constants/scales";
import { isExampleId } from "@/components/tool-frame/example-data";
import { defaultDescription, entryKey, readEntry } from "./entries";
import { exampleReferenceStory } from "./example";
import type { EstimationGuideState } from "./store";

/** Pins per value: a reference, not a list of everything that size. */
export const MAX_REFERENCE_STORIES = 3;
/** Suggestions shown per value. */
export const MAX_SUGGESTIONS = 3;

type Pins = Record<string, string[]>;

export interface ReferenceStory {
  id: string;
  title: string;
  points?: number;
  /** One of the example's stories (not in the workspace). */
  example: boolean;
}

/** The ids pinned on a value; [] for none or a malformed stored entry. */
export function pinnedIds(map: unknown, scale: string, value: string | number): string[] {
  if (!map || typeof map !== "object" || Array.isArray(map)) return [];
  const raw = (map as Record<string, unknown>)[entryKey(scale, value)];
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && id !== "");
}

/**
 * `map` with `id` pinned on a value, last or at `at` (Undo puts an unpinned
 * story back in its place). Unchanged when it's there already or the value
 * is full.
 */
export function withPin(
  map: Pins,
  scale: string,
  value: string | number,
  id: string,
  at?: number
): Pins {
  const ids = pinnedIds(map, scale, value);
  if (!id || ids.includes(id) || ids.length >= MAX_REFERENCE_STORIES) return map;
  const next = [...ids];
  next.splice(at === undefined || at < 0 ? next.length : Math.min(at, next.length), 0, id);
  return { ...map, [entryKey(scale, value)]: next };
}

/** `map` without `id` on a value; the key goes when its last pin does. */
export function withoutPin(map: Pins, scale: string, value: string | number, id: string): Pins {
  const key = entryKey(scale, value);
  const ids = pinnedIds(map, scale, value);
  if (!ids.includes(id)) return map;
  const next = { ...map };
  const kept = ids.filter((x) => x !== id);
  if (kept.length > 0) next[key] = kept;
  else delete next[key];
  return next;
}

/** A card as story points: 8 → 8; a T-shirt size or "?" → null. */
export function pointsOf(value: string | number): number | null {
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return String(value).trim() !== "" && Number.isFinite(n) ? n : null;
}

/** Newest finish first; stories without a done date go last, then by title. */
function byRecentlyDone(a: Story, b: Story): number {
  const at = a.doneAt ?? "";
  const bt = b.doneAt ?? "";
  if (at !== bt) return at < bt ? 1 : -1;
  return a.title.localeCompare(b.title);
}

/**
 * Done stories worth pinning on `value`: the same number of points, not
 * pinned there already, most recently finished first. A T-shirt size has
 * none, since stories carry points, not sizes.
 */
export function suggestReferenceStories(
  stories: readonly Story[],
  value: string | number,
  pinned: readonly string[],
  limit = MAX_SUGGESTIONS
): Story[] {
  const points = pointsOf(value);
  if (points === null || limit <= 0) return [];
  return stories
    .filter(
      (s) =>
        s.status === "done" &&
        s.points === points &&
        s.title.trim() !== "" &&
        !pinned.includes(s.id) &&
        !isExampleId(s.id)
    )
    .sort(byRecentlyDone)
    .slice(0, limit);
}

/** The pinned ids as stories to show, in pin order; ids that match nothing are skipped. */
export function resolveReferenceStories(
  ids: readonly string[],
  stories: readonly Story[]
): ReferenceStory[] {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const out: ReferenceStory[] = [];
  for (const id of ids) {
    const story = byId.get(id);
    if (story) {
      out.push({ id, title: story.title, points: story.points, example: false });
      continue;
    }
    const ex = isExampleId(id) ? exampleReferenceStory(id) : undefined;
    if (ex) out.push({ id, title: ex.title, points: ex.points, example: true });
  }
  return out;
}

/** Whether the workspace has a done story worth suggesting on any value of the scale. */
export function hasSuggestions(stories: readonly Story[], values: readonly (string | number)[]) {
  return values.some((v) => suggestReferenceStories(stories, v, [], 1).length > 0);
}

/**
 * The guide scale a card belongs to: the first of `preferred` (the deck's
 * own scale, then the guide's selected one) that has the value, else any
 * scale that has it, else null (a custom card the guide doesn't cover).
 */
export function guideScaleFor(
  value: string | number,
  preferred: readonly (string | null | undefined)[]
): string | null {
  const has = (name: string) =>
    scales.some((s) => s.name === name && s.values.some((v) => String(v) === String(value)));
  for (const name of preferred) if (name && has(name)) return name;
  return scales.find((s) => s.values.some((v) => String(v) === String(value)))?.name ?? null;
}

/** What the guide says about one card: its meaning, the team example and the pinned stories. */
export interface CardReference {
  scale: string;
  value: string;
  description: string;
  example: string;
  stories: ReferenceStory[];
}

export type GuideEntries = Pick<
  EstimationGuideState,
  "descriptions" | "examples" | "referenceStoryIds"
>;

export function cardReference(
  guide: GuideEntries,
  scale: string,
  value: string | number,
  stories: readonly Story[]
): CardReference {
  return {
    scale,
    value: String(value),
    description: readEntry(
      guide.descriptions ?? {},
      scale,
      value,
      defaultDescription(value)
    ).trim(),
    example: readEntry(guide.examples ?? {}, scale, value).trim(),
    stories: resolveReferenceStories(pinnedIds(guide.referenceStoryIds, scale, value), stories),
  };
}
