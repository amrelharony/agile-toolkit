/**
 * Retro board — pure helpers (id/timer formatting, vote sorting, per-person
 * vote budgets, card delete and its undo, theme clustering features, the
 * JSON export). No React, no side effects beyond `crypto.randomUUID()` —
 * kept framework-free so they stay trivially testable and shareable between
 * the board and its export path.
 */

import type { BoardState, RetroCard } from "./types";

export function makeId() {
  return crypto.randomUUID();
}

export function formatTimer(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/** Tailwind grid classes for a board with `count` columns. */
export function columnGridClass(count: number): string {
  return count <= 2
    ? "grid-cols-1 sm:grid-cols-2"
    : count === 3
      ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
      : count === 4
        ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
        : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";
}

export function sortedByVotes(cards: RetroCard[]) {
  return [...cards].sort((a, b) => b.votes - a.votes);
}

// ── Facilitator mode: per-person votes ──────────────────────────────

/** Trimmed, case-insensitive name for matching voters. */
function voterMatch(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The `votesBy` key that holds `name`'s votes: an existing key that matches
 * it ignoring case and spaces, else the trimmed name.
 */
export function voterKey(votesBy: Record<string, number> | undefined, name: string): string {
  const want = voterMatch(name);
  return Object.keys(votesBy ?? {}).find((k) => voterMatch(k) === want) ?? name.trim();
}

/** Votes `name` has cast on this board. */
export function votesCastBy(votesBy: Record<string, number> | undefined, name: string): number {
  const n = votesBy?.[voterKey(votesBy, name)];
  return typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : 0;
}

/**
 * Everyone who can vote: the team roster first, then the names on the board
 * (added by hand, or who voted before the roster changed). One entry per
 * person, matched ignoring case.
 */
export function voterNames(roster: readonly string[], votesBy?: Record<string, number>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...roster, ...Object.keys(votesBy ?? {})]) {
    const name = raw.trim();
    const key = voterMatch(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** The board with every person's votes dropped (Clear Board). */
export function withoutVotesBy(board: BoardState): BoardState {
  const next = { ...board };
  delete next.votesBy;
  return next;
}

/**
 * Delete a card along with every card grouped under it, and unhook any
 * survivor that pointed at a removed card (exports and the AI prompt trip
 * over a dangling `groupedWith`). `removed` is what Undo has to put back.
 */
export function removeCardWithGroup(
  cards: RetroCard[],
  id: string
): { cards: RetroCard[]; removed: Set<string> } {
  const removed = new Set<string>([id]);
  for (const c of cards) if (c.groupedWith === id) removed.add(c.id);
  return {
    cards: cards
      .filter((c) => !removed.has(c.id))
      .map((c) => (c.groupedWith && removed.has(c.groupedWith) ? { ...c, groupedWith: null } : c)),
    removed,
  };
}

/**
 * Undo for `removeCardWithGroup`: put the removed cards back at their old
 * positions (from `snapshot`, the cards before the delete) and re-hook the
 * survivors that were unhooked from them. Edits made since are kept, cards
 * added since stay at the end, and cards deleted since stay deleted.
 */
export function restoreRemovedCards(
  current: RetroCard[],
  snapshot: RetroCard[],
  removed: Set<string>
): RetroCard[] {
  const live = new Map(current.map((c) => [c.id, c]));
  const out: RetroCard[] = [];
  for (const before of snapshot) {
    const now = live.get(before.id);
    if (removed.has(before.id)) {
      out.push(now ?? before);
    } else if (now) {
      const unhooked =
        before.groupedWith !== null && removed.has(before.groupedWith) && now.groupedWith === null;
      out.push(unhooked ? { ...now, groupedWith: before.groupedWith } : now);
    }
    live.delete(before.id);
  }
  return [...out, ...current.filter((c) => live.has(c.id))];
}

// Minimum cards before we attempt theme clustering — below this k-means
// produces noise (each "cluster" is a card or two).
export const CLUSTER_MIN_CARDS = 30;

// Color palette for cluster badges. Index by cluster id; cycles past the
// length so a stray higher k still gets a colour. Keep in sync with the
// retro tool's neon palette so the chips read as part of the page.
export const CLUSTER_COLORS = ["#00e1ff", "#ff00aa", "#00ff88", "#ffaa00", "#8b5cf6", "#ef4444"];

/**
 * Lightweight 4-feature vectorization for retro cards. Intentionally
 * simple — no stemming, no stopwords — so clusters are deterministic and
 * fast to compute client-side. Features:
 *   1. length / 100      — verbosity
 *   2. wordCount / 20    — content density
 *   3. exclamationCount  — affective intensity
 *   4. questionCount     — uncertainty / curiosity
 */
export function extractCardFeatures(text: string): number[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let exclamations = 0;
  let questions = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 33)
      exclamations++; // !
    else if (ch === 63) questions++; // ?
  }
  // Affective/curiosity features are clipped to [0,1] so they don't
  // dominate Euclidean distance over the loosely-bounded length/words
  // axes — small/raw integer counts otherwise pull all variance.
  return [
    text.length / 100,
    words.length / 20,
    Math.min(1, exclamations / 5),
    Math.min(1, questions / 5),
  ];
}

export function buildExportJson(state: Pick<BoardState, "format" | "cards">) {
  return {
    format: state.format.name,
    date: new Date().toISOString(),
    columns: state.format.columns.map((col) => ({
      label: col.label,
      cards: state.cards
        .filter((c) => c.columnKey === col.key)
        .map((c) => ({
          text: c.text,
          votes: c.votes,
          isActionItem: c.isActionItem,
          assignee: c.assignee || undefined,
        })),
    })),
  };
}
