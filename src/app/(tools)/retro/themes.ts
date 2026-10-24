/**
 * Common words across a retro board's cards: a plain, explainable stand-in
 * for the k-means "themes" the board used to show.
 *
 * The old clusters were built from each card's length, word count and its
 * "!" and "?" counts, so a "theme" grouped cards of a similar length, not a
 * similar subject, and the chips could only say "Theme 1: 4 cards". Here a
 * theme is a word (stop words dropped, light stemming so "tests" and
 * "testing" match) that two or more cards use, shown with the cards it
 * appears in. Naming the themes stays with the team, or with the AI prompt,
 * which gets these groups as data.
 */

import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import type { RetroCard } from "./types";

export interface KeywordTheme {
  /** The word as the cards spell it most often ("tests", not the stem "test"). */
  keyword: string;
  /** Top-level cards that use it, most-voted first. A card grouped under one counts with it. */
  cardIds: string[];
  /** Votes on those cards and the cards grouped under them. */
  votes: number;
}

/** Cards (a group counts once) before common words mean anything: the clustering bar. */
export const THEME_MIN_CARDS = MIN_SAMPLE.cluster;

/**
 * A word in at least this share of the cards says nothing about any of them
 * ("deploy" on a board about deploys), so it doesn't make a theme.
 */
const TOO_COMMON = 0.6;

/**
 * English stop words plus retro filler: words every column uses ("start",
 * "more", "better") that would otherwise top the list on every board.
 */
const STOP_WORDS = new Set(
  (
    "a about above after again against all also am an and any are aren as at be because been " +
    "before being below between both but by can cannot could couldn did didn do does doesn " +
    "doing don down during each few for from further had hadn has hasn have haven having he her " +
    "here hers herself him himself his how i if in into is isn it its itself just let me more " +
    "most mustn my myself no nor not now of off on once only or other ought our ours ourselves " +
    "out over own same shan she should shouldn so some such than that the their theirs them " +
    "themselves then there these they this those through to too under until up us very was " +
    "wasn we were weren what when where which while who whom why will with won would wouldn you " +
    "your yours yourself yourselves " +
    // Retro filler
    "start stop continue keep less lot lots really get got getting make made making need " +
    "needs needed use used using like liked good bad better worse thing things stuff way ways " +
    "time times sometimes always never still even much many every week weeks day days sprint " +
    "sprints team something anything everything nothing we're it's don't didn't can't"
  ).split(/\s+/)
);

/**
 * "testing" → "test", "stories" → "story", "merged" → "merg" (with "merge"
 * and "merges"). Prefix cuts, nothing clever: enough that a team's three
 * spellings of one word land together.
 */
export function stem(word: string): string {
  let t = word;
  let cut = false;
  if (t.endsWith("ies") && t.length > 4) t = `${t.slice(0, -3)}y`;
  else if (t.endsWith("ing") && t.length > 5) {
    t = t.slice(0, -3);
    cut = true;
  } else if (t.endsWith("ed") && !t.endsWith("eed") && t.length > 4) {
    t = t.slice(0, -2);
    cut = true;
  } else if (/(?:ss|sh|ch|x|z)es$/.test(t)) t = t.slice(0, -2);
  else if (t.endsWith("s") && !/(?:ss|us|is)$/.test(t) && t.length > 3) t = t.slice(0, -1);
  // "planned", "shipping": one of a doubled last consonant goes with the suffix.
  if (cut && /([b-df-hj-np-tv-z])\1$/.test(t) && !/(?:ll|ss|zz)$/.test(t)) t = t.slice(0, -1);
  if (t.length > 3 && t.endsWith("e")) t = t.slice(0, -1);
  return t;
}

/** The words of a card worth counting: lower-case, 3+ letters, stop words dropped. */
export function cardWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((w) => w.replace(/'s$/, "").replace(/^'+|'+$/g, ""))
    .filter((w) => w.length >= 3 && w.length <= 30 && !/^\d+$/.test(w) && !STOP_WORDS.has(w));
}

interface Item {
  /** The top-level card. */
  id: string;
  votes: number;
  /** Stem → the spellings this item used. */
  stems: Map<string, string[]>;
}

/**
 * The card at the top of `card`'s group: a group is one point the team made,
 * so its cards count together. A card grouped under a card that is gone (or
 * in a loop an import left behind) counts on its own.
 */
function topCardId(card: RetroCard, byId: ReadonlyMap<string, RetroCard>): string {
  let cur = card;
  const seen = new Set<string>([cur.id]);
  while (cur.groupedWith) {
    const parent = byId.get(cur.groupedWith);
    if (!parent || seen.has(parent.id)) return card.id;
    seen.add(parent.id);
    cur = parent;
  }
  return cur.id;
}

/** The board as items: each top-level card with the cards grouped under it. */
function boardItems(cards: readonly RetroCard[]): Item[] {
  const withText = cards.filter((c) => c.text.trim().length > 0);
  const byId = new Map(withText.map((c) => [c.id, c]));
  const items = new Map<string, Item>();
  for (const c of withText) {
    const top = topCardId(c, byId);
    let item = items.get(top);
    if (!item) {
      item = { id: top, votes: 0, stems: new Map() };
      items.set(top, item);
    }
    item.votes += Number.isFinite(c.votes) ? Math.max(0, c.votes) : 0;
    for (const word of cardWords(c.text)) {
      const s = stem(word);
      item.stems.set(s, [...(item.stems.get(s) ?? []), word]);
    }
  }
  return Array.from(items.values());
}

/** The spelling used most; ties go to the shorter, then the alphabetically first. */
function displayForm(forms: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const f of forms) counts.set(f, (counts.get(f) ?? 0) + 1);
  return Array.from(counts.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0])
  )[0][0];
}

/** Cards that count towards THEME_MIN_CARDS: cards with text, a group once. */
export function themeCardCount(cards: readonly RetroCard[]): number {
  return boardItems(cards).length;
}

/**
 * The board's common words, most cards first, then most votes. A word
 * makes a theme when two or more cards use it and fewer than 60% do; each
 * card joins at most one theme (the biggest it can), so the chips never
 * count a card twice.
 */
export function keywordThemes(
  cards: readonly RetroCard[],
  { maxThemes = 5 }: { maxThemes?: number } = {}
): KeywordTheme[] {
  const items = boardItems(cards);
  if (items.length < 2 || maxThemes <= 0) return [];
  const ceiling = items.length * TOO_COMMON;

  const byStem = new Map<string, Item[]>();
  for (const item of items) {
    item.stems.forEach((_, s) => byStem.set(s, [...(byStem.get(s) ?? []), item]));
  }
  // "Too common" is judged on the whole board, before any card is taken.
  const candidates = Array.from(byStem.entries()).filter(([, its]) => its.length < ceiling);

  const taken = new Set<string>();
  const out: KeywordTheme[] = [];
  while (out.length < maxThemes) {
    let best: { stem: string; items: Item[]; votes: number } | null = null;
    for (const [s, its] of candidates) {
      const free = its.filter((i) => !taken.has(i.id));
      if (free.length < 2) continue;
      const votes = free.reduce((sum, i) => sum + i.votes, 0);
      const better =
        !best ||
        free.length > best.items.length ||
        (free.length === best.items.length &&
          (votes > best.votes || (votes === best.votes && s < best.stem)));
      if (better) best = { stem: s, items: free, votes };
    }
    if (!best) break;
    const chosen = best;
    for (const i of chosen.items) taken.add(i.id);
    out.push({
      keyword: displayForm(chosen.items.flatMap((i) => i.stems.get(chosen.stem) ?? [])),
      cardIds: [...chosen.items].sort((a, b) => b.votes - a.votes).map((i) => i.id),
      votes: chosen.votes,
    });
  }
  return out;
}

/** The themes as the AI prompt takes them: each word with its cards' text. */
export function themesForPrompt(
  themes: readonly KeywordTheme[],
  cards: readonly RetroCard[]
): { keyword: string; cards: string[] }[] {
  const text = new Map(cards.map((c) => [c.id, c.text]));
  return themes.map((t) => ({
    keyword: t.keyword,
    cards: t.cardIds.map((id) => text.get(id) ?? "").filter(Boolean),
  }));
}
