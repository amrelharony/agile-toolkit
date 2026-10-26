/**
 * Anonymous vote rounds (Health Check, Psych Safety, Mood Tracker): the wire
 * protocol.
 *
 * A host publishes a questionnaire (questions on one scale) in a visitor
 * room, `visitor:<tool>:<code>`. Participants answer with numbers only, and
 * the host keeps per-question counts. Nothing else crosses the wire:
 *
 *   host → everyone      "vote:state"   Signed<VoteStateBody>  (throttled
 *                                       500 ms, 500 ms after a join, 30 s
 *                                       keepalive)
 *   participant → host   "vote:ballot"  BallotEnvelope         (one per
 *                                       round, encrypted to the host)
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
 * What it doesn't cover: a host who modifies their own browser sees each
 * ballot with its sender for an instant before folding it, and a member can
 * answer again from a new tab (bounded by the seat and ballot caps, and the
 * host is warned).
 *
 * Every reader treats its input as hostile: size first, then a strict shape,
 * rebuilt field by field so unknown fields are dropped. Who may send what is
 * the hook's call (`use-vote-room.ts`).
 *
 * Pure and server-safe: no React, no store, no browser globals.
 */

import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { cleanText, isWithinJsonSize, shareableText } from "../sanitize";
import { VISITOR_LIMITS, isVisitorMemberId, type VisitorTool } from "../visitor-rooms";
import { readSignature, type Signed } from "../room-control";

export type { Signed } from "../room-control";

// ── Tools, events, limits ────────────────────────────────────────────

/** The tools that run vote rounds (their `VISITOR_ROOM_KIND` is "vote"). */
export const VOTE_ROOM_TOOLS = [
  "health-check",
  "psych-safety",
  "mood-tracker",
] as const satisfies readonly VisitorTool[];
export type VoteRoomTool = (typeof VOTE_ROOM_TOOLS)[number];

export function isVoteRoomTool(v: unknown): v is VoteRoomTool {
  return typeof v === "string" && (VOTE_ROOM_TOOLS as readonly string[]).includes(v);
}

export const VOTE_ROOM_EVENTS = {
  state: "vote:state",
  ballot: "vote:ballot",
  kick: "vote:kick",
  end: "vote:end",
} as const;
export type VoteRoomEvent = (typeof VOTE_ROOM_EVENTS)[keyof typeof VOTE_ROOM_EVENTS];

export const VOTE_ROOM_PROTOCOL_VERSION = 1 as const;

export const VOTE_LIMITS = {
  maxQuestions: 32,
  maxQuestionChars: 200,
  maxHintChars: 200,
  maxTitleChars: 120,
  /** Questionnaire, scale and question ids. */
  maxIdChars: 32,
  minPoints: 2,
  /** One answer character per point index: `ANSWER_ALPHABET` has 11. */
  maxPoints: 11,
  maxPointLabelChars: 40,
  minPointValue: -100,
  maxPointValue: 100,
  /** Largest vote message accepted or sent, in JSON characters. */
  maxPayloadChars: 20_000,
  /** A ballot's ciphertext, base64url: 32 answers plus the 16-byte tag fit. */
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
  /** Psych Safety's minN. */
  minNPsychSafety: MIN_SAMPLE.psychSafety,
} as const;

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

function questionnaireTuple(q: Questionnaire): unknown[] {
  return [
    q.id,
    q.title,
    q.scale.id,
    q.scale.points.map((p) => [p.value, p.label]),
    q.questions.map((x) => [x.id, x.text, x.hint ?? null, x.optional === true]),
  ];
}

/**
 * The text the host signs for `event`: a JSON array of the field values in
 * a fixed order, so the signature never depends on key order, and the
 * event name is part of it, so a state's signature can't pass for a kick's.
 */
export function signingInput(
  event: VoteRoomEvent,
  body: VoteStateBody | VoteKickBody | VoteEndBody
): string {
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

const ID_RE = /^[A-Za-z0-9:_-]{1,32}$/;
const ROUND_ID_RE = /^[A-Za-z0-9_-]{12}$/;
/** A raw P-256 public key (65 bytes), unpadded base64url. */
const KEY_RE = /^[A-Za-z0-9_-]{87}$/;
/** A 12-byte AES-GCM nonce, unpadded base64url. */
const IV_RE = /^[A-Za-z0-9_-]{16}$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

function isPointValue(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= VOTE_LIMITS.minPointValue &&
    v <= VOTE_LIMITS.maxPointValue
  );
}

/**
 * The questionnaire as the host may share it, rebuilt field by field: text
 * on one line with hidden characters stripped and cut to the caps, ids and
 * values checked. Null when it can't be shared (an id the protocol can't
 * carry, a blank title or question, a scale out of range, duplicates).
 */
export function toWireQuestionnaire(q: Questionnaire): Questionnaire | null {
  if (!q || typeof q !== "object") return null;
  if (typeof q.id !== "string" || !ID_RE.test(q.id)) return null;
  const title = shareableText(String(q.title ?? ""), VOTE_LIMITS.maxTitleChars);
  if (!title) return null;
  const scale = q.scale;
  if (!scale || typeof scale.id !== "string" || !ID_RE.test(scale.id)) return null;
  if (!Array.isArray(scale.points)) return null;
  if (scale.points.length < VOTE_LIMITS.minPoints || scale.points.length > VOTE_LIMITS.maxPoints) {
    return null;
  }
  const values = new Set<number>();
  const points: VoteScalePoint[] = [];
  for (const p of scale.points) {
    if (!p || !isPointValue(p.value) || values.has(p.value)) return null;
    values.add(p.value);
    const label = shareableText(String(p.label ?? ""), VOTE_LIMITS.maxPointLabelChars);
    if (!label) return null;
    points.push({ value: p.value, label });
  }
  if (!Array.isArray(q.questions)) return null;
  if (q.questions.length < 1 || q.questions.length > VOTE_LIMITS.maxQuestions) return null;
  const ids = new Set<string>();
  const questions: VoteQuestion[] = [];
  for (const x of q.questions) {
    if (!x || typeof x.id !== "string" || !ID_RE.test(x.id) || ids.has(x.id)) return null;
    ids.add(x.id);
    const text = shareableText(String(x.text ?? ""), VOTE_LIMITS.maxQuestionChars);
    if (!text) return null;
    const question: VoteQuestion = { id: x.id, text };
    const hint = typeof x.hint === "string" ? shareableText(x.hint, VOTE_LIMITS.maxHintChars) : "";
    if (hint) question.hint = hint;
    if (x.optional === true) question.optional = true;
    questions.push(question);
  }
  return { id: q.id, title, scale: { id: scale.id, points }, questions };
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

/** Unpadded base64url length of `bytes` bytes. */
function b64urlChars(bytes: number): number {
  return Math.floor(bytes / 3) * 4 + (bytes % 3 === 0 ? 0 : (bytes % 3) + 1);
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

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const isCount = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

/** Text a participant will render: exactly what `cleanText` makes of it. */
const isCleanText = (v: unknown, max: number): v is string =>
  typeof v === "string" && cleanText(v, max) === v;

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
 * call (it needs WebCrypto).
 */
export function readVoteState(raw: unknown, tool: VoteRoomTool): VoteStateMessage | null {
  if (!isWithinJsonSize(raw, VOTE_LIMITS.maxPayloadChars)) return null;
  const m = obj(raw);
  if (!m || m.v !== VOTE_ROOM_PROTOCOL_VERSION || !isVisitorMemberId(m.by)) return null;
  if (typeof m.seq !== "number" || !Number.isSafeInteger(m.seq) || m.seq < 0) return null;
  if (m.tool !== tool || !isVoteRoomTool(m.tool)) return null;
  if (typeof m.roundId !== "string" || !ROUND_ID_RE.test(m.roundId)) return null;
  if (typeof m.endsAt !== "number" || !Number.isFinite(m.endsAt) || m.endsAt <= 0) return null;
  if (
    typeof m.minN !== "number" ||
    !Number.isInteger(m.minN) ||
    m.minN < VOTE_LIMITS.minNFloor ||
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
