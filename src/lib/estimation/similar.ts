/**
 * "Like this one": finished stories that read like the story being sized,
 * with the points they took, so a team can say "the refund export was a 5,
 * and this is about the same". When nothing finished reads like it, the
 * Estimation Guide's reference stories stand in.
 *
 * Words come from Retro's theme reader (`cardWords` and `stem`), so "refunds"
 * and "refund" match and filler words don't. A title word weighs 2, a word
 * in the first 300 characters of the notes 1, and two stories score by
 * weighted Jaccard (the shared weight over the combined weight). A match
 * needs at least one title word in common: notes alone are too loose.
 *
 * Story-specific on purpose: Bug Triage and idea intake keep their own
 * duplicate finders (lib/audience-wall/words). Pure: no React, no store, so
 * Amr's `tool.planning_poker.similar_stories` runs it on the server.
 */

import { cardWords, stem } from "@/app/(tools)/retro/themes";
import type { Story } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";

/** Matches shown by default. */
export const SIMILAR_LIMIT = 3;
/** The lowest score that counts as alike. */
export const SIMILAR_MIN_SCORE = 0.2;
/** How much of the notes is read. */
export const SIMILAR_NOTES_READ = 300;
/** Shared words shown per match. */
export const SIMILAR_SHARED_MAX = 3;
/** Reference stories shown when nothing finished reads alike. */
export const REFERENCE_HINT_MAX = 6;

/** The story being sized. */
export interface SimilarTarget {
  /** Left out of the pool, when it's a workspace story. */
  id?: string;
  title: string;
  notes?: string;
}

/** Anything with a title that can be compared: a story, or an AI candidate. */
export interface Comparable {
  id: string;
  title: string;
  notes?: string;
}

interface Weighted {
  /** Stem → weight: 2 for a title word, 1 for a word only in the notes. */
  weights: Map<string, number>;
  /** Stems of the title. */
  title: Set<string>;
  /** Stem → the first spelling used. */
  spelling: Map<string, string>;
}

function weigh(title: string, notes?: string): Weighted {
  const weights = new Map<string, number>();
  const titleStems = new Set<string>();
  const spelling = new Map<string, string>();
  for (const word of cardWords(title)) {
    const s = stem(word);
    titleStems.add(s);
    weights.set(s, 2);
    if (!spelling.has(s)) spelling.set(s, word);
  }
  for (const word of cardWords((notes ?? "").slice(0, SIMILAR_NOTES_READ))) {
    const s = stem(word);
    if (!weights.has(s)) weights.set(s, 1);
    if (!spelling.has(s)) spelling.set(s, word);
  }
  return { weights, title: titleStems, spelling };
}

export interface Scored<T> {
  item: T;
  score: number;
  /** Words both mention, as the story being sized spells them; title words first. */
  shared: string[];
}

function scoreAgainst<T extends Comparable>(target: Weighted, item: T): Scored<T> {
  const other = weigh(item.title, item.notes);
  let common = 0;
  let union = 0;
  const shared: { word: string; weight: number }[] = [];
  const stems = new Set([
    ...Array.from(target.weights.keys()),
    ...Array.from(other.weights.keys()),
  ]);
  stems.forEach((s) => {
    const a = target.weights.get(s) ?? 0;
    const b = other.weights.get(s) ?? 0;
    common += Math.min(a, b);
    union += Math.max(a, b);
    if (a > 0 && b > 0) shared.push({ word: target.spelling.get(s) ?? s, weight: a + b });
  });
  let titleShared = false;
  target.title.forEach((s) => {
    if (other.title.has(s)) titleShared = true;
  });
  const score = union > 0 && titleShared ? common / union : 0;
  return {
    item,
    score,
    shared: shared
      .sort((x, y) => y.weight - x.weight || x.word.localeCompare(y.word))
      .slice(0, SIMILAR_SHARED_MAX)
      .map((x) => x.word),
  };
}

/**
 * Every item scored against the target, best first (ties keep the items'
 * order). Items with no title word in common score 0.
 */
export function rankSimilar<T extends Comparable>(
  target: Pick<SimilarTarget, "title" | "notes">,
  items: readonly T[]
): Scored<T>[] {
  const t = weigh(target.title, target.notes);
  return items
    .map((item, i) => ({ s: scoreAgainst(t, item), i }))
    .sort((a, b) => b.s.score - a.s.score || a.i - b.i)
    .map(({ s }) => s);
}

/** Points worth comparing with: a positive, finite number. */
export function hasPoints(
  s: Pick<Story, "points">
): s is Pick<Story, "points"> & { points: number } {
  return typeof s.points === "number" && Number.isFinite(s.points) && s.points > 0;
}

/** The stories to compare with: done, with points and a title, not the example's, not the target. */
export function similarPool(target: SimilarTarget, stories: readonly Story[]): Story[] {
  return stories.filter(
    (s) =>
      s.status === "done" &&
      hasPoints(s) &&
      s.title.trim() !== "" &&
      !isExampleId(s.id) &&
      s.id !== target.id
  );
}

/** Newest finish first; stories with no done date last. */
function byRecentlyDone(a: Story, b: Story): number {
  const at = a.doneAt ?? "";
  const bt = b.doneAt ?? "";
  return at === bt ? 0 : at < bt ? 1 : -1;
}

export interface SimilarMatch {
  story: Story;
  score: number;
  shared: string[];
}

/**
 * Finished stories like the target: score at least `minScore`, best first,
 * then the most recently done.
 */
export function similarStories(
  target: SimilarTarget,
  stories: readonly Story[],
  {
    limit = SIMILAR_LIMIT,
    minScore = SIMILAR_MIN_SCORE,
  }: { limit?: number; minScore?: number } = {}
): SimilarMatch[] {
  if (limit <= 0 || target.title.trim() === "") return [];
  return rankSimilar(target, similarPool(target, stories))
    .filter((s) => s.score > 0 && s.score >= minScore)
    .sort((a, b) => b.score - a.score || byRecentlyDone(a.item, b.item))
    .slice(0, limit)
    .map(({ item, score, shared }) => ({ story: item, score, shared }));
}

/** The middle of the matches' points (the mean of the two middles for an even count). */
export function medianPoints(points: readonly number[]): number | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** One reference story pinned on a card, for the fallback line. */
export interface ReferenceHintItem {
  card: string;
  title: string;
  /** One of the guide's example stories, not the team's. */
  example: boolean;
}

/**
 * The Estimation Guide's pins on a deck's cards: `lookup` answers what a
 * card means there (Planning Poker's `CardReferenceLookup` fits).
 */
export interface ReferencePins {
  cards: readonly string[];
  lookup: (card: string) => { stories: readonly { title: string; example?: boolean }[] } | null;
}

export type SimilarHint =
  | { kind: "similar"; items: SimilarMatch[]; medianPoints: number }
  | { kind: "reference"; items: ReferenceHintItem[] }
  | { kind: "none" };

/** The guide's reference stories on the deck's cards, in deck order. */
export function referenceHintItems(refs: ReferencePins | undefined): ReferenceHintItem[] {
  if (!refs) return [];
  const out: ReferenceHintItem[] = [];
  for (const card of refs.cards) {
    for (const s of refs.lookup(card)?.stories ?? []) {
      if (out.length >= REFERENCE_HINT_MAX) return out;
      if (s.title.trim() !== "") out.push({ card, title: s.title, example: s.example === true });
    }
  }
  return out;
}

/**
 * What the hint shows: finished stories like this one with their median,
 * else the guide's reference stories, else nothing to compare with.
 */
export function similarHint(
  target: SimilarTarget,
  stories: readonly Story[],
  refs?: ReferencePins
): SimilarHint {
  const items = similarStories(target, stories);
  if (items.length > 0) {
    return {
      kind: "similar",
      items,
      medianPoints: medianPoints(items.map((m) => m.story.points ?? 0)) ?? 0,
    };
  }
  const references = referenceHintItems(refs);
  return references.length > 0 ? { kind: "reference", items: references } : { kind: "none" };
}

/**
 * What Amr gets to choose from: the `max` stories that score best (any
 * score above 0), then the most recently done, so a story with no word in
 * common can still be picked for meaning.
 */
export function aiCandidates(target: SimilarTarget, stories: readonly Story[], max = 40): Story[] {
  if (max <= 0) return [];
  const pool = similarPool(target, stories);
  const ranked = rankSimilar(target, pool)
    .filter((s) => s.score > 0)
    .map((s) => s.item);
  const picked = new Set(ranked.slice(0, max).map((s) => s.id));
  const recent = pool.filter((s) => !picked.has(s.id)).sort(byRecentlyDone);
  return [...ranked.slice(0, max), ...recent].slice(0, max);
}
