/**
 * Anonymous vote rounds (Health Check, Psych Safety, Mood Tracker; Kano;
 * Buy-a-Feature and the $100 Test; Quick Vote): the wire protocol.
 *
 * A host publishes a questionnaire (questions on one scale) in a visitor
 * room, `visitor:<tool>:<code>`. Participants answer with numbers only, and
 * the host keeps per-question counts. Newer kinds of round ride the same
 * messages: a "pair" round asks two linked questions per item and keeps
 * their joint counts (`pair.ts`), an "allocation" round has each person
 * split a budget across items and keeps per-item totals (`allocation.ts`),
 * a "choice" round picks from options (`choice.ts`), a "rank" round orders
 * them (`rank.ts`) and a "number" round asks for one number (`number.ts`).
 *
 * A tool lists the kinds it may run (`VOTE_ROUND_KINDS`), and each round's
 * state names its kind. The six tools from before keep exactly their one
 * kind; Quick Vote may run several, one per round. Pair and allocation
 * states are v2 (`KIND_STATE_VERSION`); choice, rank and number states are
 * v3 (`PER_ROUND_STATE_VERSION`); scale states, ballots, kicks and ends
 * stay v1 byte for byte, so a client from before reads what it always read
 * and ignores the rest. Nothing else crosses the wire:
 *
 *   host → everyone      "vote:state"   Signed<VoteStateBody>  (throttled
 *                                       500 ms, 500 ms after a join, 30 s
 *                                       keepalive)
 *   participant → host   "vote:ballot"  BallotEnvelope         (one per
 *                                       round, encrypted to the host,
 *                                       re-sent unchanged until acked)
 *   host → everyone      "vote:kick"    Signed<VoteKickBody>
 *   host → everyone      "vote:end"     Signed<VoteEndBody>
 *
 * Security model (see RUNBOOK "Live vote rounds"): a vote room is a visitor
 * room, so the 12-character code keeps strangers out and anyone holding the
 * link is a member. On top of that:
 *  - the host signs every message with an ECDSA P-256 room key. The join
 *    link carries its fingerprint after `#k=` (a fragment, so it never
 *    reaches the server or its logs), and participants pin it: nobody else
 *    can pose as the host to collect answers, kick or end the room;
 *  - answers are a fixed-length string of scale indexes, encrypted in the
 *    participant's browser to the host's per-round ECDH key (P-256, HKDF,
 *    AES-GCM-256), bound to the round, the sender and the ballot id. Other
 *    members see who sent a ballot, never what it says, and every ballot is
 *    the same size;
 *  - the host folds each ballot into counts and drops it. Before Reveal it
 *    shows and sends only how many ballots arrived: no distribution, and no
 *    per-question counts (which would show who skipped what);
 *  - Reveal needs `minN` ballots (3, or 5 for Psych Safety), withholds any
 *    question with fewer answers, and closes the round, so two reveals
 *    can't be diffed to expose the latest answer;
 *  - nothing is written anywhere until the host presses Save, and then only
 *    the totals (`VoteRoundResult`).
 * What it doesn't cover: a host who opens their browser's developer tools
 * sees each ballot with its sender for an instant before folding it; a
 * member can answer again from a new tab (bounded by the seat and ballot
 * caps, and the host is warned); and a member can spend another member's
 * ballot by claiming their id, which can single out one person's answers
 * (the victim's screen and the host are both warned: see `use-vote-room.ts`).
 *
 * Every reader treats its input as hostile: size first, then a strict shape,
 * rebuilt field by field so unknown fields are dropped. Who may send what is
 * the hook's call (`use-vote-room.ts`).
 *
 * Pure and server-safe: no React, no store, no browser globals.
 */

import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { isWithinJsonSize, shareableText } from "../sanitize";
import { VISITOR_LIMITS, isVisitorMemberId, type VisitorTool } from "../visitor-rooms";
import { readSignature, type Signed } from "../room-control";
import {
  B64URL_RE,
  ID_RE,
  ID_RULE,
  IV_RE,
  KEY_RE,
  ROUND_ID_RE,
  b64urlChars,
  isCleanText,
  isCount,
  obj,
} from "./wire";
import type { AllocationSheet, AllocationStateBody } from "./allocation";
import type { ChoiceSheet, ChoiceStateBody } from "./choice";
import type { NumberSheet, NumberStateBody } from "./number";
import type { PairSheet, PairStateBody } from "./pair";
import type { RankSheet, RankStateBody } from "./rank";

export type { Signed } from "../room-control";

// ── Tools, events, limits ────────────────────────────────────────────

/** The tools that run vote rounds (their `VISITOR_ROOM_KIND` is "vote"). */
export const VOTE_ROOM_TOOLS = [
  "health-check",
  "psych-safety",
  "mood-tracker",
  "kano-model",
  "buy-a-feature",
  "hundred-dollar-test",
  "quick-vote",
] as const satisfies readonly VisitorTool[];
export type VoteRoomTool = (typeof VOTE_ROOM_TOOLS)[number];

export function isVoteRoomTool(v: unknown): v is VoteRoomTool {
  return typeof v === "string" && (VOTE_ROOM_TOOLS as readonly string[]).includes(v);
}

/**
 * What a round asks:
 *  - "scale": questions on one scale, one answer each (`Questionnaire`);
 *  - "pair": two questions per item on one short scale, kept as their joint
 *    count per item (Kano's functional and dysfunctional questions, `PairSheet`);
 *  - "allocation": a budget each person splits across items, kept as
 *    per-item totals (Buy-a-Feature, the $100 Test, `AllocationSheet`);
 *  - "choice": one option, several, or a budget of dots spread across up to
 *    12 options, kept as per-option totals (`ChoiceSheet`);
 *  - "rank": up to 10 options put in order, kept as Borda points per
 *    option (`RankSheet`);
 *  - "number": one number in a range, kept as its median, quartiles and a
 *    10-bucket histogram (`NumberSheet`).
 */
export type VoteRoundKind = "scale" | "pair" | "allocation" | "choice" | "rank" | "number";

export const VOTE_ROUND_KIND_LIST = [
  "scale",
  "pair",
  "allocation",
  "choice",
  "rank",
  "number",
] as const satisfies readonly VoteRoundKind[];

export function isVoteRoundKind(v: unknown): v is VoteRoundKind {
  return typeof v === "string" && (VOTE_ROUND_KIND_LIST as readonly string[]).includes(v);
}

/**
 * The kinds of round each vote tool may run, its usual kind first. Each
 * round's state names its kind: the host can start, and a participant will
 * read, only a kind in its tool's list. The six tools from before list
 * exactly their one kind, so their rounds and messages are as they were.
 * Quick Vote may run several, one per round (its 2×2 polls ride "pair").
 */
export const VOTE_ROUND_KINDS = {
  "health-check": ["scale"],
  "psych-safety": ["scale"],
  "mood-tracker": ["scale"],
  "kano-model": ["pair"],
  "buy-a-feature": ["allocation"],
  "hundred-dollar-test": ["allocation"],
  "quick-vote": ["scale", "choice", "rank", "number", "pair"],
} as const satisfies Readonly<Record<VoteRoomTool, readonly VoteRoundKind[]>>;

/** Whether `tool` may run rounds of `kind`. False for anything outside the kit. */
export function toolRunsKind(tool: unknown, kind: unknown): boolean {
  return (
    isVoteRoomTool(tool) &&
    isVoteRoundKind(kind) &&
    (VOTE_ROUND_KINDS[tool] as readonly VoteRoundKind[]).includes(kind)
  );
}

/** The kinds `tool` may run, its usual kind first; [] for a tool outside the kit. */
export function roundKindsOf(tool: unknown): readonly VoteRoundKind[] {
  return isVoteRoomTool(tool) ? VOTE_ROUND_KINDS[tool] : [];
}

/**
 * The kind a tool's round is when none is named: its usual one (the only
 * one for the six tools from before). Null for a tool outside the kit.
 */
export function defaultRoundKind(tool: unknown): VoteRoundKind | null {
  return isVoteRoomTool(tool) ? VOTE_ROUND_KINDS[tool][0] : null;
}

/** Vote tools that may run rounds of kind `K`. */
type ToolsOfKind<K extends VoteRoundKind> = {
  [T in VoteRoomTool]: K extends (typeof VOTE_ROUND_KINDS)[T][number] ? T : never;
}[VoteRoomTool];

/** Tools that may run scale rounds: Health Check, Psych Safety, Mood Tracker, Quick Vote. */
export type ScaleRoomTool = ToolsOfKind<"scale">;
/** Tools that may run pair rounds: Kano, Quick Vote. */
export type PairRoomTool = ToolsOfKind<"pair">;
/** Tools that may run allocation rounds: Buy-a-Feature and the $100 Test. */
export type AllocationRoomTool = ToolsOfKind<"allocation">;
/** Tools that may run choice rounds: Quick Vote. */
export type ChoiceRoomTool = ToolsOfKind<"choice">;
/** Tools that may run rank rounds: Quick Vote. */
export type RankRoomTool = ToolsOfKind<"rank">;
/** Tools that may run number rounds: Quick Vote. */
export type NumberRoomTool = ToolsOfKind<"number">;

/** A tool that may run scale rounds. */
export function isScaleRoomTool(v: unknown): v is ScaleRoomTool {
  return toolRunsKind(v, "scale");
}

/** A tool that may run pair rounds. */
export function isPairRoomTool(v: unknown): v is PairRoomTool {
  return toolRunsKind(v, "pair");
}

/** A tool that may run allocation rounds. */
export function isAllocationRoomTool(v: unknown): v is AllocationRoomTool {
  return toolRunsKind(v, "allocation");
}

/** A tool that may run choice rounds. */
export function isChoiceRoomTool(v: unknown): v is ChoiceRoomTool {
  return toolRunsKind(v, "choice");
}

/** A tool that may run rank rounds. */
export function isRankRoomTool(v: unknown): v is RankRoomTool {
  return toolRunsKind(v, "rank");
}

/** A tool that may run number rounds. */
export function isNumberRoomTool(v: unknown): v is NumberRoomTool {
  return toolRunsKind(v, "number");
}

export const VOTE_ROOM_EVENTS = {
  state: "vote:state",
  ballot: "vote:ballot",
  kick: "vote:kick",
  end: "vote:end",
} as const;
export type VoteRoomEvent = (typeof VOTE_ROOM_EVENTS)[keyof typeof VOTE_ROOM_EVENTS];

export const VOTE_ROOM_PROTOCOL_VERSION = 1 as const;

/**
 * The wire version of pair and allocation states. Scale states, ballots,
 * kicks and ends stay `VOTE_ROOM_PROTOCOL_VERSION` (1): a Phase 6 reader
 * refuses a v2 state on its `v`, and a v2 state signs under its own domain,
 * so neither can pass for the other.
 */
export const KIND_STATE_VERSION = 2 as const;

/**
 * The wire version of choice, rank and number states, which came with
 * per-round kinds. A client from before refuses a v3 state on its `v` (it
 * never joins those rounds anyway: its tool list has no Quick Vote), and a
 * v3 state signs under its own domain.
 */
export const PER_ROUND_STATE_VERSION = 3 as const;

/** The state version a round of `kind` travels as. */
export function stateVersionOf(kind: VoteRoundKind): 1 | 2 | 3 {
  if (kind === "scale") return VOTE_ROOM_PROTOCOL_VERSION;
  if (kind === "pair" || kind === "allocation") return KIND_STATE_VERSION;
  return PER_ROUND_STATE_VERSION;
}

export const VOTE_LIMITS = {
  maxQuestions: 32,
  maxQuestionChars: 200,
  maxHintChars: 200,
  maxTitleChars: 120,
  /** Questionnaire, scale and question ids: room for a UUID with a prefix. */
  maxIdChars: 64,
  minPoints: 2,
  /** One answer character per point index: `ANSWER_ALPHABET` has 11. */
  maxPoints: 11,
  maxPointLabelChars: 40,
  minPointValue: -100,
  maxPointValue: 100,
  /** Largest vote message accepted or sent, in JSON characters. */
  maxPayloadChars: 20_000,
  /**
   * A ballot's ciphertext, base64url: 32 answers (or an 80-byte split,
   * `maxAllocationBytes`) plus the 16-byte tag fit.
   */
  maxCiphertextChars: 128,
  /** Ballot ids the host acknowledges in one state (more than the ballot cap). */
  maxAcks: 64,
  /** Ballots one round accepts: three per seat bounds stuffing from new tabs. */
  maxBallotsPerRound: VISITOR_LIMITS.maxMembers * 3,
  /** Facilitator entry (counted hands or paper): people in one round. */
  maxTallyBallots: 999,
  /** Shortest gap between two states from the host. */
  stateThrottleMs: 500,
  /** The host re-sends this long after the last of a burst of joins. */
  joinDebounceMs: 500,
  /** The lowest minN a round can use: below it one person's answer shows. */
  minNFloor: MIN_SAMPLE.anonymous,
  /** Psych Safety's minN, and its floor: its rounds never reveal from fewer. */
  minNPsychSafety: MIN_SAMPLE.psychSafety,

  // Pair rounds (Kano): `pair.ts`.
  /** Items (features) in one pair round: one answer character each, like a question. */
  maxPairItems: 32,
  /** Answers on a pair's scale. Two answers make one character, so P² ≤ `PAIR_ALPHABET`'s 25. */
  minPairPoints: 2,
  maxPairPoints: 5,
  /** Each of the two questions asked about every item. */
  maxPairPromptChars: 200,

  // Allocation rounds (Buy-a-Feature, the $100 Test): `allocation.ts`.
  minAllocationItems: 2,
  maxAllocationItems: 20,
  /** Whole units each person splits. Four digits at most, so an amount is 2 to 4 characters. */
  minBudget: 10,
  maxBudget: 9_999,
  /** An item's cap (Buy-a-Feature: what's left of its price). */
  maxCap: 1_000_000,
  /** The unit shown with amounts ("$", "pts"). */
  maxUnitChars: 4,
  /**
   * An answer's bytes: items × digits of the budget. 80 plus the 16-byte
   * tag is 96 bytes, exactly `maxCiphertextChars` (128) in base64url, so
   * every allocation ballot fits the envelope reader as it is.
   */
  maxAllocationBytes: 80,
  /**
   * Allocation rounds show who gave an item something, and the bands of the
   * amounts, only from this many answers (`MIN_SAMPLE.distribution`). A
   * split's bands are linked across items, so at three answers they would
   * narrow each person's split more than one scale answer does.
   */
  minNSpread: MIN_SAMPLE.distribution,

  // Choice rounds (poll, multi-pick, dot voting): `choice.ts`.
  minChoiceOptions: 2,
  /** One answer character per option. */
  maxChoiceOptions: 12,
  /** Dots one person spreads; one option can take them all (one character, `ANSWER_ALPHABET`). */
  maxDots: 10,
  /** An option's text in a choice or rank round. */
  maxOptionChars: 120,

  // Rank rounds: `rank.ts`.
  minRankOptions: 2,
  /** One digit per place. */
  maxRankOptions: 10,

  // Number rounds (guess the number, confidence): `number.ts`.
  /** The largest number either end of the range may be, either side of 0. */
  maxNumberAbs: 1_000_000,
  /** Decimal places an answer may have. */
  maxNumberDecimals: 2,
  /** Answers the range holds at its decimals, at most (8 digits on the wire). */
  maxNumberSteps: 10_000_000,
  /** The unit shown with numbers ("days", "%"). */
  maxNumberUnitChars: 8,
  /** Buckets in a number round's histogram. */
  numberBuckets: 10,
} as const;

/**
 * The lowest minN `tool` may use: 5 for Psych Safety (its questions can
 * point at a person in a small team), 3 otherwise. The host
 * (`effectiveMinN`), the facilitator entry and every participant
 * (`readVoteState`) apply it, so a tool page that leaves out its `minN`
 * still can't reveal Psych Safety from three answers.
 */
export function voteMinNFloor(tool?: VoteRoomTool): number {
  return tool === "psych-safety" ? VOTE_LIMITS.minNPsychSafety : VOTE_LIMITS.minNFloor;
}

/** Answer characters: the i-th is point index i. */
export const ANSWER_ALPHABET = "0123456789a";
/** The answer character for a skipped (optional) question. */
export const SKIPPED = "-";

// ── Shapes ───────────────────────────────────────────────────────────

export interface VoteScalePoint {
  /** What the point counts as (Green = 2, "Strongly agree" = 5). */
  value: number;
  label: string;
}

export interface VoteScale {
  id: string;
  /** In display order; answers and distributions use these indexes. */
  points: VoteScalePoint[];
}

export interface VoteQuestion {
  id: string;
  text: string;
  hint?: string;
  /** People may skip it. Required questions must be answered to send. */
  optional?: boolean;
}

/** What a tool asks: questions, all on one scale. */
export interface Questionnaire {
  id: string;
  title: string;
  scale: VoteScale;
  questions: VoteQuestion[];
}

/** The host's public keys: raw uncompressed P-256 points, base64url (87 characters each). */
export interface HostKeys {
  /** ECDSA, one per room. Its fingerprint is the join link's `#k=`. */
  sig: string;
  /** ECDH, one per round: ballots are encrypted to it. */
  ecdh: string;
}

export type RoundPhase = "open" | "revealed";

/** One question's revealed result. */
export interface RevealedQuestion {
  /** Ballots that answered it (not skipped). */
  responses: number;
  /** Count per scale point, in `scale.points` order. Null: withheld, fewer than minN answers. */
  distribution: number[] | null;
}

export interface VoteStateBody {
  v: 1;
  /** The host's member id. */
  by: string;
  /** Rises with every state the host sends; participants drop anything older. */
  seq: number;
  tool: VoteRoomTool;
  /** nanoid(12), new every round. */
  roundId: string;
  /** Epoch ms when the room closes for everyone (start + 3 h). */
  endsAt: number;
  minN: number;
  questionnaire: Questionnaire;
  keys: HostKeys;
  phase: RoundPhase;
  /** Ballots counted this round. Never per question before Reveal. */
  ballots: number;
  /** Accepted ballot ids, oldest first, so senders know they counted. [] once revealed. */
  acks: string[];
  /** Non-null exactly when the phase is "revealed". */
  revealed: RevealedQuestion[] | null;
}

export interface VoteKickBody {
  v: 1;
  by: string;
  /** The member being removed. */
  id: string;
}

export interface VoteEndBody {
  v: 1;
  by: string;
  reason: "host" | "idle" | "expired";
}

export type VoteStateMessage = Signed<VoteStateBody>;

/** One participant's answers, encrypted to the host's round key. */
export interface BallotEnvelope {
  v: 1;
  /** The sender's presence key. */
  by: string;
  roundId: string;
  /** Ballot id, nanoid(12): the host acknowledges it in `acks`. */
  bid: string;
  /** The sender's ephemeral ECDH public key (87 characters). */
  epk: string;
  /** AES-GCM nonce, 12 bytes (16 characters). */
  iv: string;
  /** AES-GCM ciphertext plus tag of the `AnswerString`. */
  ct: string;
}

/**
 * Answers as they are encrypted: `length === questions.length`, character i
 * is question i's point index in `ANSWER_ALPHABET`, or `SKIPPED` (optional
 * questions only). Fixed length, so the ciphertext's size says nothing.
 */
export type AnswerString = string;

/** A participant's form: question id → chosen point value; null while not chosen. */
export type AnswerDraft = Record<string, number | null>;

// ── Signing ──────────────────────────────────────────────────────────

const SIGNING_DOMAIN = "agile-toolkit:vote-room:v1";
/** Pair and allocation states: a domain of their own, so no v2 signature verifies as v1. */
const SIGNING_DOMAIN_V2 = "agile-toolkit:vote-room:v2";

function questionnaireTuple(q: Questionnaire): unknown[] {
  return [
    q.id,
    q.title,
    q.scale.id,
    q.scale.points.map((p) => [p.value, p.label]),
    q.questions.map((x) => [x.id, x.text, x.hint ?? null, x.optional === true]),
  ];
}

function pairSheetTuple(s: PairSheet): unknown[] {
  return [
    s.id,
    s.title,
    [s.prompts.first, s.prompts.second],
    s.answers,
    s.items.map((x) => [x.id, x.text, x.hint ?? null, x.optional === true]),
  ];
}

function allocationSheetTuple(s: AllocationSheet): unknown[] {
  return [
    s.id,
    s.title,
    s.budget,
    s.unit,
    s.spendAll,
    s.items.map((x) => [x.id, x.text, x.hint ?? null, x.cap ?? null]),
  ];
}

/** A pair or allocation state's signed text: the v1 order, with the kind and its sheet. */
function kindStateInput(event: VoteRoomEvent, body: PairStateBody | AllocationStateBody): string {
  const sheet =
    body.kind === "allocation" ? allocationSheetTuple(body.sheet) : pairSheetTuple(body.sheet);
  let revealed: unknown = null;
  if (body.revealed !== null) {
    revealed =
      body.kind === "allocation"
        ? body.revealed.map((r) => [r.total, r.backers, r.bands])
        : body.revealed.map((r) => [r.responses, r.joint]);
  }
  return JSON.stringify([
    SIGNING_DOMAIN_V2,
    event,
    body.v,
    body.by,
    body.seq,
    body.tool,
    body.roundId,
    body.endsAt,
    body.minN,
    body.kind,
    sheet,
    body.keys.sig,
    body.keys.ecdh,
    body.phase,
    body.ballots,
    body.acks,
    revealed,
  ]);
}

/** Choice, rank and number states: a domain of their own, so no v3 signature verifies as v1 or v2. */
const SIGNING_DOMAIN_V3 = "agile-toolkit:vote-room:v3";

type PerRoundStateBody = ChoiceStateBody | RankStateBody | NumberStateBody;

function optionTuples(options: readonly { id: string; text: string; hint?: string }[]): unknown[] {
  return options.map((x) => [x.id, x.text, x.hint ?? null]);
}

function choiceSheetTuple(s: ChoiceSheet): unknown[] {
  return [s.id, s.title, s.mode, s.limit, optionTuples(s.options)];
}

function rankSheetTuple(s: RankSheet): unknown[] {
  return [s.id, s.title, optionTuples(s.options)];
}

function numberSheetTuple(s: NumberSheet): unknown[] {
  return [s.id, s.title, s.min, s.max, s.decimals, s.unit, s.hint ?? null];
}

/** A choice, rank or number state's signed text: the v2 order under the v3 domain. */
function perRoundStateInput(event: VoteRoomEvent, body: PerRoundStateBody): string {
  let sheet: unknown[];
  let revealed: unknown = null;
  switch (body.kind) {
    case "choice":
      sheet = choiceSheetTuple(body.sheet);
      if (body.revealed !== null) revealed = body.revealed.map((r) => [r.total, r.backers]);
      break;
    case "rank":
      sheet = rankSheetTuple(body.sheet);
      if (body.revealed !== null) revealed = body.revealed.map((r) => [r.points]);
      break;
    case "number": {
      sheet = numberSheetTuple(body.sheet);
      const r = body.revealed;
      if (r !== null) {
        revealed = [
          r.count,
          r.median,
          r.spread === null
            ? null
            : [r.spread.min, r.spread.q1, r.spread.q3, r.spread.max, r.spread.histogram],
        ];
      }
      break;
    }
  }
  return JSON.stringify([
    SIGNING_DOMAIN_V3,
    event,
    body.v,
    body.by,
    body.seq,
    body.tool,
    body.roundId,
    body.endsAt,
    body.minN,
    body.kind,
    sheet,
    body.keys.sig,
    body.keys.ecdh,
    body.phase,
    body.ballots,
    body.acks,
    revealed,
  ]);
}

function isPerRoundBody(
  body: PairStateBody | AllocationStateBody | PerRoundStateBody
): body is PerRoundStateBody {
  return body.kind === "choice" || body.kind === "rank" || body.kind === "number";
}

/** Any host state body, of any kind. */
export type AnyVoteStateBody =
  | VoteStateBody
  | PairStateBody
  | AllocationStateBody
  | ChoiceStateBody
  | RankStateBody
  | NumberStateBody;

/**
 * The text the host signs for `event`: a JSON array of the field values in
 * a fixed order, so the signature never depends on key order, and the
 * event name is part of it, so a state's signature can't pass for a kick's.
 * Scale states sign exactly as in Phase 6; pair and allocation states sign
 * under the v2 domain with their kind; choice, rank and number states under
 * the v3 domain with theirs.
 */
export function signingInput(
  event: VoteRoomEvent,
  body: AnyVoteStateBody | VoteKickBody | VoteEndBody
): string {
  if (event === VOTE_ROOM_EVENTS.state && "kind" in body) {
    return isPerRoundBody(body) ? perRoundStateInput(event, body) : kindStateInput(event, body);
  }
  const head = [SIGNING_DOMAIN, event, body.v, body.by];
  if (event === VOTE_ROOM_EVENTS.state && "questionnaire" in body) {
    return JSON.stringify([
      ...head,
      body.seq,
      body.tool,
      body.roundId,
      body.endsAt,
      body.minN,
      questionnaireTuple(body.questionnaire),
      body.keys.sig,
      body.keys.ecdh,
      body.phase,
      body.ballots,
      body.acks,
      body.revealed === null ? null : body.revealed.map((r) => [r.responses, r.distribution]),
    ]);
  }
  if (event === VOTE_ROOM_EVENTS.kick && "id" in body) return JSON.stringify([...head, body.id]);
  if (event === VOTE_ROOM_EVENTS.end && "reason" in body) {
    return JSON.stringify([...head, body.reason]);
  }
  // A body that doesn't match its event: sign something no reader accepts.
  return JSON.stringify([...head, "mismatch"]);
}

// ── Host side: what it may share ─────────────────────────────────────

function isPointValue(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= VOTE_LIMITS.minPointValue &&
    v <= VOTE_LIMITS.maxPointValue
  );
}

type WireCheck = { ok: true; questionnaire: Questionnaire } | { ok: false; problem: string };

/** `toWireQuestionnaire` and `questionnaireProblem` in one pass. */
function checkQuestionnaire(q: Questionnaire): WireCheck {
  const no = (problem: string): WireCheck => ({ ok: false, problem });
  if (!q || typeof q !== "object") return no("There are no questions to share.");
  if (typeof q.id !== "string" || !ID_RE.test(q.id)) {
    return no(`The questions' id can't be shared live: ${ID_RULE}.`);
  }
  const title = shareableText(String(q.title ?? ""), VOTE_LIMITS.maxTitleChars);
  if (!title) return no("The round needs a title.");
  const scale = q.scale;
  if (!scale || typeof scale.id !== "string" || !ID_RE.test(scale.id)) {
    return no(`The scale's id can't be shared live: ${ID_RULE}.`);
  }
  if (
    !Array.isArray(scale.points) ||
    scale.points.length < VOTE_LIMITS.minPoints ||
    scale.points.length > VOTE_LIMITS.maxPoints
  ) {
    return no(
      `The scale needs ${VOTE_LIMITS.minPoints} to ${VOTE_LIMITS.maxPoints} answers to pick from.`
    );
  }
  const values = new Set<number>();
  const points: VoteScalePoint[] = [];
  for (const p of scale.points) {
    if (!p || !isPointValue(p.value) || values.has(p.value)) {
      return no(
        `Each answer on the scale needs its own whole-number value from ${VOTE_LIMITS.minPointValue} to ${VOTE_LIMITS.maxPointValue}.`
      );
    }
    values.add(p.value);
    const label = shareableText(String(p.label ?? ""), VOTE_LIMITS.maxPointLabelChars);
    if (!label) return no("Every answer on the scale needs a label.");
    points.push({ value: p.value, label });
  }
  if (!Array.isArray(q.questions) || q.questions.length < 1) {
    return no("Add at least one question.");
  }
  if (q.questions.length > VOTE_LIMITS.maxQuestions) {
    return no(`A live round can ask at most ${VOTE_LIMITS.maxQuestions} questions.`);
  }
  const ids = new Set<string>();
  const questions: VoteQuestion[] = [];
  for (let i = 0; i < q.questions.length; i++) {
    const x = q.questions[i];
    if (!x || typeof x.id !== "string" || !ID_RE.test(x.id)) {
      return no(`Question ${i + 1}'s id can't be shared live: ${ID_RULE}.`);
    }
    if (ids.has(x.id)) return no(`Question ${i + 1} has the same id as an earlier question.`);
    ids.add(x.id);
    const text = shareableText(String(x.text ?? ""), VOTE_LIMITS.maxQuestionChars);
    if (!text) return no(`Question ${i + 1} needs text.`);
    const question: VoteQuestion = { id: x.id, text };
    const hint = typeof x.hint === "string" ? shareableText(x.hint, VOTE_LIMITS.maxHintChars) : "";
    if (hint) question.hint = hint;
    if (x.optional === true) question.optional = true;
    questions.push(question);
  }
  return {
    ok: true,
    questionnaire: { id: q.id, title, scale: { id: scale.id, points }, questions },
  };
}

/**
 * The questionnaire as the host may share it, rebuilt field by field: text
 * on one line with hidden characters stripped and cut to the caps, ids and
 * values checked. Null when it can't be shared (an id the protocol can't
 * carry, a blank title or question, a scale out of range, duplicates);
 * `questionnaireProblem` says which.
 */
export function toWireQuestionnaire(q: Questionnaire): Questionnaire | null {
  const checked = checkQuestionnaire(q);
  return checked.ok ? checked.questionnaire : null;
}

/**
 * Why `q` can't be shared live, in one sentence for the host ("Question 3
 * needs text."), or null when it can. The panel checks it before offering a
 * live round, so nobody consents to a round that can't start.
 */
export function questionnaireProblem(q: Questionnaire): string | null {
  const checked = checkQuestionnaire(q);
  return checked.ok ? null : checked.problem;
}

// ── Answers ──────────────────────────────────────────────────────────

/**
 * The answer string for `draft`, or null when a required question is
 * unanswered, a value isn't on the scale, or nothing at all was answered.
 */
export function encodeAnswers(draft: AnswerDraft, q: Questionnaire): AnswerString | null {
  let out = "";
  let answered = 0;
  for (const question of q.questions) {
    const v = Object.prototype.hasOwnProperty.call(draft, question.id) ? draft[question.id] : null;
    if (v === null || v === undefined) {
      if (question.optional !== true) return null;
      out += SKIPPED;
      continue;
    }
    const idx = q.scale.points.findIndex((p) => p.value === v);
    if (idx < 0 || idx >= ANSWER_ALPHABET.length) return null;
    out += ANSWER_ALPHABET[idx];
    answered++;
  }
  return answered > 0 ? out : null;
}

/**
 * A decrypted answer string as point indexes (-1 for skipped), or null:
 * wrong length, a character outside the scale, a skipped required question,
 * or nothing answered.
 */
export function readAnswerString(plain: string, q: Questionnaire): number[] | null {
  if (typeof plain !== "string" || plain.length !== q.questions.length) return null;
  const out: number[] = [];
  let answered = 0;
  for (let i = 0; i < plain.length; i++) {
    const c = plain[i];
    if (c === SKIPPED) {
      if (q.questions[i].optional !== true) return null;
      out.push(-1);
      continue;
    }
    const idx = ANSWER_ALPHABET.indexOf(c);
    if (idx < 0 || idx >= q.scale.points.length) return null;
    out.push(idx);
    answered++;
  }
  return answered > 0 ? out : null;
}

/**
 * The exact ciphertext length (base64url) of a ballot for `questionCount`
 * questions: one byte per answer plus the 16-byte GCM tag. The host drops a
 * ballot of any other length before decrypting it.
 */
export function ballotCiphertextChars(questionCount: number): number {
  return b64urlChars(questionCount + 16);
}

// ── Readers ──────────────────────────────────────────────────────────

/** A questionnaire from the wire, or null. Accepts exactly what `toWireQuestionnaire` builds. */
function readQuestionnaire(raw: unknown): Questionnaire | null {
  const q = obj(raw);
  if (!q || typeof q.id !== "string" || !ID_RE.test(q.id)) return null;
  if (!isCleanText(q.title, VOTE_LIMITS.maxTitleChars)) return null;
  const s = obj(q.scale);
  if (!s || typeof s.id !== "string" || !ID_RE.test(s.id) || !Array.isArray(s.points)) return null;
  if (s.points.length < VOTE_LIMITS.minPoints || s.points.length > VOTE_LIMITS.maxPoints) {
    return null;
  }
  const values = new Set<number>();
  const points: VoteScalePoint[] = [];
  for (const rawPoint of s.points) {
    const p = obj(rawPoint);
    if (!p || !isPointValue(p.value) || values.has(p.value)) return null;
    if (!isCleanText(p.label, VOTE_LIMITS.maxPointLabelChars)) return null;
    values.add(p.value);
    points.push({ value: p.value, label: p.label });
  }
  if (!Array.isArray(q.questions)) return null;
  if (q.questions.length < 1 || q.questions.length > VOTE_LIMITS.maxQuestions) return null;
  const ids = new Set<string>();
  const questions: VoteQuestion[] = [];
  for (const rawQuestion of q.questions) {
    const x = obj(rawQuestion);
    if (!x || typeof x.id !== "string" || !ID_RE.test(x.id) || ids.has(x.id)) return null;
    if (!isCleanText(x.text, VOTE_LIMITS.maxQuestionChars)) return null;
    if (x.hint !== undefined && !isCleanText(x.hint, VOTE_LIMITS.maxHintChars)) return null;
    if (x.optional !== undefined && typeof x.optional !== "boolean") return null;
    ids.add(x.id);
    const question: VoteQuestion = { id: x.id, text: x.text };
    if (typeof x.hint === "string") question.hint = x.hint;
    if (x.optional === true) question.optional = true;
    questions.push(question);
  }
  return { id: q.id, title: q.title, scale: { id: s.id, points }, questions };
}

function readRevealed(
  raw: unknown,
  q: Questionnaire,
  ballots: number,
  minN: number
): RevealedQuestion[] | null {
  if (!Array.isArray(raw) || raw.length !== q.questions.length) return null;
  const out: RevealedQuestion[] = [];
  for (const rawQuestion of raw) {
    const r = obj(rawQuestion);
    if (!r || !isCount(r.responses, ballots)) return null;
    if (r.distribution === null) {
      out.push({ responses: r.responses, distribution: null });
      continue;
    }
    // A distribution only from minN answers: a state that shows fewer is refused.
    if (r.responses < minN) return null;
    const d = r.distribution;
    if (!Array.isArray(d) || d.length !== q.scale.points.length) return null;
    let sum = 0;
    for (const n of d) {
      if (!isCount(n, ballots)) return null;
      sum += n;
    }
    if (sum !== r.responses) return null;
    out.push({ responses: r.responses, distribution: d.slice() as number[] });
  }
  return out;
}

/**
 * A host state for this page's `tool`, or null. Checks shape, caps and the
 * reveal rules; whether the signature is the pinned host's is the hook's
 * call (it needs WebCrypto). Scale rounds only, for a tool that may run
 * them: other kinds' states are read by their own readers (`readPairState`,
 * `readAllocationState`, …; `readRoundState` picks).
 */
export function readVoteState(raw: unknown, tool: VoteRoomTool): VoteStateMessage | null {
  if (!isWithinJsonSize(raw, VOTE_LIMITS.maxPayloadChars)) return null;
  const m = obj(raw);
  if (!m || m.v !== VOTE_ROOM_PROTOCOL_VERSION || !isVisitorMemberId(m.by)) return null;
  if (typeof m.seq !== "number" || !Number.isSafeInteger(m.seq) || m.seq < 0) return null;
  if (m.tool !== tool || !isVoteRoomTool(m.tool)) return null;
  if (!toolRunsKind(m.tool, "scale")) return null;
  if (typeof m.roundId !== "string" || !ROUND_ID_RE.test(m.roundId)) return null;
  if (typeof m.endsAt !== "number" || !Number.isFinite(m.endsAt) || m.endsAt <= 0) return null;
  // The tool's floor, whatever the host claims: Psych Safety never shows fewer than 5.
  if (
    typeof m.minN !== "number" ||
    !Number.isInteger(m.minN) ||
    m.minN < voteMinNFloor(m.tool) ||
    m.minN > VISITOR_LIMITS.maxMembers
  ) {
    return null;
  }
  const questionnaire = readQuestionnaire(m.questionnaire);
  if (!questionnaire) return null;
  const keys = obj(m.keys);
  if (!keys || typeof keys.sig !== "string" || !KEY_RE.test(keys.sig)) return null;
  if (typeof keys.ecdh !== "string" || !KEY_RE.test(keys.ecdh)) return null;
  const sig = readSignature(m);
  if (!sig) return null;
  if (m.phase !== "open" && m.phase !== "revealed") return null;
  if (!isCount(m.ballots, VOTE_LIMITS.maxBallotsPerRound)) return null;
  if (!Array.isArray(m.acks) || m.acks.length > VOTE_LIMITS.maxAcks) return null;
  const acks: string[] = [];
  for (const a of m.acks) {
    if (typeof a !== "string" || !ROUND_ID_RE.test(a)) return null;
    acks.push(a);
  }
  let revealed: RevealedQuestion[] | null = null;
  if (m.phase === "open") {
    if (m.revealed !== null) return null;
  } else {
    // Revealed: enough ballots, the ledger of who answered gone, results per the rules.
    if (m.ballots < m.minN || acks.length > 0) return null;
    revealed = readRevealed(m.revealed, questionnaire, m.ballots, m.minN);
    if (!revealed) return null;
  }
  return {
    v: 1,
    by: m.by,
    seq: m.seq,
    tool: m.tool,
    roundId: m.roundId,
    endsAt: m.endsAt,
    minN: m.minN,
    questionnaire,
    keys: { sig: keys.sig, ecdh: keys.ecdh },
    phase: m.phase,
    ballots: m.ballots,
    acks,
    revealed,
    sig,
  };
}

/** What every state of a kind other than scale carries besides its sheet and results. */
export interface KindStateHead {
  by: string;
  seq: number;
  roundId: string;
  endsAt: number;
  minN: number;
  keys: HostKeys;
  phase: RoundPhase;
  ballots: number;
  acks: string[];
  sig: string;
}

/**
 * The common part of a v2 (pair, allocation) or v3 (choice, rank, number)
 * state for this page's `tool`, read and checked as `readVoteState` checks
 * a scale state's: the version (the kind's own, `stateVersionOf`), the kind
 * (which must be one the tool may run), sender, sequence, round, minN
 * (never under the tool's floor), keys, signature, phase, ballot count and
 * acks, and the reveal rules that don't depend on the sheet (enough
 * ballots, no acks once revealed). The kind's reader checks the sheet and
 * the revealed results. Null when anything is off.
 */
export function readKindStateHead(
  m: Record<string, unknown>,
  tool: VoteRoomTool,
  kind: Exclude<VoteRoundKind, "scale">
): KindStateHead | null {
  if (m.v !== stateVersionOf(kind) || m.kind !== kind || !isVisitorMemberId(m.by)) return null;
  if (typeof m.seq !== "number" || !Number.isSafeInteger(m.seq) || m.seq < 0) return null;
  if (m.tool !== tool || !isVoteRoomTool(m.tool) || !toolRunsKind(m.tool, kind)) return null;
  if (typeof m.roundId !== "string" || !ROUND_ID_RE.test(m.roundId)) return null;
  if (typeof m.endsAt !== "number" || !Number.isFinite(m.endsAt) || m.endsAt <= 0) return null;
  if (
    typeof m.minN !== "number" ||
    !Number.isInteger(m.minN) ||
    m.minN < voteMinNFloor(m.tool) ||
    m.minN > VISITOR_LIMITS.maxMembers
  ) {
    return null;
  }
  const keys = obj(m.keys);
  if (!keys || typeof keys.sig !== "string" || !KEY_RE.test(keys.sig)) return null;
  if (typeof keys.ecdh !== "string" || !KEY_RE.test(keys.ecdh)) return null;
  const sig = readSignature(m);
  if (!sig) return null;
  if (m.phase !== "open" && m.phase !== "revealed") return null;
  if (!isCount(m.ballots, VOTE_LIMITS.maxBallotsPerRound)) return null;
  if (!Array.isArray(m.acks) || m.acks.length > VOTE_LIMITS.maxAcks) return null;
  const acks: string[] = [];
  for (const a of m.acks) {
    if (typeof a !== "string" || !ROUND_ID_RE.test(a)) return null;
    acks.push(a);
  }
  if (m.phase === "open") {
    if (m.revealed !== null) return null;
  } else if (m.ballots < m.minN || acks.length > 0) {
    // Revealed: enough ballots, and the ledger of who answered gone.
    return null;
  }
  return {
    by: m.by,
    seq: m.seq,
    roundId: m.roundId,
    endsAt: m.endsAt,
    minN: m.minN,
    keys: { sig: keys.sig, ecdh: keys.ecdh },
    phase: m.phase,
    ballots: m.ballots,
    acks,
    sig,
  };
}

/** A ballot's envelope, or null. Its contents are checked after decryption (`readAnswerString`). */
export function readBallotEnvelope(raw: unknown): BallotEnvelope | null {
  if (!isWithinJsonSize(raw, VOTE_LIMITS.maxPayloadChars)) return null;
  const m = obj(raw);
  if (!m || m.v !== VOTE_ROOM_PROTOCOL_VERSION || !isVisitorMemberId(m.by)) return null;
  if (typeof m.roundId !== "string" || !ROUND_ID_RE.test(m.roundId)) return null;
  if (typeof m.bid !== "string" || !ROUND_ID_RE.test(m.bid)) return null;
  if (typeof m.epk !== "string" || !KEY_RE.test(m.epk)) return null;
  if (typeof m.iv !== "string" || !IV_RE.test(m.iv)) return null;
  if (
    typeof m.ct !== "string" ||
    m.ct.length < ballotCiphertextChars(1) ||
    m.ct.length > VOTE_LIMITS.maxCiphertextChars ||
    !B64URL_RE.test(m.ct)
  ) {
    return null;
  }
  return { v: 1, by: m.by, roundId: m.roundId, bid: m.bid, epk: m.epk, iv: m.iv, ct: m.ct };
}

/** A signed kick, or null. The signature is checked against the pinned key by the hook. */
export function readVoteKick(raw: unknown): Signed<VoteKickBody> | null {
  if (!isWithinJsonSize(raw, VOTE_LIMITS.maxPayloadChars)) return null;
  const m = obj(raw);
  if (!m || m.v !== VOTE_ROOM_PROTOCOL_VERSION) return null;
  if (!isVisitorMemberId(m.by) || !isVisitorMemberId(m.id)) return null;
  const sig = readSignature(m);
  if (!sig) return null;
  return { v: 1, by: m.by, id: m.id, sig };
}

/** A signed end, or null. The signature is checked against the pinned key by the hook. */
export function readVoteEnd(raw: unknown): Signed<VoteEndBody> | null {
  if (!isWithinJsonSize(raw, VOTE_LIMITS.maxPayloadChars)) return null;
  const m = obj(raw);
  if (!m || m.v !== VOTE_ROOM_PROTOCOL_VERSION || !isVisitorMemberId(m.by)) return null;
  if (m.reason !== "host" && m.reason !== "idle" && m.reason !== "expired") return null;
  const sig = readSignature(m);
  if (!sig) return null;
  return { v: 1, by: m.by, reason: m.reason, sig };
}
