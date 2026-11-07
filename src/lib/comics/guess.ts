/**
 * A weekly story's guess, its "Try it this week" line, the drafts an import
 * brings in for the owner to approve, and the anonymous tap totals. Pure, for
 * the portal, the owner and public routes, and the pages alike.
 *
 * The guess comes before the last panel: the reader picks what happens next,
 * then the panel shows and so does how other readers picked. It isn't a test,
 * so there is no "right" or "wrong", only what happened. Wording rules for
 * anyone writing one (the drafts included): no option mocks a character or the
 * reader, every option is something a real colleague might do, and Amr is a
 * tentative, fallible colleague, never the hero who saves the day.
 *
 * Everything here lives in the columns migration 0035 adds, read apart from the
 * story, so a story page works the same before that migration runs.
 */

import { cleanText, pickableTool } from "./extras";

export interface StoryGuess {
  question: string;
  /** Two to four. */
  options: string[];
  /** The option the last panel shows. */
  happened: number;
  /** A line shown after the reveal. Optional. */
  note?: string;
}

export const GUESS_LIMITS = {
  minOptions: 2,
  maxOptions: 4,
  question: 140,
  option: 120,
  note: 280,
} as const;

/** Mirrors comic_stories_try_action_check. */
export const TRY_ACTION_MAX = 160;

/** Under the database's 4,000 bytes, with room for how jsonb spaces what it stores. */
export const GUESS_MAX_BYTES = 3_500;

export const DEFAULT_GUESS_QUESTION = "What happens next?";

export interface StoryGuessExtras {
  guess: StoryGuess | null;
  tryAction: string | null;
}

export const NO_GUESS: StoryGuessExtras = { guess: null, tryAction: null };

const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/** A stored guess, as a page shows it: null unless it's whole. */
export function readGuess(raw: unknown): StoryGuess | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const g = raw as Record<string, unknown>;
  const question = cleanText(g.question, GUESS_LIMITS.question);
  if (!question || !Array.isArray(g.options)) return null;
  if (g.options.length < GUESS_LIMITS.minOptions || g.options.length > GUESS_LIMITS.maxOptions) {
    return null;
  }
  const options = g.options.map((o) => cleanText(o, GUESS_LIMITS.option));
  if (options.some((o) => o === null)) return null;
  // Two options alike would split one idea's votes in two.
  if (new Set(options.map((o) => o!.toLowerCase())).size !== options.length) return null;
  const happened = g.happened;
  if (typeof happened !== "number" || !Number.isInteger(happened)) return null;
  if (happened < 0 || happened >= options.length) return null;
  const note =
    g.note === undefined || g.note === null || g.note === ""
      ? undefined
      : cleanText(g.note, GUESS_LIMITS.note);
  if (note === null) return null;
  return { question, options: options as string[], happened, ...(note ? { note } : {}) };
}

export function readTryAction(raw: unknown): string | null {
  return cleanText(raw, TRY_ACTION_MAX);
}

/** What an import drafted for one story, waiting for the owner. */
export interface GuessDraft {
  guess: StoryGuess | null;
  tryAction: string | null;
  /** A main tool's id, or null. */
  tryTool: string | null;
}

/**
 * A stored draft, keeping only the parts that pass the same checks as the live
 * columns. Null when nothing in it is usable.
 */
export function readGuessDraft(raw: unknown): GuessDraft | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  const guess = readGuess(d.guess);
  const tryAction = readTryAction(d.tryAction);
  const tryTool = typeof d.tryTool === "string" && pickableTool(d.tryTool) ? d.tryTool : null;
  return guess || tryAction || tryTool ? { guess, tryAction, tryTool } : null;
}

export type GuessCheck =
  | { ok: true; guess: StoryGuess | null; tryAction: string | null; tryTool?: string | null }
  | { ok: false; field: "guess" | "tryAction" | "tryTool" };

/**
 * The owner route's check on what the portal sends: guess and tryAction, each
 * null to clear it, and optionally tryTool, which approving a draft sets.
 */
export function checkGuess(body: unknown): GuessCheck {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  let guess: StoryGuess | null = null;
  if (b.guess !== null && b.guess !== undefined) {
    guess = readGuess(b.guess);
    if (!guess || byteLength(guess) > GUESS_MAX_BYTES) return { ok: false, field: "guess" };
  }
  let tryAction: string | null = null;
  if (b.tryAction !== null && b.tryAction !== undefined && b.tryAction !== "") {
    tryAction = readTryAction(b.tryAction);
    if (!tryAction) return { ok: false, field: "tryAction" };
  }
  if (b.tryTool === undefined) return { ok: true, guess, tryAction };
  if (b.tryTool !== null && (typeof b.tryTool !== "string" || !pickableTool(b.tryTool))) {
    return { ok: false, field: "tryTool" };
  }
  return { ok: true, guess, tryAction, tryTool: b.tryTool as string | null };
}

// ── Taps ───────────────────────────────────────────────────────────────

export type TapKind = "guess" | "seen";

/** "Yes, I've seen this" and "Not yet", in that order. */
export const SEEN_OPTIONS = ["Yes, I've seen this", "Not yet"] as const;

/** Under this many taps a share would say more about one reader than about readers. */
export const SHOW_SHARES_AT = 20;

/** How many choices a kind has for a story with this guess. */
export function choicesFor(kind: TapKind, guess: StoryGuess | null): number {
  if (kind === "seen") return SEEN_OPTIONS.length;
  return guess ? guess.options.length : 0;
}

export interface TapBody {
  ep: number;
  kind: TapKind;
  choice: number;
}

/** What the public route accepts, before it checks the story itself. */
export function parseTap(raw: unknown): TapBody | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { ep, kind, choice } = raw as Record<string, unknown>;
  if (typeof ep !== "number" || !Number.isInteger(ep) || ep < 27 || ep > 999) return null;
  if (kind !== "guess" && kind !== "seen") return null;
  if (typeof choice !== "number" || !Number.isInteger(choice) || choice < 0 || choice > 3) {
    return null;
  }
  return { ep, kind, choice };
}

/** Rows from comic_story_tap or the table, as one count per choice. */
export function tapCounts(
  rows: readonly { choice: number; count: number | string }[],
  size: number
): number[] {
  const counts = Array.from({ length: size }, () => 0);
  for (const row of rows) {
    const n = Number(row.count);
    if (Number.isInteger(row.choice) && row.choice >= 0 && row.choice < size && n > 0) {
      counts[row.choice] = n;
    }
  }
  return counts;
}

/**
 * Whole percentages that add up to 100 (largest remainder), or null under
 * SHOW_SHARES_AT taps in all.
 */
export function shares(counts: readonly number[]): number[] | null {
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total < SHOW_SHARES_AT) return null;
  const exact = counts.map((n) => (n * 100) / total);
  const whole = exact.map(Math.floor);
  let left = 100 - whole.reduce((sum, n) => sum + n, 0);
  const order = exact
    .map((value, i) => ({ i, rest: value - whole[i] }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    whole[i] += 1;
    left -= 1;
  }
  return whole;
}
