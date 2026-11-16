/**
 * Audience Wall's word work, without AI: the word cloud, the keyword
 * groups that stand in for Amr's themes, and the near-duplicate questions
 * that stand in for his merges. Pure and server-safe.
 *
 * It reuses Retro's word rules (`cardWords`, `stem`, `keywordThemes` in
 * retro/themes.ts: stop words dropped, light stemming, a word on 60% of the
 * posts says nothing), plus a few words that answers to a room's question
 * use whatever it was.
 */

import { cardWords, keywordThemes, stem } from "@/app/(tools)/retro/themes";
import type { RetroCard } from "@/app/(tools)/retro/types";

/** Filler common in a room's answers and questions, on top of Retro's stop words. */
export const WALL_STOP_WORDS: ReadonlySet<string> = new Set([
  "think",
  "thinking",
  "maybe",
  "would",
  "could",
  "should",
  "want",
  "wants",
  "wish",
  "feel",
  "feels",
  "felt",
  "yes",
  "yeah",
  "okay",
  "one",
  "two",
  "bit",
  "kind",
  "sort",
  "just",
  "really",
  "please",
  "thanks",
  "question",
  "questions",
  "answer",
  "idea",
  "ideas",
  "people",
  "able",
  "else",
  "another",
  "around",
  "everyone",
  "someone",
  "anyone",
]);

/** The words of a post worth counting: Retro's rules, then the wall's own filler. */
export function postWords(text: string): string[] {
  return cardWords(text).filter((w) => !WALL_STOP_WORDS.has(w));
}

export interface CloudWord {
  /** The spelling the posts use most. */
  word: string;
  /** Posts that use it (a post counts once). */
  count: number;
  /** 1 (smallest) to 5 (biggest), from the count. */
  weight: 1 | 2 | 3 | 4 | 5;
}

/**
 * The word cloud: each word with the number of posts that use it (one
 * spelling family per stem), biggest first, ties alphabetical. Words used
 * once show only when nothing is used twice.
 */
export function wordCloud(
  texts: readonly string[],
  { max = 40 }: { max?: number } = {}
): CloudWord[] {
  const byStem = new Map<string, { posts: number; forms: Map<string, number> }>();
  for (const text of texts) {
    const seen = new Set<string>();
    for (const w of postWords(text)) {
      const s = stem(w);
      const entry = byStem.get(s) ?? { posts: 0, forms: new Map<string, number>() };
      entry.forms.set(w, (entry.forms.get(w) ?? 0) + 1);
      if (!seen.has(s)) {
        entry.posts += 1;
        seen.add(s);
      }
      byStem.set(s, entry);
    }
  }
  const words = Array.from(byStem.values()).map((e) => ({
    word: Array.from(e.forms.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0])
    )[0][0],
    count: e.posts,
  }));
  const repeated = words.filter((w) => w.count > 1);
  const shown = (repeated.length > 0 ? repeated : words)
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, Math.max(0, max));
  const top = shown[0]?.count ?? 1;
  const low = shown[shown.length - 1]?.count ?? 1;
  return shown.map((w) => ({
    ...w,
    weight:
      top === low
        ? 3
        : (Math.min(5, Math.max(1, 1 + Math.round(((w.count - low) / (top - low)) * 4))) as
            | 1
            | 2
            | 3
            | 4
            | 5),
  }));
}

/** A post as the word helpers take it. */
export interface WordPost {
  id: string;
  text: string;
  votes?: number;
}

/** A group of posts that share a word: the cluster fallback. */
export interface KeywordGroup {
  name: string;
  postIds: string[];
}

/**
 * Posts grouped by a word they share (Retro's keywordThemes on the posts):
 * each post in one group at most, the biggest groups first. The name is
 * the word, capitalised.
 */
export function keywordGroups(
  posts: readonly WordPost[],
  { maxGroups = 8 }: { maxGroups?: number } = {}
): KeywordGroup[] {
  const cards: RetroCard[] = posts.map((p) => ({
    id: p.id,
    columnKey: "wall",
    // Only the wall's own filler is taken out first; Retro drops the rest.
    text: postWords(p.text).join(" "),
    votes: p.votes ?? 0,
    groupedWith: null,
    isActionItem: false,
    assignee: "",
    discussing: false,
  }));
  return keywordThemes(cards, { maxThemes: maxGroups }).map((t) => ({
    name: t.keyword.charAt(0).toUpperCase() + t.keyword.slice(1),
    postIds: t.cardIds,
  }));
}

/** A post's words as a set of stems. */
function stems(text: string): Set<string> {
  return new Set(postWords(text).map(stem));
}

/** Anything but a letter (any script), a digit or a space. Built at run time: the `u` flag is beyond the TS target. */
const NOT_TEXT = new RegExp("[^\\p{L}\\p{N}\\s]+", "gu");

/** Text with case, punctuation and spacing taken out: "How do we deploy?" → "how do we deploy". */
function plain(text: string): string {
  return text.toLowerCase().replace(NOT_TEXT, " ").replace(/\s+/g, " ").trim();
}

export interface DuplicateGroup {
  /** The post that stays (the most upvoted of the group, then the first). */
  keep: string;
  /** The posts that go under it. */
  merge: string[];
}

/**
 * Near-duplicate posts, the merge fallback: the same words once case and
 * punctuation are gone, or at least 60% of their counted words in common
 * (two words or more each). Each post joins one group at most.
 */
export function duplicateGroups(
  posts: readonly WordPost[],
  { overlap = 0.6, maxMerged = 10 }: { overlap?: number; maxMerged?: number } = {}
): DuplicateGroup[] {
  const info = posts.map((p) => ({ p, plain: plain(p.text), stems: stems(p.text) }));
  const taken = new Set<string>();
  const out: DuplicateGroup[] = [];
  const order = [...info].sort((a, b) => (b.p.votes ?? 0) - (a.p.votes ?? 0));
  for (const a of order) {
    if (taken.has(a.p.id)) continue;
    const merge: string[] = [];
    for (const b of order) {
      if (b === a || taken.has(b.p.id) || merge.length >= maxMerged) continue;
      const same = a.plain !== "" && a.plain === b.plain;
      let close = false;
      if (!same && a.stems.size >= 2 && b.stems.size >= 2) {
        let shared = 0;
        a.stems.forEach((s) => {
          if (b.stems.has(s)) shared += 1;
        });
        close = shared / Math.max(a.stems.size, b.stems.size) >= overlap;
      }
      if (same || close) merge.push(b.p.id);
    }
    if (merge.length === 0) continue;
    taken.add(a.p.id);
    merge.forEach((id) => taken.add(id));
    out.push({ keep: a.p.id, merge });
  }
  return out;
}
