/**
 * Choice rounds (Quick Vote's polls, multi-picks and dot voting): each
 * person picks from up to 12 options, and the host keeps per-option totals.
 *
 * A host publishes a `ChoiceSheet` in one of three modes:
 *  - "single": pick exactly one option (`limit` is 1);
 *  - "multi": pick 1 to `limit` options;
 *  - "dots": spread 1 to `limit` dots (at most `VOTE_LIMITS.maxDots`), any
 *    number of them on one option.
 * A participant answers with one character per option, its count in
 * `ANSWER_ALPHABET` (0 or 1 for single and multi, 0 to `limit` for dots), so
 * every ballot in a round has the same ciphertext size: it depends only on
 * the option count, which is public. The host folds each ballot into a
 * `ChoiceTally` and drops it:
 *  - per option, the total (people who picked it, or dots on it);
 *  - for dots, per option, how many people put at least one dot on it;
 *  - and the ballot count. Nothing per person.
 *
 * Reveal needs minN ballots (3) and shows every option's total (every
 * ballot covers every option, nothing is skipped). In a dot round, who
 * backed an option (people with a dot on it) shows only from
 * `VOTE_LIMITS.minNSpread` (5) ballots: next to the dot totals it narrows
 * each person's spread, as an allocation round's bands would.
 *
 * Privacy (see RUNBOOK "Live vote rounds"): an option's total hides each
 * pick in a sum of n ≥ 3, with the scale round's residual risks (a host
 * plus one colluding member at n = 3; unanimity shows: a total of 0 says
 * nobody picked it, a total of n in a single round says everyone did).
 *
 * Pure and server-safe (MCP actions may import it): no React, no store,
 * no browser globals.
 */

import { isWithinJsonSize, shareableText } from "../sanitize";
import {
  ANSWER_ALPHABET,
  PER_ROUND_STATE_VERSION,
  VOTE_LIMITS,
  isChoiceRoomTool,
  readKindStateHead,
  type ChoiceRoomTool,
  type HostKeys,
  type RoundPhase,
  type Signed,
} from "./protocol";
import {
  effectiveMinN,
  precheckBallot,
  type BallotLedger,
  type BallotRejection,
  type FoldContext,
  type RoundResultMeta,
} from "./aggregate";
import { ID_RE, ID_RULE, b64urlChars, isCleanText, isCount, mdCell, obj } from "./wire";

// ── Shapes ───────────────────────────────────────────────────────────

/** How people answer a choice round. */
export type ChoiceMode = "single" | "multi" | "dots";

export const CHOICE_MODES = ["single", "multi", "dots"] as const satisfies readonly ChoiceMode[];

/** One option of a choice or rank round. */
export interface ChoiceOption {
  id: string;
  text: string;
  hint?: string;
}

/** What a choice round asks. */
export interface ChoiceSheet {
  id: string;
  title: string;
  mode: ChoiceMode;
  /**
   * single: 1. multi: the most options one person may pick (1 to the
   * option count). dots: the dots each person spreads (1 to
   * `VOTE_LIMITS.maxDots`).
   */
  limit: number;
  /** 2 to 12 options. */
  options: ChoiceOption[];
}

/** One option's revealed result. */
export interface RevealedChoice {
  /** single and multi: people who picked it. dots: dots on it. */
  total: number;
  /** dots: people who put at least one dot on it, from `minNSpread` answers; else null. */
  backers: number | null;
}

export interface ChoiceStateBody {
  v: typeof PER_ROUND_STATE_VERSION;
  kind: "choice";
  /** The host's member id. */
  by: string;
  /** Rises with every state the host sends; participants drop anything older. */
  seq: number;
  tool: ChoiceRoomTool;
  /** nanoid(12), new every round. */
  roundId: string;
  /** Epoch ms when the room closes for everyone. */
  endsAt: number;
  minN: number;
  sheet: ChoiceSheet;
  keys: HostKeys;
  phase: RoundPhase;
  /** Ballots counted this round. Never a total before Reveal. */
  ballots: number;
  /** Accepted ballot ids, oldest first. [] once revealed. */
  acks: string[];
  /** Non-null exactly when the phase is "revealed". */
  revealed: RevealedChoice[] | null;
}

export type ChoiceStateMessage = Signed<ChoiceStateBody>;

/** A ballot as it is encrypted: one `ANSWER_ALPHABET` character per option, its count. */
export type ChoiceString = string;

/** A participant's form: option id → its count (1 picked, 0 or null not; dots for "dots"). */
export type ChoiceDraft = Record<string, number | null>;

/** What is wrong with a choice draft. */
export type ChoiceProblem = "empty" | "too-many" | "not-whole" | "over-limit";

// ── Host side: what it may share ─────────────────────────────────────

type SheetCheck = { ok: true; sheet: ChoiceSheet } | { ok: false; problem: string };

/** The most `limit` may be for `mode` with `options` options. */
export function choiceLimitMax(mode: ChoiceMode, options: number): number {
  if (mode === "single") return 1;
  if (mode === "multi") return options;
  return VOTE_LIMITS.maxDots;
}

function checkChoiceSheet(s: ChoiceSheet): SheetCheck {
  const no = (problem: string): SheetCheck => ({ ok: false, problem });
  if (!s || typeof s !== "object") return no("There is nothing to choose from.");
  if (typeof s.id !== "string" || !ID_RE.test(s.id)) {
    return no(`The round's id can't be shared live: ${ID_RULE}.`);
  }
  const title = shareableText(String(s.title ?? ""), VOTE_LIMITS.maxTitleChars);
  if (!title) return no("The round needs a question.");
  if (!(CHOICE_MODES as readonly string[]).includes(s.mode)) {
    return no("Say whether people pick one option, several, or spread dots.");
  }
  if (
    !Array.isArray(s.options) ||
    s.options.length < VOTE_LIMITS.minChoiceOptions ||
    s.options.length > VOTE_LIMITS.maxChoiceOptions
  ) {
    return no(
      `A live round offers ${VOTE_LIMITS.minChoiceOptions} to ${VOTE_LIMITS.maxChoiceOptions} options.`
    );
  }
  const max = choiceLimitMax(s.mode, s.options.length);
  const limit = s.mode === "single" ? 1 : s.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > max) {
    return no(
      s.mode === "dots"
        ? `Each person's dots need to be a whole number from 1 to ${max}.`
        : `The most options one person may pick needs to be a whole number from 1 to ${max}.`
    );
  }
  const ids = new Set<string>();
  const options: ChoiceOption[] = [];
  for (let i = 0; i < s.options.length; i++) {
    const x = s.options[i];
    if (!x || typeof x.id !== "string" || !ID_RE.test(x.id)) {
      return no(`Option ${i + 1}'s id can't be shared live: ${ID_RULE}.`);
    }
    if (ids.has(x.id)) return no(`Option ${i + 1} has the same id as an earlier option.`);
    ids.add(x.id);
    const text = shareableText(String(x.text ?? ""), VOTE_LIMITS.maxOptionChars);
    if (!text) return no(`Option ${i + 1} needs text.`);
    const option: ChoiceOption = { id: x.id, text };
    const hint = typeof x.hint === "string" ? shareableText(x.hint, VOTE_LIMITS.maxHintChars) : "";
    if (hint) option.hint = hint;
    options.push(option);
  }
  return { ok: true, sheet: { id: s.id, title, mode: s.mode, limit, options } };
}

/**
 * The sheet as the host may share it, rebuilt field by field (text on one
 * line, hidden characters stripped, cut to the caps; numbers checked; a
 * single round's limit is 1 whatever was given). Null when it can't be
 * shared; `choiceSheetProblem` says why.
 */
export function toWireChoiceSheet(s: ChoiceSheet): ChoiceSheet | null {
  const checked = checkChoiceSheet(s);
  return checked.ok ? checked.sheet : null;
}

/** Why `s` can't be shared live, in one sentence for the host, or null when it can. */
export function choiceSheetProblem(s: ChoiceSheet): string | null {
  const checked = checkChoiceSheet(s);
  return checked.ok ? null : checked.problem;
}

// ── Answers ──────────────────────────────────────────────────────────

function draftCount(d: ChoiceDraft, id: string): unknown {
  const v = Object.prototype.hasOwnProperty.call(d, id) ? d[id] : null;
  return v === null || v === undefined ? 0 : v;
}

/**
 * The first thing wrong with a draft, or null when it can be sent: a count
 * that isn't a whole number from 0 ("not-whole"; single and multi take 0
 * or 1), one option over the dots ("over-limit"), nothing picked
 * ("empty"), or more picks or dots than the sheet allows ("too-many"; a
 * single round takes exactly one).
 */
export function choiceDraftProblem(
  d: ChoiceDraft,
  s: ChoiceSheet
): { optionId?: string; problem: ChoiceProblem } | null {
  const perOption = s.mode === "dots" ? s.limit : 1;
  let sum = 0;
  for (const option of s.options) {
    const v = draftCount(d, option.id);
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      return { optionId: option.id, problem: "not-whole" };
    }
    if (v > perOption) {
      return { optionId: option.id, problem: s.mode === "dots" ? "over-limit" : "not-whole" };
    }
    sum += v;
  }
  if (sum === 0) return { problem: "empty" };
  if (sum > s.limit) return { problem: "too-many" };
  return null;
}

/** The ballot for `d`, or null when `choiceDraftProblem` finds anything. */
export function encodeChoice(d: ChoiceDraft, s: ChoiceSheet): ChoiceString | null {
  if (choiceDraftProblem(d, s)) return null;
  return s.options.map((x) => ANSWER_ALPHABET[draftCount(d, x.id) as number]).join("");
}

/** Whether `counts` is a ballot `s` accepts. */
function isValidChoice(counts: readonly number[], s: ChoiceSheet): boolean {
  if (!Array.isArray(counts) || counts.length !== s.options.length) return false;
  const perOption = s.mode === "dots" ? s.limit : 1;
  let sum = 0;
  for (const c of counts) {
    if (!Number.isInteger(c) || c < 0 || c > perOption) return false;
    sum += c;
  }
  return sum >= 1 && sum <= s.limit;
}

/**
 * A decrypted ballot as per-option counts, or null: the wrong length, a
 * character outside the alphabet, an option over its most, nothing picked,
 * or more than the sheet allows.
 */
export function readChoiceString(plain: string, s: ChoiceSheet): number[] | null {
  if (typeof plain !== "string" || plain.length !== s.options.length) return null;
  const counts: number[] = [];
  for (const c of plain) {
    const n = ANSWER_ALPHABET.indexOf(c);
    if (n < 0) return null;
    counts.push(n);
  }
  return isValidChoice(counts, s) ? counts : null;
}

/** The exact ciphertext length of a ballot for `s`: one byte per option plus the 16-byte tag. */
export function choiceCiphertextChars(s: ChoiceSheet): number {
  return b64urlChars(s.options.length + 16);
}

// ── Readers ──────────────────────────────────────────────────────────

/** Options from the wire (choice or rank rounds), or null. Accepts exactly what the host builds. */
export function readOptions(raw: unknown, min: number, max: number): ChoiceOption[] | null {
  if (!Array.isArray(raw) || raw.length < min || raw.length > max) return null;
  const ids = new Set<string>();
  const options: ChoiceOption[] = [];
  for (const rawOption of raw) {
    const x = obj(rawOption);
    if (!x || typeof x.id !== "string" || !ID_RE.test(x.id) || ids.has(x.id)) return null;
    if (!isCleanText(x.text, VOTE_LIMITS.maxOptionChars)) return null;
    if (x.hint !== undefined && !isCleanText(x.hint, VOTE_LIMITS.maxHintChars)) return null;
    ids.add(x.id);
    const option: ChoiceOption = { id: x.id, text: x.text };
    if (typeof x.hint === "string") option.hint = x.hint;
    options.push(option);
  }
  return options;
}

function readChoiceSheet(raw: unknown): ChoiceSheet | null {
  const s = obj(raw);
  if (!s || typeof s.id !== "string" || !ID_RE.test(s.id)) return null;
  if (!isCleanText(s.title, VOTE_LIMITS.maxTitleChars)) return null;
  if (typeof s.mode !== "string" || !(CHOICE_MODES as readonly string[]).includes(s.mode)) {
    return null;
  }
  const mode = s.mode as ChoiceMode;
  const options = readOptions(
    s.options,
    VOTE_LIMITS.minChoiceOptions,
    VOTE_LIMITS.maxChoiceOptions
  );
  if (!options) return null;
  const max = choiceLimitMax(mode, options.length);
  if (!isCount(s.limit, max) || s.limit < 1) return null;
  if (mode === "single" && s.limit !== 1) return null;
  return { id: s.id, title: s.title, mode, limit: s.limit, options };
}

function readRevealedChoice(
  raw: unknown,
  s: ChoiceSheet,
  ballots: number,
  minN: number
): RevealedChoice[] | null {
  if (!Array.isArray(raw) || raw.length !== s.options.length) return null;
  const perOption = s.mode === "dots" ? s.limit : 1;
  const spreadShown = s.mode === "dots" && ballots >= Math.max(minN, VOTE_LIMITS.minNSpread);
  const out: RevealedChoice[] = [];
  let sum = 0;
  let backed = 0;
  for (const rawRow of raw) {
    const r = obj(rawRow);
    if (!r || !isCount(r.total, ballots * perOption)) return null;
    sum += r.total;
    if (r.backers === null) {
      // Dot rounds show who backed what from minNSpread answers, and then for every option.
      if (spreadShown) return null;
      out.push({ total: r.total, backers: null });
      continue;
    }
    if (!spreadShown || !isCount(r.backers, ballots)) return null;
    // Each backer gave 1 to `limit` dots: the total sits between them.
    if (r.total < r.backers || r.total > r.backers * s.limit) return null;
    backed += r.backers;
    out.push({ total: r.total, backers: r.backers });
  }
  if (s.mode === "single" && sum !== ballots) return null;
  if (sum < ballots || sum > ballots * s.limit) return null;
  // Every person backs at least one option, and at most `limit` of them.
  if (spreadShown && (backed < ballots || backed > ballots * s.limit)) return null;
  return out;
}

/**
 * A choice round's host state for this page's `tool`, or null. Checks
 * shape, caps and the reveal rules (totals from minN, a dot round's
 * backers from `minNSpread`, totals that some set of valid ballots could
 * give); the signature is the hook's call.
 */
export function readChoiceState(raw: unknown, tool: ChoiceRoomTool): ChoiceStateMessage | null {
  if (!isWithinJsonSize(raw, VOTE_LIMITS.maxPayloadChars)) return null;
  const m = obj(raw);
  if (!m || !isChoiceRoomTool(tool) || !isChoiceRoomTool(m.tool)) return null;
  const head = readKindStateHead(m, tool, "choice");
  if (!head) return null;
  const sheet = readChoiceSheet(m.sheet);
  if (!sheet) return null;
  let revealed: RevealedChoice[] | null = null;
  if (head.phase === "revealed") {
    revealed = readRevealedChoice(m.revealed, sheet, head.ballots, head.minN);
    if (!revealed) return null;
  }
  return {
    v: PER_ROUND_STATE_VERSION,
    kind: "choice",
    by: head.by,
    seq: head.seq,
    tool: m.tool,
    roundId: head.roundId,
    endsAt: head.endsAt,
    minN: head.minN,
    sheet,
    keys: head.keys,
    phase: head.phase,
    ballots: head.ballots,
    acks: head.acks,
    revealed,
    sig: head.sig,
  };
}

// ── Counting ─────────────────────────────────────────────────────────

export interface ChoiceTally {
  roundId: string;
  /** totals[option]: people who picked it, or dots on it. */
  totals: number[];
  /** backers[option]: people with at least one pick or dot on it. */
  backers: number[];
  /** Ballots counted. */
  ballots: number;
}

export function emptyChoiceTally(roundId: string, s: ChoiceSheet): ChoiceTally {
  return {
    roundId,
    totals: s.options.map(() => 0),
    backers: s.options.map(() => 0),
    ballots: 0,
  };
}

/**
 * Count `by`'s ballot (per-option counts, as `readChoiceString` returns
 * them), after the same pre-checks as a scale ballot (re-run: the round,
 * the phase or the seats can change while a ballot is being decrypted).
 * Never mutates its inputs.
 */
export function foldChoice(
  t: ChoiceTally,
  ledger: BallotLedger,
  by: string,
  counts: readonly number[],
  s: ChoiceSheet,
  ctx: FoldContext
): { ok: true; tally: ChoiceTally; ledger: BallotLedger } | { ok: false; reason: BallotRejection } {
  const rejected = precheckBallot({ by, roundId: t.roundId }, ledger, t, ctx);
  if (rejected) return { ok: false, reason: rejected };
  if (t.totals.length !== s.options.length || !isValidChoice(counts, s)) {
    return { ok: false, reason: "bad-answers" };
  }
  const voted = new Set(ledger.voted);
  voted.add(by);
  return {
    ok: true,
    tally: {
      ...t,
      totals: t.totals.map((n, i) => n + counts[i]),
      backers: t.backers.map((n, i) => (counts[i] > 0 ? n + 1 : n)),
      ballots: t.ballots + 1,
    },
    ledger: { voted },
  };
}

// ── Reveal rules ─────────────────────────────────────────────────────

/** Whether the round has enough ballots to reveal. */
export function canRevealChoice(t: ChoiceTally, minN: number): boolean {
  return t.ballots >= effectiveMinN(minN);
}

/** Whether a dot round of `ballots` answers under `minN` may show who backed what. */
export function choiceBackersShow(mode: ChoiceMode, ballots: number, minN: number): boolean {
  return mode === "dots" && ballots >= Math.max(effectiveMinN(minN), VOTE_LIMITS.minNSpread);
}

/** Every option's total; a dot round's backers only from `minNSpread`. Null under minN. */
export function revealChoice(
  t: ChoiceTally,
  s: ChoiceSheet,
  minN: number
): RevealedChoice[] | null {
  if (!canRevealChoice(t, minN)) return null;
  const backers = choiceBackersShow(s.mode, t.ballots, minN);
  return t.totals.map((total, i) => ({ total, backers: backers ? t.backers[i] : null }));
}

// ── The saved result ─────────────────────────────────────────────────

/** A closed choice round as a tool saves it: totals only. No ids, no names, nobody's picks. */
export interface ChoiceRoundResult {
  kind: "choice";
  roundId: string;
  tool: ChoiceRoomTool;
  sheetId: string;
  title: string;
  mode: ChoiceMode;
  limit: number;
  /** ISO timestamp of Reveal. */
  closedAt: string;
  minN: number;
  /** People who answered. */
  ballots: number;
  source: "live" | "facilitator";
  options: {
    id: string;
    text: string;
    /** People who picked it, or dots on it. */
    total: number;
    /** Dot rounds from 5 answers: people with a dot on it. Null otherwise. */
    backers: number | null;
  }[];
}

/**
 * The result to hand a tool's `onSave`. Applies the minN and spread rules
 * again, so a caller can't save backers the room would have withheld. Null
 * under minN ballots, or when `revealed` doesn't fit `s`.
 */
export function toChoiceResult(
  s: ChoiceSheet,
  revealed: readonly RevealedChoice[],
  meta: RoundResultMeta & { tool: ChoiceRoomTool }
): ChoiceRoundResult | null {
  const minN = effectiveMinN(meta.minN, meta.tool);
  if (meta.ballots < minN || revealed.length !== s.options.length) return null;
  const backers = choiceBackersShow(s.mode, meta.ballots, minN);
  return {
    kind: "choice",
    roundId: meta.roundId,
    tool: meta.tool,
    sheetId: s.id,
    title: s.title,
    mode: s.mode,
    limit: s.limit,
    closedAt: meta.closedAt,
    minN,
    ballots: meta.ballots,
    source: meta.source,
    options: s.options.map((option, i) => ({
      id: option.id,
      text: option.text,
      total: revealed[i].total,
      backers: backers && typeof revealed[i].backers === "number" ? revealed[i].backers : null,
    })),
  };
}

/** An option's share: of the people (single, multi) or of the dots (dots), 0–1, or null. */
export function choiceShare(total: number, all: number): number | null {
  return all > 0 ? total / all : null;
}

/** What the shares are of: the people, or every dot given. */
export function choiceShareBase(
  mode: ChoiceMode,
  ballots: number,
  totals: readonly number[]
): number {
  return mode === "dots" ? totals.reduce((a, b) => a + b, 0) : ballots;
}

/** The round as Markdown: one row per option, most first. */
export function choiceRoundMarkdown(r: ChoiceRoundResult): string {
  const how = r.source === "live" ? "answered anonymously in a live round" : "entered by hand";
  const what =
    r.mode === "single"
      ? "one pick each"
      : r.mode === "multi"
        ? `up to ${r.limit} picks each`
        : `${r.limit} ${r.limit === 1 ? "dot" : "dots"} each`;
  const base = choiceShareBase(
    r.mode,
    r.ballots,
    r.options.map((x) => x.total)
  );
  const dots = r.mode === "dots";
  const lines = [
    `# ${mdCell(r.title)}`,
    "",
    `${r.ballots} ${r.ballots === 1 ? "person" : "people"} ${how}, ${r.closedAt.slice(0, 10)}, with ${what}.`,
    "",
    dots ? "| Option | Dots | Share | People with a dot |" : "| Option | People | Share |",
    dots ? "| --- | ---: | ---: | ---: |" : "| --- | ---: | ---: |",
  ];
  const sorted = r.options.slice().sort((a, b) => b.total - a.total);
  for (const x of sorted) {
    const share = choiceShare(x.total, base);
    const pct = share === null ? "—" : `${Math.round(share * 100)}%`;
    lines.push(
      dots
        ? `| ${mdCell(x.text)} | ${x.total} | ${pct} | ${x.backers ?? "—"} |`
        : `| ${mdCell(x.text)} | ${x.total} | ${pct} |`
    );
  }
  if (dots && r.options.every((x) => x.backers === null)) {
    lines.push(
      "",
      `Who put a dot where shows from ${Math.max(r.minN, VOTE_LIMITS.minNSpread)} answers.`
    );
  }
  return `${lines.join("\n")}\n`;
}
