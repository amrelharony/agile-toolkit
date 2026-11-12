/**
 * Quick Vote — tool-local actions.
 *
 * Category: Workshops & Facilitation (tools plan phase 1, P1.4)
 * Tool:     fast votes for any meeting: fist of five, ROTI, polls, dot
 *           voting, value poker … run live (anonymous, totals only), by a
 *           hand count, or on hold-up cards.
 *
 * Agent surface: tool.quick_vote.*
 * Backing store: the tool's own store (`agile-toolkit:quick-vote`, through
 *                lib/quick-vote/store): saved results (totals only), the
 *                host's own formats, and the round being set up.
 *
 *   1. list_state    — the round being set up, the host's formats, how
 *                      many results are saved and the latest one.
 *   2. list_presets  — every format: its kind, answers and what it's for.
 *   3. start_round   — set up a round of a format (the question, options,
 *                      a range): the page shows it ready to run, and an
 *                      open live room asks it next. Not for visitors: in a
 *                      live room it changes what everyone is asked.
 *   4. list_results  — saved rounds, newest first, each in one line.
 *
 * Every read and check is the page's own code (lib/quick-vote), so the
 * agent and the page agree. Nothing here holds or returns anyone's answer:
 * the results are the vote kit's totals. Over MCP the reads come from the
 * user's synced row; start_round runs only in the browser, where the page
 * and its room are.
 */

import { z } from "zod";
import { registry } from "../registry";
import { serverGetUserStateBlob } from "../server-store";
import {
  FEELINGS,
  QUICK_VOTE_PRESETS,
  feelingsQuestion,
  presetAnswers,
  presetById,
  type QuickVotePreset,
} from "@/lib/quick-vote/presets";
import {
  LABEL_MAX,
  OPTION_MAX,
  QUESTION_MAX,
  UNIT_MAX,
  draftFromPreset,
  presetMinN,
  validateRoundDraft,
  type RoundDraft,
  type RoundSetup,
} from "@/lib/quick-vote/draft";
import {
  normalizeQuickVoteState,
  type CustomPreset,
  type QuickVoteState,
} from "@/lib/quick-vote/state";
import { presetName, resultKind, resultSummary, type SavedResult } from "@/lib/quick-vote/results";
import {
  QUICK_VOTE_STORE_KEY,
  hydrateQuickVote,
  quickVoteState,
  setDraft,
} from "@/lib/quick-vote/store";
import { quickVoteRoom, roomTakesFormat } from "@/lib/quick-vote/live-room";

/* ── Reading ────────────────────────────────────────────────────────── */

/** This browser's data, read back first so nothing is missed. */
async function browserState(): Promise<QuickVoteState> {
  await hydrateQuickVote();
  return quickVoteState();
}

/** The user's synced row (MCP). */
async function serverState(userId: string): Promise<QuickVoteState> {
  return normalizeQuickVoteState(await serverGetUserStateBlob(userId, QUICK_VOTE_STORE_KEY));
}

function presetOut(p: QuickVotePreset) {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    about: p.blurb,
    answers: presetAnswers(p),
    yourOwn:
      p.editable === "options"
        ? "options"
        : p.editable === "labels"
          ? "scale labels"
          : p.editable === "range"
            ? "range and unit"
            : p.editable === "item"
              ? "backlog item"
              : p.editable === "feelings"
                ? "feelings step"
                : null,
    ...(p.mode ? { mode: p.mode } : {}),
    showsFrom: presetMinN(p),
    holdUpCards: p.cards,
    ...(p.standing ? { standing: true } : {}),
    tip: p.tip,
  };
}

function customOut(c: CustomPreset) {
  return { id: c.id, name: c.name, format: c.draft.presetId, question: c.draft.question.trim() };
}

/** The round being set up, as the page shows it, with what's still missing. */
function draftOut(draft: RoundDraft | null) {
  if (!draft) return null;
  const preset = presetById(draft.presetId);
  const check = validateRoundDraft(draft);
  return {
    format: draft.presetId,
    formatName: preset?.name ?? draft.presetId,
    kind: preset?.kind ?? null,
    question: draft.question.trim(),
    ready: check.ok,
    ...(check.ok
      ? { answers: setupAnswers(check.values) }
      : { missing: Object.values(check.errors) }),
  };
}

function setupAnswers(s: RoundSetup): string[] {
  if (s.kind === "scale") return s.points.map((p) => p.label);
  if (s.kind === "number") return [`${s.min} to ${s.max}${s.unit ? ` ${s.unit}` : ""}`];
  return s.options.map((o) => o.text);
}

function resultOut(s: SavedResult) {
  return {
    id: s.id,
    format: s.presetId,
    formatName: presetName(s),
    kind: resultKind(s.result),
    question: s.result.title,
    savedAt: s.savedAt,
    people: s.result.ballots,
    how: s.result.source === "live" ? "live room" : "counted by hand",
    summary: resultSummary(s),
    ...(s.realAnswer !== undefined ? { realAnswer: s.realAnswer } : {}),
    ...(s.valueSaved !== undefined ? { valueSaved: s.valueSaved } : {}),
    sentTo: (s.sentTo ?? []).map((l) => l.route),
  };
}

function listState(state: QuickVoteState) {
  const latest = state.results[0];
  return {
    formats: QUICK_VOTE_PRESETS.length,
    yourFormats: state.customPresets.map(customOut),
    settingUp: draftOut(state.draft),
    results: state.results.length,
    latest: latest ? resultOut(latest) : null,
  };
}

// ──────── tool.quick_vote.list_state ────────
registry.register({
  id: "tool.quick_vote.list_state",
  toolId: "tool.quick_vote",
  name: "list_state",
  category: "read",
  description:
    "Quick Vote as the page shows it. Returns {formats (how many built-in), yourFormats: {id, name, format, question}[] (the host's saved formats), settingUp: {format, formatName, kind, question, ready, answers? | missing?} | null (the round set up on the page; `missing` lists what's still needed), results (saved rounds), latest: the newest saved round in one line | null}. Totals only: nobody's answers.",
  paramsSchema: z.object({}),
  handler: async () => listState(await browserState()),
  mcpHandler: async (_p, ctx) => listState(await serverState(ctx.userId)),
});

// ──────── tool.quick_vote.list_presets ────────

function listPresets(state: QuickVoteState) {
  return {
    formats: QUICK_VOTE_PRESETS.map(presetOut),
    yourFormats: state.customPresets.map(customOut),
    feelings: FEELINGS.map((f) => ({ core: f.core, finer: [...f.finer] })),
  };
}

registry.register({
  id: "tool.quick_vote.list_presets",
  toolId: "tool.quick_vote",
  name: "list_presets",
  category: "read",
  description:
    "Every Quick Vote format, to pick one for start_round. Returns {formats: {id, name, kind: scale|choice|rank|number, about, answers (its own answers: a scale's labels or a choice's options; [] where the host gives them), yourOwn (what start_round can set: options | scale labels | range and unit | backlog item | feelings step | null), mode?, showsFrom (answers needed before results show: 3, or 5 for ESVP and the safety check), holdUpCards, standing?, tip}[], yourFormats: the host's saved formats {id, name, format, question}[], feelings: the feelings wheel's core feelings and their finer words}.",
  paramsSchema: z.object({}),
  handler: async () => listPresets(await browserState()),
  mcpHandler: async (_p, ctx) => listPresets(await serverState(ctx.userId)),
});

// ──────── tool.quick_vote.start_round ────────

const startParams = z.object({
  format: z
    .string()
    .min(1)
    .max(80)
    .describe(
      "A format id from list_presets (e.g. fist-of-five, poll, dots) or a saved format's id."
    ),
  question: z
    .string()
    .max(QUESTION_MAX)
    .optional()
    .describe("The question; default: the format's own."),
  options: z
    .array(z.string().max(OPTION_MAX))
    .max(12)
    .optional()
    .describe("poll, ranking, dots: the options, 2 to 12 (ranking: up to 10)."),
  multi: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe("poll only: let each person pick up to this many (absent: one pick each)."),
  dots: z.number().int().min(1).max(10).optional().describe("dots only: dots each (default 3)."),
  labels: z
    .array(z.string().max(LABEL_MAX))
    .max(11)
    .optional()
    .describe("custom-scale only: 2 to 11 answers, lowest first."),
  min: z.number().optional().describe("guess-number only: the lowest answer."),
  max: z.number().optional().describe("guess-number only: the highest answer."),
  decimals: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  unit: z.string().max(UNIT_MAX).optional().describe("guess-number only: %, days, …"),
  feeling: z
    .string()
    .max(40)
    .optional()
    .describe("feelings only: a core feeling, to ask its finer words (absent: the core feelings)."),
});
type StartParams = z.infer<typeof startParams>;

type StartResult =
  | {
      started: true;
      format: string;
      kind: string;
      question: string;
      answers: string[];
      showsFrom: number;
      /** The live room the page has open, if any, and whether its next round asks this one. */
      liveRoom: string | null;
    }
  | { started: false; reason: string; missing?: string[] };

/** What the page's open live room does with the round just set up, or null with none open. */
function liveRoomNote(presetId: RoundDraft["presetId"], showsFrom: number): string | null {
  const room = quickVoteRoom();
  if (!room) return null;
  return roomTakesFormat(room.minN, presetId)
    ? "The live room open on the page asks it on its next round."
    : `The live room open on the page shows results from ${room.minN} answers and this round needs ${showsFrom}, so it keeps its last round: the host ends and closes it, then runs a new room for this one.`;
}

/** The draft `params` asks for, or why not. */
function draftFor(
  params: StartParams,
  state: QuickVoteState
): { ok: true; draft: RoundDraft } | { ok: false; reason: string } {
  const custom = state.customPresets.find((c) => c.id === params.format);
  const preset = custom ? presetById(custom.draft.presetId) : presetById(params.format);
  if (!preset) {
    return { ok: false, reason: `No format “${params.format}”. list_presets gives the ids.` };
  }
  const draft: RoundDraft = custom
    ? { ...custom.draft, customId: custom.id }
    : draftFromPreset(preset);
  if (params.question !== undefined) draft.question = params.question;
  if (params.options !== undefined) {
    if (preset.editable !== "options") {
      return { ok: false, reason: `${preset.name} has its own answers; options don't apply.` };
    }
    draft.optionsText = params.options.join("\n");
  }
  if (params.multi !== undefined) {
    if (preset.id !== "poll") return { ok: false, reason: "multi is for a poll only." };
    draft.mode = "multi";
    draft.limit = String(params.multi);
  }
  if (params.dots !== undefined) {
    if (preset.id !== "dots") return { ok: false, reason: "dots is for dot voting only." };
    draft.limit = String(params.dots);
  }
  if (params.labels !== undefined) {
    if (preset.editable !== "labels") {
      return { ok: false, reason: "labels are for a custom scale only." };
    }
    draft.labelsText = params.labels.join("\n");
  }
  const ranged =
    params.min !== undefined ||
    params.max !== undefined ||
    params.decimals !== undefined ||
    params.unit !== undefined;
  if (ranged) {
    if (preset.editable !== "range") {
      return { ok: false, reason: "min, max, decimals and unit are for guess-number only." };
    }
    if (params.min !== undefined) draft.min = String(params.min);
    if (params.max !== undefined) draft.max = String(params.max);
    if (params.decimals !== undefined) draft.decimals = params.decimals;
    if (params.unit !== undefined) draft.unit = params.unit;
  }
  if (params.feeling !== undefined) {
    if (preset.id !== "feelings")
      return { ok: false, reason: "feeling is for the feelings wheel only." };
    const core = FEELINGS.find(
      (f) => f.core.toLowerCase() === params.feeling!.trim().toLowerCase()
    );
    if (!core) {
      return {
        ok: false,
        reason: `No core feeling “${params.feeling}”. Pick one of ${FEELINGS.map((f) => f.core).join(", ")}.`,
      };
    }
    draft.feelingsCore = core.core;
    if (params.question === undefined) draft.question = feelingsQuestion(core.core);
  }
  return { ok: true, draft };
}

registry.register({
  id: "tool.quick_vote.start_round",
  toolId: "tool.quick_vote",
  name: "start_round",
  category: "write",
  // An open live room asks the round set up here next: it reaches everyone in the room.
  visitor: false,
  description:
    "Set up a Quick Vote round so the host can run it: the page shows it ready, live (anonymous, totals only), by a hand count or on hold-up cards. A live room the page has open asks it on its next round, unless the round needs more answers than that room shows results from. Params: {format (an id from list_presets, or a saved format's id), question?, options? (poll, ranking, dots: 2-12, ranking up to 10), multi? (poll: most picks each), dots? (dot voting: dots each, 1-10), labels? (custom-scale: 2-11, lowest first), min?/max?/decimals?/unit? (guess-number), feeling? (feelings: a core feeling for step 2)}. Checked like the page's form: returns {started: true, format, kind, question, answers, showsFrom, liveRoom (what the page's open live room does with it | null when none is open)} or {started: false, reason, missing?}. It never runs or reveals a round, and it replaces the round being set up on the page. Browser only: over MCP it refuses.",
  paramsSchema: startParams,
  handler: async (params): Promise<StartResult> => {
    const state = await browserState();
    const built = draftFor(params, state);
    if (!built.ok) return { started: false, reason: built.reason };
    const check = validateRoundDraft(built.draft);
    if (!check.ok) {
      return {
        started: false,
        reason: "The round isn't complete.",
        missing: Object.values(check.errors),
      };
    }
    setDraft(built.draft);
    const preset = presetById(built.draft.presetId)!;
    return {
      started: true,
      format: preset.id,
      kind: preset.kind,
      question: check.values.title,
      answers: setupAnswers(check.values),
      showsFrom: check.values.minN,
      liveRoom: liveRoomNote(preset.id, check.values.minN),
    };
  },
  mcpHandler: async (): Promise<StartResult> => ({
    started: false,
    reason:
      "Quick Vote rounds are set up in the browser, where the page and its live room are. Open /quick-vote there.",
  }),
});

// ──────── tool.quick_vote.list_results ────────

const resultsParams = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("How many, newest first (default 10)."),
});

function listResults(state: QuickVoteState, limit: number) {
  return { total: state.results.length, results: state.results.slice(0, limit).map(resultOut) };
}

registry.register({
  id: "tool.quick_vote.list_results",
  toolId: "tool.quick_vote",
  name: "list_results",
  category: "read",
  description:
    "Saved Quick Vote rounds, newest first. Params: {limit?: 1-50 (default 10)}. Returns {total, results: {id, format, formatName, kind, question, savedAt, people, how: live room | counted by hand, summary (one line: average, top option, first place or median), realAnswer? (guess-number), valueSaved? (value-poker: the value saved to its backlog item), sentTo: routes it was sent on (decision, retro-topic)}[]}. Totals only: never who answered what.",
  paramsSchema: resultsParams,
  handler: async (params) => listResults(await browserState(), params.limit ?? 10),
  mcpHandler: async (params, ctx) => listResults(await serverState(ctx.userId), params.limit ?? 10),
});
