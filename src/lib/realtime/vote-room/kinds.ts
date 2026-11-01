/**
 * One vote room, three kinds of round: the kind-aware steps of a round in
 * one place, so the room hook (`use-vote-room.ts`) runs a single state
 * machine whatever a tool asks.
 *
 *   scale       Questionnaire   v1 state   per question: count per point
 *   pair        PairSheet       v2 state   per item: the P × P joint count
 *   allocation  AllocationSheet v2 state   per item: total, bands of amounts
 *
 * A tool's kind is fixed (`VOTE_ROUND_KIND`). Everything here checks that a
 * round's sheet, counts and results are all of that kind, and refuses (null)
 * rather than mixing them. Ballots, kicks and ends are the same for every
 * kind; only what a ballot's plaintext means differs.
 *
 * Pure and server-safe: no React, no store, no browser globals.
 */

import {
  KIND_STATE_VERSION,
  VOTE_ROUND_KIND,
  ballotCiphertextChars,
  encodeAnswers,
  isAllocationRoomTool,
  isPairRoomTool,
  isScaleRoomTool,
  questionnaireProblem,
  readAnswerString,
  readVoteState,
  toWireQuestionnaire,
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

// ── Shapes ───────────────────────────────────────────────────────────

/** What a round asks, tagged with its kind. */
export type RoundSpec =
  | { kind: "scale"; questionnaire: Questionnaire }
  | { kind: "pair"; sheet: PairSheet }
  | { kind: "allocation"; sheet: AllocationSheet };

/** What a tool hands the room to ask: a questionnaire or a sheet, by the tool's kind. */
export type RoundInput = Questionnaire | PairSheet | AllocationSheet;

/** The host's counts for a round (in the host's tab only, never sent before Reveal). */
export type RoundCounts =
  | { kind: "scale"; tally: Tally }
  | { kind: "pair"; tally: PairTally }
  | { kind: "allocation"; tally: AllocationTally };

/** A revealed round's results, as the state carries them. */
export type RoundRevealed =
  | { kind: "scale"; rows: RevealedQuestion[] }
  | { kind: "pair"; rows: RevealedPair[] }
  | { kind: "allocation"; rows: RevealedAllocation[] };

/**
 * A closed round as a tool saves it, any kind (each one totals only). The
 * pair and allocation results carry their `kind`; a scale result is the
 * Phase 6 `VoteRoundResult`, unchanged, so it has none (`resultKind`).
 */
export type RoundResult = VoteRoundResult | PairRoundResult | AllocationRoundResult;

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

export function isScaleResult(r: RoundResult | null | undefined): r is VoteRoundResult {
  return !!r && !("kind" in r);
}

/** A host state of any kind: scale states are v1, pair and allocation states v2. */
export type RoundStateBody = VoteStateBody | PairStateBody | AllocationStateBody;
export type RoundStateMessage = Signed<RoundStateBody>;

/**
 * A participant's form, any kind: item (or question, or `pairDraftKey`)
 * → a number, or null while blank. `AnswerDraft`, `PairDraft` and
 * `AllocationDraft` all have this shape.
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

/** The kind a tool's rounds are, or null for a tool outside the kit. */
export function roundKindOf(tool: unknown): VoteRoundKind | null {
  if (isScaleRoomTool(tool)) return "scale";
  if (isPairRoomTool(tool)) return "pair";
  if (isAllocationRoomTool(tool)) return "allocation";
  return null;
}

/** Which kind of round `input` looks like, from its shape. */
function inputKind(input: unknown): VoteRoundKind | null {
  if (!input || typeof input !== "object") return null;
  if ("questions" in input) return "scale";
  if ("prompts" in input || "answers" in input) return "pair";
  if ("budget" in input) return "allocation";
  return null;
}

/**
 * `input` as the host may share it for a round of `kind`, or the reason it
 * can't be (one sentence for the host). A questionnaire for an allocation
 * tool, or any other kind change, is refused. Each kind's checker treats
 * its input as untrusted, so the casts below only pick which one runs.
 */
export function wireSpec(
  kind: VoteRoundKind,
  input: RoundInput | null | undefined
): { ok: true; spec: RoundSpec } | { ok: false; problem: string } {
  const seen = inputKind(input);
  if (seen !== null && seen !== kind) {
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
  }
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
  }
}

/** What Reveal shows, under each kind's rules; null when the round can't reveal yet. */
export function revealCounts(counts: RoundCounts, minN: number): RoundRevealed | null {
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
  }
}

/**
 * The result a tool may save for a revealed round, re-applying the kind's
 * reveal rules. Null when the parts don't belong together (another kind,
 * another tool) or there is nothing to show.
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
  return null;
}

// ── States ───────────────────────────────────────────────────────────

/**
 * The state the host signs and sends. Scale states are the Phase 6 v1 body,
 * field for field and in the same order; pair and allocation states are v2
 * with their kind. Results ride along only once revealed. Null when the
 * tool doesn't run rounds of `spec`'s kind.
 */
export function stateBodyFor(
  spec: RoundSpec,
  head: RoundStateHead,
  revealed: RoundRevealed | null
): RoundStateBody | null {
  const { by, seq, tool, roundId, endsAt, minN, keys, phase, ballots, acks } = head;
  if (VOTE_ROUND_KIND[tool] !== spec.kind) return null;
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
  return null;
}

/**
 * A host state for this page's `tool`, read by the tool's kind, or null.
 * A state of another kind is never read, so an old or a foreign client's
 * state is ignored rather than misread.
 */
export function readRoundState(raw: unknown, tool: VoteRoomTool): RoundStateMessage | null {
  if (isScaleRoomTool(tool)) return readVoteState(raw, tool);
  if (isPairRoomTool(tool)) return readPairState(raw, tool);
  if (isAllocationRoomTool(tool)) return readAllocationState(raw, tool);
  return null;
}

/** What a state asks. */
export function specOfState(msg: RoundStateBody): RoundSpec {
  if (msg.v === 1) return { kind: "scale", questionnaire: msg.questionnaire };
  return msg.kind === "pair"
    ? { kind: "pair", sheet: msg.sheet }
    : { kind: "allocation", sheet: msg.sheet };
}

/** A state's revealed results, or null while open. */
export function revealedOfState(msg: RoundStateBody): RoundRevealed | null {
  if (msg.v === 1) return msg.revealed ? { kind: "scale", rows: msg.revealed } : null;
  if (msg.kind === "pair") return msg.revealed ? { kind: "pair", rows: msg.revealed } : null;
  return msg.revealed ? { kind: "allocation", rows: msg.revealed } : null;
}
