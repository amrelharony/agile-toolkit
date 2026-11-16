/**
 * One vote room, six kinds of round: the kind-aware steps of a round in
 * one place, so the room hook (`use-vote-room.ts`) runs a single state
 * machine whatever a round asks.
 *
 *   scale       Questionnaire   v1 state   per question: count per point
 *   pair        PairSheet       v2 state   per item: the P × P joint count
 *   allocation  AllocationSheet v2 state   per item: total, bands of amounts
 *   choice      ChoiceSheet     v3 state   per option: total (and backers)
 *   rank        RankSheet       v3 state   per option: Borda points
 *   number      NumberSheet     v3 state   count, median, spread
 *
 * A tool lists the kinds it may run (`VOTE_ROUND_KINDS`); each round is of
 * one of them, and its state names it. Everything here checks that a
 * round's sheet, counts and results are all of the round's kind, and that
 * the tool may run it, and refuses (null) rather than mixing them.
 * Ballots, kicks and ends are the same for every kind; only what a
 * ballot's plaintext means differs.
 *
 * Pure and server-safe: no React, no store, no browser globals.
 */

import {
  KIND_STATE_VERSION,
  PER_ROUND_STATE_VERSION,
  ballotCiphertextChars,
  defaultRoundKind,
  encodeAnswers,
  isAllocationRoomTool,
  isChoiceRoomTool,
  isNumberRoomTool,
  isPairRoomTool,
  isRankRoomTool,
  isScaleRoomTool,
  isVoteRoundKind,
  questionnaireProblem,
  readAnswerString,
  readVoteState,
  toWireQuestionnaire,
  toolRunsKind,
  type AnswerDraft,
  type HostKeys,
  type Questionnaire,
  type RevealedQuestion,
  type RoundPhase,
  type Signed,
  type VoteRoomTool,
  type VoteRoundKind,
  type VoteStateBody,
} from "./protocol";
import {
  canReveal,
  emptyTally,
  foldBallot,
  revealTally,
  toRoundResult,
  type BallotLedger,
  type BallotRejection,
  type FoldContext,
  type RoundResultMeta,
  type Tally,
  type VoteRoundResult,
} from "./aggregate";
import {
  allocationCiphertextChars,
  canRevealAllocation,
  emptyAllocationTally,
  encodeAllocation,
  foldAllocation,
  readAllocationState,
  readAllocationString,
  revealAllocation,
  sheetProblem,
  toAllocationResult,
  toWireSheet,
  type AllocationRoundResult,
  type AllocationSheet,
  type AllocationStateBody,
  type AllocationTally,
  type RevealedAllocation,
} from "./allocation";
import {
  canRevealPairs,
  emptyPairTally,
  encodePairs,
  foldPair,
  pairCiphertextChars,
  pairSheetProblem,
  readPairState,
  readPairString,
  revealPairs,
  toPairResult,
  toWirePairSheet,
  type PairRoundResult,
  type PairSheet,
  type PairStateBody,
  type PairTally,
  type RevealedPair,
} from "./pair";
import {
  canRevealChoice,
  choiceCiphertextChars,
  choiceSheetProblem,
  emptyChoiceTally,
  encodeChoice,
  foldChoice,
  readChoiceState,
  readChoiceString,
  revealChoice,
  toChoiceResult,
  toWireChoiceSheet,
  type ChoiceRoundResult,
  type ChoiceSheet,
  type ChoiceStateBody,
  type ChoiceTally,
  type RevealedChoice,
} from "./choice";
import {
  canRevealRank,
  emptyRankTally,
  encodeRank,
  foldRank,
  rankCiphertextChars,
  rankSheetProblem,
  readRankState,
  readRankString,
  revealRank,
  toRankResult,
  toWireRankSheet,
  type RankRoundResult,
  type RankSheet,
  type RankStateBody,
  type RankTally,
  type RevealedRank,
} from "./rank";
import {
  canRevealNumber,
  emptyNumberTally,
  encodeNumber,
  foldNumber,
  numberCiphertextChars,
  numberSheetProblem,
  readNumberState,
  readNumberString,
  revealNumber,
  toNumberResult,
  toWireNumberSheet,
  type NumberRoundResult,
  type NumberSheet,
  type NumberStateBody,
  type NumberTally,
  type RevealedNumber,
} from "./number";
import { obj } from "./wire";

// ── Shapes ───────────────────────────────────────────────────────────

/** What a round asks, tagged with its kind. */
export type RoundSpec =
  | { kind: "scale"; questionnaire: Questionnaire }
  | { kind: "pair"; sheet: PairSheet }
  | { kind: "allocation"; sheet: AllocationSheet }
  | { kind: "choice"; sheet: ChoiceSheet }
  | { kind: "rank"; sheet: RankSheet }
  | { kind: "number"; sheet: NumberSheet };

/** What a tool hands the room to ask: a questionnaire or a sheet of the round's kind. */
export type RoundInput =
  | Questionnaire
  | PairSheet
  | AllocationSheet
  | ChoiceSheet
  | RankSheet
  | NumberSheet;

/** The host's counts for a round (in the host's tab only, never sent before Reveal). */
export type RoundCounts =
  | { kind: "scale"; tally: Tally }
  | { kind: "pair"; tally: PairTally }
  | { kind: "allocation"; tally: AllocationTally }
  | { kind: "choice"; tally: ChoiceTally }
  | { kind: "rank"; tally: RankTally }
  | { kind: "number"; tally: NumberTally };

/** A revealed round's results, as the state carries them. */
export type RoundRevealed =
  | { kind: "scale"; rows: RevealedQuestion[] }
  | { kind: "pair"; rows: RevealedPair[] }
  | { kind: "allocation"; rows: RevealedAllocation[] }
  | { kind: "choice"; rows: RevealedChoice[] }
  | { kind: "rank"; rows: RevealedRank[] }
  | { kind: "number"; value: RevealedNumber };

/**
 * A closed round as a tool saves it, any kind (each one totals only). The
 * other kinds' results carry their `kind`; a scale result is the Phase 6
 * `VoteRoundResult`, unchanged, so it has none (`resultKind`).
 */
export type RoundResult =
  | VoteRoundResult
  | PairRoundResult
  | AllocationRoundResult
  | ChoiceRoundResult
  | RankRoundResult
  | NumberRoundResult;

/** A result's kind: "scale" for the Phase 6 `VoteRoundResult`, which has no `kind`. */
export function resultKind(r: RoundResult): VoteRoundKind {
  return "kind" in r ? r.kind : "scale";
}

export function isPairResult(r: RoundResult | null | undefined): r is PairRoundResult {
  return !!r && "kind" in r && r.kind === "pair";
}

export function isAllocationResult(r: RoundResult | null | undefined): r is AllocationRoundResult {
  return !!r && "kind" in r && r.kind === "allocation";
}

export function isChoiceResult(r: RoundResult | null | undefined): r is ChoiceRoundResult {
  return !!r && "kind" in r && r.kind === "choice";
}

export function isRankResult(r: RoundResult | null | undefined): r is RankRoundResult {
  return !!r && "kind" in r && r.kind === "rank";
}

export function isNumberResult(r: RoundResult | null | undefined): r is NumberRoundResult {
  return !!r && "kind" in r && r.kind === "number";
}

export function isScaleResult(r: RoundResult | null | undefined): r is VoteRoundResult {
  return !!r && !("kind" in r);
}

/** A host state of any kind: scale states are v1, pair and allocation v2, the rest v3. */
export type RoundStateBody =
  | VoteStateBody
  | PairStateBody
  | AllocationStateBody
  | ChoiceStateBody
  | RankStateBody
  | NumberStateBody;
export type RoundStateMessage = Signed<RoundStateBody>;

/**
 * A participant's form, any kind: item (or question, option,
 * `pairDraftKey`, `NUMBER_DRAFT_KEY`) → a number, or null while blank. Every
 * kind's draft has this shape.
 */
export type RoundDraft = AnswerDraft;

/** The parts of a state every kind shares (the kind adds its sheet and results). */
export interface RoundStateHead {
  by: string;
  seq: number;
  tool: VoteRoomTool;
  roundId: string;
  endsAt: number;
  minN: number;
  keys: HostKeys;
  phase: RoundPhase;
  ballots: number;
  acks: string[];
}

// ── The round's questions ────────────────────────────────────────────

/**
 * The kind a tool's rounds are when none is named (its usual one; the only
 * one for the six tools from before), or null for a tool outside the kit.
 * A tool that runs several kinds names each round's (`roundKindsOf` in
 * `protocol.ts` lists them).
 */
export function roundKindOf(tool: unknown): VoteRoundKind | null {
  return defaultRoundKind(tool);
}

/** Which kind of round `input` looks like, from its shape. */
function inputKind(input: unknown): VoteRoundKind | null {
  if (!input || typeof input !== "object") return null;
  if ("questions" in input) return "scale";
  if ("prompts" in input || "answers" in input) return "pair";
  if ("budget" in input) return "allocation";
  if ("mode" in input) return "choice";
  if ("min" in input || "max" in input || "decimals" in input) return "number";
  if ("options" in input) return "rank";
  return null;
}

/**
 * `input` as the host may share it for a round of `kind`, or the reason it
 * can't be (one sentence for the host). A questionnaire for an allocation
 * round, or any other kind change, is refused. Each kind's checker treats
 * its input as untrusted, so the casts below only pick which one runs.
 */
export function wireSpec(
  kind: VoteRoundKind,
  input: RoundInput | null | undefined
): { ok: true; spec: RoundSpec } | { ok: false; problem: string } {
  const seen = inputKind(input);
  // Options alone could be a rank sheet or a choice sheet missing its mode:
  // the choice checker then says what's missing.
  const ambiguous = seen === "rank" && kind === "choice";
  if (seen !== null && seen !== kind && !ambiguous) {
    return { ok: false, problem: "This tool runs another kind of round." };
  }
  switch (kind) {
    case "scale": {
      const q = toWireQuestionnaire(input as Questionnaire);
      return q
        ? { ok: true, spec: { kind, questionnaire: q } }
        : { ok: false, problem: questionnaireProblem(input as Questionnaire) ?? "" };
    }
    case "pair": {
      const s = toWirePairSheet(input as PairSheet);
      return s
        ? { ok: true, spec: { kind, sheet: s } }
        : { ok: false, problem: pairSheetProblem(input as PairSheet) ?? "" };
    }
    case "allocation": {
      const s = toWireSheet(input as AllocationSheet);
      return s
        ? { ok: true, spec: { kind, sheet: s } }
        : { ok: false, problem: sheetProblem(input as AllocationSheet) ?? "" };
    }
    case "choice": {
      const s = toWireChoiceSheet(input as ChoiceSheet);
      return s
        ? { ok: true, spec: { kind, sheet: s } }
        : { ok: false, problem: choiceSheetProblem(input as ChoiceSheet) ?? "" };
    }
    case "rank": {
      const s = toWireRankSheet(input as RankSheet);
      return s
        ? { ok: true, spec: { kind, sheet: s } }
        : { ok: false, problem: rankSheetProblem(input as RankSheet) ?? "" };
    }
    case "number": {
      const s = toWireNumberSheet(input as NumberSheet);
      return s
        ? { ok: true, spec: { kind, sheet: s } }
        : { ok: false, problem: numberSheetProblem(input as NumberSheet) ?? "" };
    }
  }
}

/**
 * `input` tagged as a round of `kind`, unchecked: `wireSpec` / `wireSpecFor`
 * (and the room hook) check that it really is one.
 */
export function specOf(kind: VoteRoundKind, input: RoundInput): RoundSpec {
  if (kind === "scale") return { kind, questionnaire: input as Questionnaire };
  return { kind, sheet: input } as RoundSpec;
}

/** What a spec asks: its questionnaire or its sheet. */
export function specInput(spec: RoundSpec): RoundInput {
  return spec.kind === "scale" ? spec.questionnaire : spec.sheet;
}

/** Whether `v` is shaped like a `RoundSpec` (a kind plus its questionnaire or sheet), unchecked. */
export function isRoundSpecLike(v: unknown): v is RoundSpec {
  const o = obj(v);
  if (!o || !isVoteRoundKind(o.kind)) return false;
  return o.kind === "scale" ? obj(o.questionnaire) !== null : obj(o.sheet) !== null;
}

/**
 * The round `tool` may run for `spec`, as the host may share it, or the
 * reason it can't (one sentence for the host). A kind outside the tool's
 * list is refused before its sheet is looked at.
 */
export function wireSpecFor(
  tool: VoteRoomTool,
  spec: RoundSpec
): { ok: true; spec: RoundSpec } | { ok: false; problem: string } {
  if (!toolRunsKind(tool, spec.kind)) {
    return { ok: false, problem: "This tool doesn't run that kind of round." };
  }
  return wireSpec(spec.kind, specInput(spec));
}

/** The round's title, whatever its kind. */
export function specTitle(spec: RoundSpec): string {
  return spec.kind === "scale" ? spec.questionnaire.title : spec.sheet.title;
}

// ── Answers and counting ─────────────────────────────────────────────

export function emptyCounts(roundId: string, spec: RoundSpec): RoundCounts {
  switch (spec.kind) {
    case "scale":
      return { kind: "scale", tally: emptyTally(roundId, spec.questionnaire) };
    case "pair":
      return { kind: "pair", tally: emptyPairTally(roundId, spec.sheet) };
    case "allocation":
      return { kind: "allocation", tally: emptyAllocationTally(roundId, spec.sheet) };
    case "choice":
      return { kind: "choice", tally: emptyChoiceTally(roundId, spec.sheet) };
    case "rank":
      return { kind: "rank", tally: emptyRankTally(roundId, spec.sheet) };
    case "number":
      return { kind: "number", tally: emptyNumberTally(roundId) };
  }
}

/** The exact ciphertext length of every ballot in a round of `spec`. */
export function specCiphertextChars(spec: RoundSpec): number {
  switch (spec.kind) {
    case "scale":
      return ballotCiphertextChars(spec.questionnaire.questions.length);
    case "pair":
      return pairCiphertextChars(spec.sheet);
    case "allocation":
      return allocationCiphertextChars(spec.sheet);
    case "choice":
      return choiceCiphertextChars(spec.sheet);
    case "rank":
      return rankCiphertextChars(spec.sheet);
    case "number":
      return numberCiphertextChars(spec.sheet);
  }
}

/** The plaintext a participant seals for `draft`, or null when the draft can't be sent. */
export function encodeDraft(spec: RoundSpec, draft: RoundDraft): string | null {
  switch (spec.kind) {
    case "scale":
      return encodeAnswers(draft, spec.questionnaire);
    case "pair":
      return encodePairs(draft, spec.sheet);
    case "allocation":
      return encodeAllocation(draft, spec.sheet);
    case "choice":
      return encodeChoice(draft, spec.sheet);
    case "rank":
      return encodeRank(draft, spec.sheet);
    case "number":
      return encodeNumber(draft, spec.sheet);
  }
}

export type OpenResult =
  | { ok: true; counts: RoundCounts; ledger: BallotLedger }
  | { ok: false; reason: BallotRejection };

/**
 * Read a decrypted plaintext for `spec` and count it as `by`'s answers.
 * Null when the plaintext isn't a valid answer for this round (dropped
 * without a word, like a ballot of the wrong size); otherwise the fold's
 * result, with its pre-checks re-run. Never mutates its inputs.
 */
export function openPlain(
  spec: RoundSpec,
  counts: RoundCounts,
  ledger: BallotLedger,
  by: string,
  plain: string,
  ctx: FoldContext
): OpenResult | null {
  if (spec.kind === "scale" && counts.kind === "scale") {
    const answers = readAnswerString(plain, spec.questionnaire);
    if (!answers) return null;
    const res = foldBallot(counts.tally, ledger, by, answers, ctx);
    return res.ok
      ? { ok: true, counts: { kind: "scale", tally: res.tally }, ledger: res.ledger }
      : res;
  }
  if (spec.kind === "pair" && counts.kind === "pair") {
    const joints = readPairString(plain, spec.sheet);
    if (!joints) return null;
    const res = foldPair(counts.tally, ledger, by, joints, ctx);
    return res.ok
      ? { ok: true, counts: { kind: "pair", tally: res.tally }, ledger: res.ledger }
      : res;
  }
  if (spec.kind === "allocation" && counts.kind === "allocation") {
    const amounts = readAllocationString(plain, spec.sheet);
    if (!amounts) return null;
    const res = foldAllocation(counts.tally, ledger, by, amounts, spec.sheet, ctx);
    return res.ok
      ? { ok: true, counts: { kind: "allocation", tally: res.tally }, ledger: res.ledger }
      : res;
  }
  if (spec.kind === "choice" && counts.kind === "choice") {
    const picks = readChoiceString(plain, spec.sheet);
    if (!picks) return null;
    const res = foldChoice(counts.tally, ledger, by, picks, spec.sheet, ctx);
    return res.ok
      ? { ok: true, counts: { kind: "choice", tally: res.tally }, ledger: res.ledger }
      : res;
  }
  if (spec.kind === "rank" && counts.kind === "rank") {
    const order = readRankString(plain, spec.sheet);
    if (!order) return null;
    const res = foldRank(counts.tally, ledger, by, order, spec.sheet, ctx);
    return res.ok
      ? { ok: true, counts: { kind: "rank", tally: res.tally }, ledger: res.ledger }
      : res;
  }
  if (spec.kind === "number" && counts.kind === "number") {
    const steps = readNumberString(plain, spec.sheet);
    if (steps === null) return null;
    const res = foldNumber(counts.tally, ledger, by, steps, spec.sheet, ctx);
    return res.ok
      ? { ok: true, counts: { kind: "number", tally: res.tally }, ledger: res.ledger }
      : res;
  }
  return null;
}

// ── Reveal and the saved result ──────────────────────────────────────

/** Whether the counts have the minN ballots Reveal needs. */
export function canRevealCounts(counts: RoundCounts, minN: number): boolean {
  switch (counts.kind) {
    case "scale":
      return canReveal(counts.tally, minN);
    case "pair":
      return canRevealPairs(counts.tally, minN);
    case "allocation":
      return canRevealAllocation(counts.tally, minN);
    case "choice":
      return canRevealChoice(counts.tally, minN);
    case "rank":
      return canRevealRank(counts.tally, minN);
    case "number":
      return canRevealNumber(counts.tally, minN);
  }
}

/**
 * What Reveal shows, under each kind's rules; null when the round can't
 * reveal yet (or the counts aren't `spec`'s kind).
 */
export function revealCounts(
  counts: RoundCounts,
  minN: number,
  spec?: RoundSpec
): RoundRevealed | null {
  if (!canRevealCounts(counts, minN)) return null;
  switch (counts.kind) {
    case "scale":
      return { kind: "scale", rows: revealTally(counts.tally, minN) };
    case "pair":
      return { kind: "pair", rows: revealPairs(counts.tally, minN) };
    case "allocation": {
      const rows = revealAllocation(counts.tally, minN);
      return rows ? { kind: "allocation", rows } : null;
    }
    case "choice": {
      if (spec?.kind !== "choice") return null;
      const rows = revealChoice(counts.tally, spec.sheet, minN);
      return rows ? { kind: "choice", rows } : null;
    }
    case "rank": {
      const rows = revealRank(counts.tally, minN);
      return rows ? { kind: "rank", rows } : null;
    }
    case "number": {
      if (spec?.kind !== "number") return null;
      const value = revealNumber(counts.tally, spec.sheet, minN);
      return value ? { kind: "number", value } : null;
    }
  }
}

/**
 * The result a tool may save for a revealed round, re-applying the kind's
 * reveal rules. Null when the parts don't belong together (another kind,
 * a tool that doesn't run it) or there is nothing to show.
 */
export function roundResult(
  spec: RoundSpec,
  revealed: RoundRevealed,
  meta: RoundResultMeta
): RoundResult | null {
  const tool = meta.tool;
  if (spec.kind === "scale" && revealed.kind === "scale" && isScaleRoomTool(tool)) {
    return toRoundResult(spec.questionnaire, revealed.rows, meta);
  }
  if (spec.kind === "pair" && revealed.kind === "pair" && isPairRoomTool(tool)) {
    return toPairResult(spec.sheet, revealed.rows, { ...meta, tool });
  }
  if (spec.kind === "allocation" && revealed.kind === "allocation" && isAllocationRoomTool(tool)) {
    return toAllocationResult(spec.sheet, revealed.rows, { ...meta, tool });
  }
  if (spec.kind === "choice" && revealed.kind === "choice" && isChoiceRoomTool(tool)) {
    return toChoiceResult(spec.sheet, revealed.rows, { ...meta, tool });
  }
  if (spec.kind === "rank" && revealed.kind === "rank" && isRankRoomTool(tool)) {
    return toRankResult(spec.sheet, revealed.rows, { ...meta, tool });
  }
  if (spec.kind === "number" && revealed.kind === "number" && isNumberRoomTool(tool)) {
    return toNumberResult(spec.sheet, revealed.value, { ...meta, tool });
  }
  return null;
}

// ── States ───────────────────────────────────────────────────────────

/**
 * The state the host signs and sends. Scale states are the Phase 6 v1 body,
 * field for field and in the same order; pair and allocation states are v2
 * with their kind; choice, rank and number states v3 with theirs. Results
 * ride along only once revealed. Null when the tool doesn't run rounds of
 * `spec`'s kind.
 */
export function stateBodyFor(
  spec: RoundSpec,
  head: RoundStateHead,
  revealed: RoundRevealed | null
): RoundStateBody | null {
  const { by, seq, tool, roundId, endsAt, minN, keys, phase, ballots, acks } = head;
  if (!toolRunsKind(tool, spec.kind)) return null;
  const shown = phase === "revealed" && revealed?.kind === spec.kind ? revealed : null;
  if (spec.kind === "scale") {
    return {
      v: 1,
      by,
      seq,
      tool,
      roundId,
      endsAt,
      minN,
      questionnaire: spec.questionnaire,
      keys,
      phase,
      ballots,
      acks,
      revealed: shown?.kind === "scale" ? shown.rows : null,
    };
  }
  if (spec.kind === "pair" && isPairRoomTool(tool)) {
    return {
      v: KIND_STATE_VERSION,
      kind: "pair",
      by,
      seq,
      tool,
      roundId,
      endsAt,
      minN,
      sheet: spec.sheet,
      keys,
      phase,
      ballots,
      acks,
      revealed: shown?.kind === "pair" ? shown.rows : null,
    };
  }
  if (spec.kind === "allocation" && isAllocationRoomTool(tool)) {
    return {
      v: KIND_STATE_VERSION,
      kind: "allocation",
      by,
      seq,
      tool,
      roundId,
      endsAt,
      minN,
      sheet: spec.sheet,
      keys,
      phase,
      ballots,
      acks,
      revealed: shown?.kind === "allocation" ? shown.rows : null,
    };
  }
  if (spec.kind === "choice" && isChoiceRoomTool(tool)) {
    return {
      v: PER_ROUND_STATE_VERSION,
      kind: "choice",
      by,
      seq,
      tool,
      roundId,
      endsAt,
      minN,
      sheet: spec.sheet,
      keys,
      phase,
      ballots,
      acks,
      revealed: shown?.kind === "choice" ? shown.rows : null,
    };
  }
  if (spec.kind === "rank" && isRankRoomTool(tool)) {
    return {
      v: PER_ROUND_STATE_VERSION,
      kind: "rank",
      by,
      seq,
      tool,
      roundId,
      endsAt,
      minN,
      sheet: spec.sheet,
      keys,
      phase,
      ballots,
      acks,
      revealed: shown?.kind === "rank" ? shown.rows : null,
    };
  }
  if (spec.kind === "number" && isNumberRoomTool(tool)) {
    return {
      v: PER_ROUND_STATE_VERSION,
      kind: "number",
      by,
      seq,
      tool,
      roundId,
      endsAt,
      minN,
      sheet: spec.sheet,
      keys,
      phase,
      ballots,
      acks,
      revealed: shown?.kind === "number" ? shown.value : null,
    };
  }
  return null;
}

/**
 * A host state for this page's `tool`, read by the kind it names, or null.
 * Only a kind the tool may run is read, so an old or a foreign client's
 * state is ignored rather than misread: Health Check reads only v1 scale
 * states, Kano only v2 pair states, Quick Vote any of its kinds.
 */
export function readRoundState(raw: unknown, tool: VoteRoomTool): RoundStateMessage | null {
  const m = obj(raw);
  if (!m) return null;
  if (m.v === 1) return isScaleRoomTool(tool) ? readVoteState(raw, tool) : null;
  switch (m.kind) {
    case "pair":
      return isPairRoomTool(tool) ? readPairState(raw, tool) : null;
    case "allocation":
      return isAllocationRoomTool(tool) ? readAllocationState(raw, tool) : null;
    case "choice":
      return isChoiceRoomTool(tool) ? readChoiceState(raw, tool) : null;
    case "rank":
      return isRankRoomTool(tool) ? readRankState(raw, tool) : null;
    case "number":
      return isNumberRoomTool(tool) ? readNumberState(raw, tool) : null;
    default:
      return null;
  }
}

/** What a state asks. */
export function specOfState(msg: RoundStateBody): RoundSpec {
  if (msg.v === 1) return { kind: "scale", questionnaire: msg.questionnaire };
  switch (msg.kind) {
    case "pair":
      return { kind: "pair", sheet: msg.sheet };
    case "allocation":
      return { kind: "allocation", sheet: msg.sheet };
    case "choice":
      return { kind: "choice", sheet: msg.sheet };
    case "rank":
      return { kind: "rank", sheet: msg.sheet };
    case "number":
      return { kind: "number", sheet: msg.sheet };
  }
}

/** A state's revealed results, or null while open. */
export function revealedOfState(msg: RoundStateBody): RoundRevealed | null {
  if (msg.v === 1) return msg.revealed ? { kind: "scale", rows: msg.revealed } : null;
  switch (msg.kind) {
    case "pair":
      return msg.revealed ? { kind: "pair", rows: msg.revealed } : null;
    case "allocation":
      return msg.revealed ? { kind: "allocation", rows: msg.revealed } : null;
    case "choice":
      return msg.revealed ? { kind: "choice", rows: msg.revealed } : null;
    case "rank":
      return msg.revealed ? { kind: "rank", rows: msg.revealed } : null;
    case "number":
      return msg.revealed ? { kind: "number", value: msg.revealed } : null;
  }
}
