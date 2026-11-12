/**
 * A Quick Vote round being set up (the "draft"), and the one check that
 * turns it into a round the vote kit can run.
 *
 * The draft is what the page's form edits and what Amr's `start_round`
 * writes: the format, the question and the text typed for options, labels
 * or a range. `validateRoundDraft` checks it against the kit's own caps
 * (VOTE_LIMITS) and gives either a `RoundSetup` or one plain message per
 * field, never a silent default: a blank question, one option, a range
 * the wrong way round are errors.
 *
 * Pure and server-safe (Amr's actions import it): the kit's protocol limits
 * only, no React, no store.
 */

import { VOTE_LIMITS } from "@/lib/realtime/vote-room/protocol";
import type { Validation } from "@/lib/utils/form";
import {
  QUICK_VOTE_MODES,
  feelingCore,
  feelingsOptions,
  presetById,
  type PresetId,
  type PresetOption,
  type PresetPoint,
  type QuickVoteMode,
  type QuickVotePreset,
} from "./presets";

/** The kit's minimum answers before a round shows its totals. */
export const DEFAULT_MIN_N = VOTE_LIMITS.minNFloor;

export const QUESTION_MAX = VOTE_LIMITS.maxTitleChars;
export const OPTION_MAX = VOTE_LIMITS.maxOptionChars;
export const LABEL_MAX = VOTE_LIMITS.maxPointLabelChars;
export const UNIT_MAX = VOTE_LIMITS.maxNumberUnitChars;
/** The most characters an options or labels box keeps (12 options of 120, with line breaks). */
export const LIST_TEXT_MAX = 2_000;
/** The id a backlog item may have to be carried on a round. */
const ITEM_ID_MAX = 64;

export interface RoundDraft {
  presetId: PresetId;
  /** The saved format this draft started from, if any (for the picker). */
  customId: string | null;
  question: string;
  /** Poll, ranking, dot voting: the options, one per line. */
  optionsText: string;
  /** Custom scale: the labels, lowest first, one per line. */
  labelsText: string;
  /** Poll: one option or several. Dot voting is always "dots". */
  mode: QuickVoteMode;
  /** Poll with several: the most picks. Dot voting: the dots each. As typed. */
  limit: string;
  /** Guess the number: the range and unit, as typed. */
  min: string;
  max: string;
  decimals: 0 | 1 | 2;
  unit: string;
  /** Value poker: the backlog item it values (optional: a round can value anything). */
  backlogItemId: string | null;
  /** Feelings wheel: null for the core feelings, else the core whose finer words to ask. */
  feelingsCore: string | null;
}

/** The fields a draft's check can fail on. */
export type DraftField = "question" | "options" | "labels" | "limit" | "min" | "max" | "unit";

/** A checked round, ready for ./sheets.ts. */
export type RoundSetup =
  | {
      kind: "scale";
      presetId: PresetId;
      title: string;
      points: PresetPoint[];
      minN: number;
    }
  | {
      kind: "choice";
      presetId: PresetId;
      title: string;
      mode: QuickVoteMode;
      /** single: 1. multi: the most picks. dots: the dots each. */
      limit: number;
      options: PresetOption[];
      minN: number;
      /** Value poker: the item being valued. */
      backlogItemId: string | null;
    }
  | {
      kind: "rank";
      presetId: PresetId;
      title: string;
      options: PresetOption[];
      minN: number;
    }
  | {
      kind: "number";
      presetId: PresetId;
      title: string;
      min: number;
      max: number;
      decimals: 0 | 1 | 2;
      unit: string;
      minN: number;
    };

// ── Text ─────────────────────────────────────────────────────────────

const HIDDEN = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;

/** One line of plain text: hidden characters gone, spaces collapsed, cut to `max`. */
export function cleanLine(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const flat = raw.replace(/\s+/g, " ").replace(HIDDEN, "").trim();
  return Array.from(flat).slice(0, max).join("").trim();
}

/** Text from a store or a form, kept as typed (line breaks too), capped, or "". */
export function keepText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(HIDDEN, (c) => (c === "\n" ? c : ""))
    .slice(0, max);
}

/**
 * The items in a pasted list, one per line: bullets ("- ", "* ", "• ") and
 * numbering ("1.", "2)") dropped, blank lines skipped, each line cleaned.
 * Lines longer than `max` are cut, never split.
 */
export function parseLines(text: string, max: number): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]+|\d{1,3}[.)])\s+/, ""))
    .map((line) => cleanLine(line, max))
    .filter((line) => line.length > 0);
}

/** A number typed in a box: undefined when blank, NaN when it isn't one. */
function typedNumber(raw: string): number | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  return Number(t.replace(/,/g, ""));
}

function hasDecimals(v: number, decimals: number): boolean {
  const scaled = v * 10 ** decimals;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

// ── Drafts ───────────────────────────────────────────────────────────

/** A fresh draft for a format: its question, answers and range. */
export function draftFromPreset(preset: QuickVotePreset): RoundDraft {
  return {
    presetId: preset.id,
    customId: null,
    question: preset.question,
    optionsText: "",
    labelsText:
      preset.editable === "labels" ? (preset.points ?? []).map((p) => p.label).join("\n") : "",
    mode: preset.mode ?? "single",
    limit: preset.limit !== undefined ? String(preset.limit) : preset.mode === "multi" ? "2" : "",
    min: preset.range ? String(preset.range.min) : "",
    max: preset.range ? String(preset.range.max) : "",
    decimals: preset.range?.decimals ?? 0,
    unit: preset.range?.unit ?? "",
    backlogItemId: null,
    feelingsCore: null,
  };
}

const EDITABLE_FIELDS = [
  "question",
  "optionsText",
  "labelsText",
  "mode",
  "limit",
  "min",
  "max",
  "decimals",
  "unit",
  "backlogItemId",
  "feelingsCore",
] as const satisfies readonly (keyof RoundDraft)[];

/**
 * Whether the host changed `draft` from `base`, the draft its format (or
 * saved format) starts with: then replacing it loses typing, so it gets
 * Undo. Spaces at the ends don't count.
 */
export function draftEdited(draft: RoundDraft, base: RoundDraft): boolean {
  const same = (v: unknown) => (typeof v === "string" ? v.trim() : v);
  return EDITABLE_FIELDS.some((k) => same(draft[k]) !== same(base[k]));
}

/** A draft read back from storage or an agent, or null when it can't be one. */
export function normalizeDraft(raw: unknown): RoundDraft | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const preset = presetById(r.presetId);
  if (!preset) return null;
  const base = draftFromPreset(preset);
  const mode =
    typeof r.mode === "string" && (QUICK_VOTE_MODES as readonly string[]).includes(r.mode)
      ? (r.mode as QuickVoteMode)
      : base.mode;
  const decimals = r.decimals === 1 || r.decimals === 2 ? r.decimals : 0;
  const item =
    typeof r.backlogItemId === "string" && r.backlogItemId.length <= ITEM_ID_MAX
      ? r.backlogItemId
      : null;
  return {
    presetId: preset.id,
    customId: typeof r.customId === "string" && r.customId.length <= 80 ? r.customId : null,
    question: keepText(r.question, QUESTION_MAX * 2),
    optionsText: keepText(r.optionsText, LIST_TEXT_MAX),
    labelsText: keepText(r.labelsText, LIST_TEXT_MAX),
    // Dot voting is always dots; a poll is never.
    mode: preset.id === "dots" ? "dots" : mode === "dots" ? base.mode : mode,
    limit: keepText(r.limit, 12),
    min: keepText(r.min, 24),
    max: keepText(r.max, 24),
    decimals,
    unit: keepText(r.unit, UNIT_MAX * 2),
    backlogItemId: preset.id === "value-poker" ? item : null,
    feelingsCore:
      preset.id === "feelings" && typeof r.feelingsCore === "string"
        ? (feelingCore(r.feelingsCore)?.core ?? null)
        : null,
  };
}

/** The options a draft's round offers: its own list, or the format's. */
export function draftOptions(draft: RoundDraft, preset: QuickVotePreset): PresetOption[] {
  if (preset.id === "feelings") return feelingsOptions(draft.feelingsCore);
  if (preset.editable === "options") {
    return parseLines(draft.optionsText, OPTION_MAX).map((text) => ({ text }));
  }
  return (preset.options ?? []).map((o) => ({ ...o }));
}

/** The answers a draft's scale offers: the custom labels, or the format's scale. */
export function draftPoints(draft: RoundDraft, preset: QuickVotePreset): PresetPoint[] {
  if (preset.editable === "labels") {
    return parseLines(draft.labelsText, LABEL_MAX).map((label, i) => ({ value: i + 1, label }));
  }
  return (preset.points ?? []).map((p) => ({ ...p }));
}

/** Answers needed before the format's results show. */
export function presetMinN(preset: QuickVotePreset): number {
  return preset.minN ?? DEFAULT_MIN_N;
}

function duplicate(texts: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const t of texts) {
    const k = t.toLowerCase();
    if (seen.has(k)) return t;
    seen.add(k);
  }
  return null;
}

/**
 * Check a draft. On success the round as the kit's checks will take it:
 * the question and every answer on one line within the caps, 2 to 12
 * options (10 to rank), 2 to 11 scale labels, a range low to high with no
 * more decimals than allowed.
 */
export function validateRoundDraft(draft: RoundDraft): Validation<RoundSetup, DraftField> {
  const preset = presetById(draft.presetId);
  const errors: Partial<Record<DraftField, string>> = {};
  if (!preset) return { ok: false, errors: { question: "Pick a format first." } };
  const title = cleanLine(draft.question, QUESTION_MAX);
  if (!title) errors.question = "Type the question people answer.";
  const minN = presetMinN(preset);

  if (preset.kind === "scale") {
    const pts = draftPoints(draft, preset);
    if (preset.editable === "labels") {
      if (pts.length < VOTE_LIMITS.minPoints) {
        errors.labels = `Give at least ${VOTE_LIMITS.minPoints} answers, one per line, lowest first.`;
      } else if (pts.length > VOTE_LIMITS.maxPoints) {
        errors.labels = `A scale can have at most ${VOTE_LIMITS.maxPoints} answers.`;
      } else {
        const same = duplicate(pts.map((p) => p.label));
        if (same) errors.labels = `“${same}” is on the scale twice.`;
      }
    }
    if (Object.keys(errors).length > 0) return { ok: false, errors };
    return { ok: true, values: { kind: "scale", presetId: preset.id, title, points: pts, minN } };
  }

  if (preset.kind === "number") {
    const min = typedNumber(draft.min);
    const max = typedNumber(draft.max);
    const decimals = draft.decimals;
    const lim = VOTE_LIMITS.maxNumberAbs;
    const check = (v: number | undefined, label: string): string | null => {
      if (v === undefined) return `Give the ${label} answer people can give.`;
      if (!Number.isFinite(v) || Math.abs(v) > lim) {
        return `The ${label} answer needs to be a number from −${lim.toLocaleString("en-US")} to ${lim.toLocaleString("en-US")}.`;
      }
      if (!hasDecimals(v, decimals)) {
        return decimals === 0
          ? `The ${label} answer needs to be a whole number, or allow decimals.`
          : `The ${label} answer can have at most ${decimals} decimal places.`;
      }
      return null;
    };
    const minProblem = check(min, "lowest");
    const maxProblem = check(max, "highest");
    if (minProblem) errors.min = minProblem;
    if (maxProblem) errors.max = maxProblem;
    if (!minProblem && !maxProblem && min !== undefined && max !== undefined) {
      if (min >= max) errors.max = "The highest answer needs to be above the lowest.";
      else if (Math.round((max - min) * 10 ** decimals) > VOTE_LIMITS.maxNumberSteps) {
        errors.max =
          "The range is too wide for its decimal places. Narrow it, or use fewer decimals.";
      }
    }
    const unit = cleanLine(draft.unit, 64);
    if (unit.length > UNIT_MAX) {
      errors.unit = `Keep the unit to ${UNIT_MAX} characters, like % or days.`;
    }
    if (Object.keys(errors).length > 0) return { ok: false, errors };
    const scale = 10 ** decimals;
    return {
      ok: true,
      values: {
        kind: "number",
        presetId: preset.id,
        title,
        min: Math.round((min as number) * scale) / scale,
        max: Math.round((max as number) * scale) / scale,
        decimals,
        unit,
        minN,
      },
    };
  }

  // Choice and rank rounds.
  const options = draftOptions(draft, preset);
  const most = preset.kind === "rank" ? VOTE_LIMITS.maxRankOptions : VOTE_LIMITS.maxChoiceOptions;
  if (options.length < 2) {
    errors.options =
      preset.editable === "options"
        ? "Give at least 2 options, one per line."
        : "This format needs at least 2 options.";
  } else if (options.length > most) {
    errors.options = `A live round takes at most ${most} options: you have ${options.length}.`;
  } else {
    const same = duplicate(options.map((o) => o.text));
    if (same) errors.options = `“${same}” is in the list twice.`;
  }

  if (preset.kind === "rank") {
    if (Object.keys(errors).length > 0) return { ok: false, errors };
    return { ok: true, values: { kind: "rank", presetId: preset.id, title, options, minN } };
  }

  const mode: QuickVoteMode =
    preset.id === "dots" ? "dots" : preset.editable === "options" ? draft.mode : "single";
  let limit = 1;
  if (mode !== "single") {
    const typed = typedNumber(draft.limit);
    const top = mode === "dots" ? VOTE_LIMITS.maxDots : Math.max(1, options.length);
    if (typed === undefined) {
      errors.limit =
        mode === "dots"
          ? "Say how many dots each person gets."
          : "Say how many options one person may pick.";
    } else if (!Number.isInteger(typed) || typed < 1 || typed > top) {
      errors.limit =
        mode === "dots"
          ? `Each person's dots need to be a whole number from 1 to ${top}.`
          : `The most picks need to be a whole number from 1 to ${top}.`;
    } else {
      limit = typed;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const item =
    preset.id === "value-poker" && draft.backlogItemId && draft.backlogItemId.length <= ITEM_ID_MAX
      ? draft.backlogItemId
      : null;
  return {
    ok: true,
    values: {
      kind: "choice",
      presetId: preset.id,
      title,
      mode,
      limit,
      options,
      minN,
      backlogItemId: item,
    },
  };
}
