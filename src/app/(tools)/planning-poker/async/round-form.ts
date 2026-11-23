/**
 * The new-round form of "Estimate without a meeting": the draft and its
 * checks. Stories come from the queue (the host ticks them) or are typed,
 * one per line; the rules a round must keep are lib/estimation/async-pack's
 * (`asyncRoundProblem`), so the page and Amr refuse the same rounds.
 */

import type { Validation } from "@/lib/utils/form";
import { POKER_ASYNC_MAX } from "@/lib/stores/workspace-types";
import { asyncDeckFor, asyncDeckProblem, isDay, typedLine } from "@/lib/estimation/async-pack";
import { DEFAULT_CUSTOM_DECK, type ScaleType } from "../types";

export interface AsyncRoundDraft {
  title: string;
  scaleType: ScaleType;
  /** The custom deck as typed: comma-separated values. */
  customInput: string;
  /** Queue items to estimate, by queue item id. */
  queueIds: string[];
  /** Typed story titles, one per line. */
  typed: string;
  expected: string[];
  /** "YYYY-MM-DD" or "". */
  dueDate: string;
  withMeanings: boolean;
}

export type AsyncRoundField = "title" | "customInput" | "stories" | "expected" | "dueDate";

export interface AsyncRoundValues {
  title: string;
  scaleType: ScaleType;
  deck: string[];
  queueIds: string[];
  typedTitles: string[];
  expected: string[];
  dueDate?: string;
  withMeanings: boolean;
}

export const INITIAL_ASYNC_ROUND: AsyncRoundDraft = {
  title: "",
  scaleType: "fibonacci",
  customInput: DEFAULT_CUSTOM_DECK,
  queueIds: [],
  typed: "",
  expected: [],
  dueDate: "",
  withMeanings: false,
};

/** The typed titles: one per line, blank lines dropped. */
export function typedTitles(typed: string): string[] {
  return typed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Check the draft. `queue` is the queue items the form offers (pending and
 * not held by another round); a ticked id that has gone since is ignored.
 */
export function validateAsyncRound(
  d: AsyncRoundDraft,
  ctx: { today: string; queueIds: readonly string[] }
): Validation<AsyncRoundValues, AsyncRoundField> {
  const errors: Partial<Record<AsyncRoundField, string>> = {};
  // The host's own text: hidden direction marks are stripped, not refused.
  const title = typedLine(d.title) ?? "";
  if (!title) errors.title = "Name the round.";
  else if (title.length > POKER_ASYNC_MAX.title) {
    errors.title = `Keep the name to ${POKER_ASYNC_MAX.title} characters.`;
  }

  const deck = asyncDeckFor(d.scaleType, d.customInput);
  const deckProblem = asyncDeckProblem(deck);
  if (deckProblem) errors.customInput = deckProblem;

  const offered = new Set(ctx.queueIds);
  const queueIds = d.queueIds.filter((id) => offered.has(id));
  const typed = typedTitles(d.typed)
    .map((t) => typedLine(t) ?? "")
    .filter(Boolean);
  const total = queueIds.length + typed.length;
  const long = typed.find((t) => t.length > POKER_ASYNC_MAX.storyTitle);
  if (total === 0) errors.stories = "Tick a queued story or type at least one title.";
  else if (total > POKER_ASYNC_MAX.stories) {
    errors.stories = `A round takes up to ${POKER_ASYNC_MAX.stories} stories (${total} now). Split them into two rounds.`;
  } else if (long) {
    errors.stories = `Keep each title to ${POKER_ASYNC_MAX.storyTitle} characters (“${long.slice(0, 24)}…”).`;
  }

  if (d.expected.length > POKER_ASYNC_MAX.expected) {
    errors.expected = `Name up to ${POKER_ASYNC_MAX.expected} people.`;
  } else if (
    d.expected.some((n) => {
      const name = typedLine(n);
      return !name || name.length > POKER_ASYNC_MAX.name;
    })
  ) {
    errors.expected = `Keep each name to ${POKER_ASYNC_MAX.name} characters.`;
  }

  if (d.dueDate) {
    if (!isDay(d.dueDate)) errors.dueDate = "Pick a due day.";
    else if (d.dueDate < ctx.today) errors.dueDate = "Pick today or a later day.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      title,
      scaleType: d.scaleType,
      deck,
      queueIds,
      typedTitles: typed,
      expected: d.expected.map((n) => typedLine(n) ?? ""),
      ...(d.dueDate ? { dueDate: d.dueDate } : {}),
      withMeanings: d.withMeanings,
    },
  };
}
