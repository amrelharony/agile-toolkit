/**
 * Quick Vote's page logic that needs the vote kit's own types: a kit
 * result filed as a saved result, a result back as the kit's for its
 * views and Markdown, the hand-off a result sends, and hand counts turned
 * into a choice round's totals.
 *
 * The saved shapes (lib/quick-vote/results.ts) are written out to keep the
 * kit's counting code out of Amr's actions; `asKitResult` and
 * `asStoredResult` below make the compiler check that they still fit the
 * kit's results both ways.
 */

import { nanoid } from "nanoid";
import { voteRoundMarkdown } from "@/lib/realtime/vote-room/aggregate";
import {
  choiceRoundMarkdown,
  toChoiceResult,
  type ChoiceRoundResult,
  type ChoiceSheet,
} from "@/lib/realtime/vote-room/choice";
import { numberRoundMarkdown, type NumberRoundResult } from "@/lib/realtime/vote-room/number";
import { rankRoundMarkdown, type RankRoundResult } from "@/lib/realtime/vote-room/rank";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import type { RoundResult } from "@/lib/realtime/vote-room/kinds";
import type { HandoffSource } from "@/lib/handoffs/types";
import { readSheetId } from "@/lib/quick-vote/sheets";
import { isPresetId, presetById, type PresetId } from "@/lib/quick-vote/presets";
import {
  choiceLeaders,
  normalizeRoundResult,
  resultKind,
  resultSummary,
  scaleMean,
  withUnit,
  type SavedResult,
  type StoredChoiceResult,
  type StoredNumberResult,
  type StoredRankResult,
  type StoredRoundResult,
  type StoredScaleResult,
} from "@/lib/quick-vote/results";
import type { Validation } from "@/lib/utils/form";
import { isExampleId } from "@/lib/utils/example-id";
import { RETRO_CURRENT_ID } from "@/lib/retro/board";
import type { BacklogItem, RetroBoard, Story } from "@/lib/stores/workspace-types";

/** What the round form can fill its lists from. */
export interface ComposerSources {
  /** Backlog item names (the Prioritizer's backlog, then backlog stories), for dot voting and polls. */
  backlog: string[];
  /** The current retro board's cards, most voted first. */
  retro: string[];
  /** Backlog items value poker can save a value to. */
  items: { id: string; name: string }[];
}

/** The kit's results Quick Vote runs (it never runs pair or allocation rounds). */
export type QuickVoteKitResult =
  | VoteRoundResult
  | ChoiceRoundResult
  | RankRoundResult
  | NumberRoundResult;

/** A saved result as the kit's own, for its views and Markdown. Checked by the compiler. */
export function asKitResult(r: StoredRoundResult): QuickVoteKitResult {
  return r;
}

/** A kit result as stored. Checked by the compiler: the shapes must fit both ways. */
export function asStoredResult(r: QuickVoteKitResult): StoredRoundResult {
  return r;
}

/** The tool id hand-offs name as their source. */
export const QUICK_VOTE_TOOL = "quick-vote";

/**
 * A round the kit handed to `onSave`, filed as a saved result: totals only,
 * the format read from the sheet id (or `fallback`, the format on screen),
 * value poker's backlog item from it too. Null for a result that isn't a
 * Quick Vote round the page can keep (another tool's, a pair round).
 */
export function savedFromRound(
  result: RoundResult,
  fallback: PresetId,
  now: Date = new Date()
): SavedResult | null {
  const stored = normalizeRoundResult(result);
  if (!stored) return null;
  const sheetId = "questionnaireId" in stored ? stored.questionnaireId : stored.sheetId;
  const fromId = readSheetId(sheetId);
  const kind = resultKind(stored);
  const named =
    fromId.presetId && presetById(fromId.presetId)?.kind === kind ? fromId.presetId : null;
  const presetId: PresetId =
    named ?? (isPresetId(fallback) && presetById(fallback)?.kind === kind ? fallback : "poll");
  const saved: SavedResult = {
    id: `qvr-${nanoid(10)}`,
    presetId,
    savedAt: now.toISOString(),
    result: stored,
  };
  if (presetId === "value-poker" && fromId.backlogItemId)
    saved.backlogItemId = fromId.backlogItemId;
  return saved;
}

/** A short headline for a result, as a sentence: "Average 3.4 of 5", "Most picked: Cafe (4)". */
export function resultHeadline(saved: SavedResult): string {
  const r = saved.result;
  switch (resultKind(r)) {
    case "scale": {
      const s = r as StoredScaleResult;
      const mean = scaleMean(s);
      const top = s.scale.points[s.scale.points.length - 1]?.value;
      return mean === null
        ? "Too few answers to show"
        : `Average ${Math.round(mean * 10) / 10} of ${top}`;
    }
    case "choice": {
      const { texts, total } = choiceLeaders(r as StoredChoiceResult);
      if (texts.length === 0) return "Nothing picked";
      return texts.length === 1
        ? `Most picked: ${texts[0]} (${total})`
        : `Tied: ${texts.join(", ")} (${total} each)`;
    }
    case "rank": {
      const k = r as StoredRankResult;
      const best = k.options.reduce((a, b) => (b.points > a.points ? b : a));
      return `First: ${best.text}`;
    }
    case "number": {
      const n = r as StoredNumberResult;
      return `Median ${withUnit(n.median, n.unit)}`;
    }
  }
}

/**
 * The question, then its headline as a second sentence: "Do we go ahead
 * with this? Most picked: Thumbs up (4)". A question without its own end
 * mark gets a full stop, never "this?: top:".
 */
export function resultTitle(saved: SavedResult): string {
  const q = saved.result.title.trim();
  return `${q}${/[?.!:]$/.test(q) ? "" : "."} ${resultHeadline(saved)}`;
}

/**
 * What "Send to" hands over: the question with its headline as the title,
 * the summary as the description; a choice or rank round's options in
 * order, its leader as the recommendation, for a decision record.
 */
export function resultHandoff(saved: SavedResult): HandoffSource {
  const r = saved.result;
  const src: HandoffSource = {
    title: resultTitle(saved),
    description: `${presetById(saved.presetId)?.name ?? "Quick Vote"}. ${resultSummary(saved)}`,
    tone: "question",
    sourceRef: { tool: "quick-vote", id: saved.id },
  };
  const kind = resultKind(r);
  if (kind === "choice" || kind === "rank") {
    const ranked =
      kind === "choice"
        ? (r as StoredChoiceResult).options.slice().sort((a, b) => b.total - a.total)
        : (r as StoredRankResult).options.slice().sort((a, b) => b.points - a.points);
    const leaders =
      kind === "choice" ? choiceLeaders(r as StoredChoiceResult).texts : [ranked[0]?.text ?? ""];
    src.decision = {
      options: ranked.map((o) => o.text),
      ...(leaders.length === 1 && leaders[0] ? { recommendation: leaders[0] } : {}),
    };
  }
  return src;
}

/** A saved result as Markdown: the kit's table under a heading of its own, plus what was added. */
export function savedResultMarkdown(saved: SavedResult): string {
  const kit = asKitResult(saved.result);
  const body =
    "kind" in kit
      ? kit.kind === "choice"
        ? choiceRoundMarkdown(kit)
        : kit.kind === "rank"
          ? rankRoundMarkdown(kit)
          : numberRoundMarkdown(kit)
      : voteRoundMarkdown(kit);
  // The kit's "# title" becomes a section under the page's own heading.
  const lines = [
    body.replace(/^# /, `## ${presetById(saved.presetId)?.name ?? "Quick Vote"}: `).trimEnd(),
  ];
  const r = saved.result;
  if (resultKind(r) === "number" && saved.realAnswer !== undefined) {
    lines.push("", `Real answer: ${withUnit(saved.realAnswer, (r as StoredNumberResult).unit)}.`);
  }
  if (saved.valueSaved !== undefined) {
    lines.push("", `Business value saved to the backlog item: ${saved.valueSaved}.`);
  }
  return lines.join("\n");
}

// ── Lists from the workspace ─────────────────────────────────────────

/**
 * What the form can fill a list from: the backlog (the Prioritizer's items,
 * then stories not yet in a sprint), the current retro board's cards (not
 * its actions, nor cards grouped under another), and the items value poker
 * can save a value to. Example rows never count.
 */
export function composerSources(
  backlogItems: readonly BacklogItem[] | undefined,
  stories: readonly Story[] | undefined,
  boards: readonly RetroBoard[] | undefined
): ComposerSources {
  const items = (backlogItems ?? [])
    .filter((x) => !isExampleId(x.id) && x.name.trim())
    .map((x) => ({ id: x.id, name: x.name.trim() }));
  const backlogStories = (stories ?? [])
    .filter((s) => !isExampleId(s.id) && !s.sprintId && s.status !== "done" && s.title.trim())
    .map((s) => s.title.trim());
  const board = (boards ?? []).find((b) => b.id === RETRO_CURRENT_ID);
  const retro = (board?.cards ?? [])
    .filter((c) => !isExampleId(c.id) && !c.isActionItem && c.groupedWith === null && c.text.trim())
    .sort((a, b) => b.votes - a.votes)
    .map((c) => c.text.trim());
  const unique = (list: string[]) => {
    const seen = new Set<string>();
    return list.filter((t) => {
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  return {
    backlog: unique([...items.map((x) => x.name), ...backlogStories]),
    retro: unique(retro),
    items,
  };
}

// ── Counting hands for a choice round ────────────────────────────────

/** Typed counts: option id → the box's text; and the people box (multi and dots). */
export interface HandCounts {
  counts: Record<string, string>;
  people: string;
}

export type HandCountField = "counts" | "people";

const whole = (raw: string | undefined): number | undefined => {
  const t = (raw ?? "").trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};

/**
 * Hand counts for a choice round, checked as the room's reveal checks a
 * host's totals: whole numbers, at least `minN` people, and totals some set
 * of real answers could give (a single pick each adds up to the people;
 * several or dots stay between the people and their limit).
 */
export function validateHandCounts(
  sheet: ChoiceSheet,
  typed: HandCounts,
  minN: number
): Validation<{ totals: number[]; ballots: number }, HandCountField> {
  const totals: number[] = [];
  for (const o of sheet.options) {
    const n = whole(typed.counts[o.id]);
    if (n === undefined) {
      return { ok: false, errors: { counts: `Give a count for “${o.text}”, 0 if nobody.` } };
    }
    if (Number.isNaN(n)) {
      return { ok: false, errors: { counts: `“${o.text}” needs a whole number from 0.` } };
    }
    totals.push(n);
  }
  const sum = totals.reduce((a, b) => a + b, 0);
  const perOption = sheet.mode === "dots" ? sheet.limit : 1;
  let ballots = sum;
  if (sheet.mode !== "single") {
    const p = whole(typed.people);
    if (p === undefined) {
      return { ok: false, errors: { people: "Say how many people answered." } };
    }
    if (Number.isNaN(p)) return { ok: false, errors: { people: "People needs a whole number." } };
    ballots = p;
  }
  if (ballots < minN) {
    return {
      ok: false,
      errors: {
        [sheet.mode === "single" ? "counts" : "people"]:
          `Totals show from ${minN} people, so nobody's answer stands out.`,
      } as Partial<Record<HandCountField, string>>,
    };
  }
  if (totals.some((t) => t > ballots * perOption)) {
    return { ok: false, errors: { counts: "An option has more than everyone could give it." } };
  }
  if (sheet.mode !== "single" && (sum < ballots || sum > ballots * sheet.limit)) {
    return {
      ok: false,
      errors: {
        counts:
          sheet.mode === "dots"
            ? `${ballots} people with ${sheet.limit} dots each give between ${ballots} and ${ballots * sheet.limit} dots in all; these add up to ${sum}.`
            : `${ballots} people picking 1 to ${sheet.limit} each give between ${ballots} and ${ballots * sheet.limit} picks; these add up to ${sum}.`,
      },
    };
  }
  return { ok: true, values: { totals, ballots } };
}

/** Checked hand counts as the kit's choice result (counted by hand: no spread). */
export function handCountResult(
  sheet: ChoiceSheet,
  values: { totals: number[]; ballots: number },
  minN: number,
  now: Date = new Date()
): ChoiceRoundResult | null {
  return toChoiceResult(
    sheet,
    values.totals.map((total) => ({ total, backers: null })),
    {
      tool: "quick-vote",
      roundId: nanoid(12),
      closedAt: now.toISOString(),
      minN,
      ballots: values.ballots,
      source: "facilitator",
    }
  );
}
