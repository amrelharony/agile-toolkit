/**
 * Rank rounds (Quick Vote's ranking): each person puts 2 to 10 options in
 * order, and the host keeps Borda points per option.
 *
 * A participant answers with every option's place: the ballot is the
 * option indexes from first place to last, one digit each, so every ballot
 * in a round has the same ciphertext size (the option count, which is
 * public). The host turns each order into Borda points (with n options,
 * first place earns n − 1, last earns 0), adds them to a `RankTally` and
 * drops the order. Only the points per option and the ballot count are
 * kept: never an order, never who put what first.
 *
 * Reveal needs minN ballots (3) and shows every option's points and its
 * average place. Privacy: an option's points hide each order in a sum of
 * n ≥ 3, with the scale round's residual risks (a host and one colluding
 * member at n = 3; unanimity shows: n × (options − 1) points say everyone
 * put it first).
 *
 * Pure and server-safe (MCP actions may import it): no React, no store,
 * no browser globals.
 */

import { isWithinJsonSize, shareableText } from "../sanitize";
import {
  PER_ROUND_STATE_VERSION,
  VOTE_LIMITS,
  isRankRoomTool,
  readKindStateHead,
  type HostKeys,
  type RankRoomTool,
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
import { readOptions, type ChoiceOption } from "./choice";
import { ID_RE, ID_RULE, b64urlChars, isCleanText, isCount, mdCell, obj } from "./wire";

// ── Shapes ───────────────────────────────────────────────────────────

/** One option to put in order. */
export type RankOption = ChoiceOption;

/** What a rank round asks: these options, in order. */
export interface RankSheet {
  id: string;
  title: string;
  /** 2 to 10 options. */
  options: RankOption[];
}

/** One option's revealed result. */
export interface RevealedRank {
  /** Borda points: with n options, n − 1 for each first place down to 0 for each last. */
  points: number;
}

export interface RankStateBody {
  v: typeof PER_ROUND_STATE_VERSION;
  kind: "rank";
  /** The host's member id. */
  by: string;
  /** Rises with every state the host sends; participants drop anything older. */
  seq: number;
  tool: RankRoomTool;
  /** nanoid(12), new every round. */
  roundId: string;
  /** Epoch ms when the room closes for everyone. */
  endsAt: number;
  minN: number;
  sheet: RankSheet;
  keys: HostKeys;
  phase: RoundPhase;
  /** Ballots counted this round. Never points before Reveal. */
  ballots: number;
  /** Accepted ballot ids, oldest first. [] once revealed. */
  acks: string[];
  /** Non-null exactly when the phase is "revealed". */
  revealed: RevealedRank[] | null;
}

export type RankStateMessage = Signed<RankStateBody>;

/** An order as it is encrypted: the option indexes from first place to last, one digit each. */
export type RankString = string;

/** A participant's form: option id → its place (0 for first); null while not placed. */
export type RankDraft = Record<string, number | null>;

/** Digits of a rank ballot: the i-th is option index i. */
const RANK_ALPHABET = "0123456789";

// ── Host side: what it may share ─────────────────────────────────────

type SheetCheck = { ok: true; sheet: RankSheet } | { ok: false; problem: string };

function checkRankSheet(s: RankSheet): SheetCheck {
  const no = (problem: string): SheetCheck => ({ ok: false, problem });
  if (!s || typeof s !== "object") return no("There is nothing to put in order.");
  if (typeof s.id !== "string" || !ID_RE.test(s.id)) {
    return no(`The round's id can't be shared live: ${ID_RULE}.`);
  }
  const title = shareableText(String(s.title ?? ""), VOTE_LIMITS.maxTitleChars);
  if (!title) return no("The round needs a question.");
  if (
    !Array.isArray(s.options) ||
    s.options.length < VOTE_LIMITS.minRankOptions ||
    s.options.length > VOTE_LIMITS.maxRankOptions
  ) {
    return no(
      `A live round puts ${VOTE_LIMITS.minRankOptions} to ${VOTE_LIMITS.maxRankOptions} options in order.`
    );
  }
  const ids = new Set<string>();
  const options: RankOption[] = [];
  for (let i = 0; i < s.options.length; i++) {
    const x = s.options[i];
    if (!x || typeof x.id !== "string" || !ID_RE.test(x.id)) {
      return no(`Option ${i + 1}'s id can't be shared live: ${ID_RULE}.`);
    }
    if (ids.has(x.id)) return no(`Option ${i + 1} has the same id as an earlier option.`);
    ids.add(x.id);
    const text = shareableText(String(x.text ?? ""), VOTE_LIMITS.maxOptionChars);
    if (!text) return no(`Option ${i + 1} needs text.`);
    const option: RankOption = { id: x.id, text };
    const hint = typeof x.hint === "string" ? shareableText(x.hint, VOTE_LIMITS.maxHintChars) : "";
    if (hint) option.hint = hint;
    options.push(option);
  }
  return { ok: true, sheet: { id: s.id, title, options } };
}

/** The sheet as the host may share it, rebuilt field by field. Null when it can't be shared. */
export function toWireRankSheet(s: RankSheet): RankSheet | null {
  const checked = checkRankSheet(s);
  return checked.ok ? checked.sheet : null;
}

/** Why `s` can't be shared live, in one sentence for the host, or null when it can. */
export function rankSheetProblem(s: RankSheet): string | null {
  const checked = checkRankSheet(s);
  return checked.ok ? null : checked.problem;
}

// ── Answers ──────────────────────────────────────────────────────────

/**
 * The order in `d` as option indexes from first place to last, or null
 * unless every option has a different place from 0 to n − 1.
 */
export function rankOrder(d: RankDraft, s: RankSheet): number[] | null {
  const n = s.options.length;
  const order = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const id = s.options[i].id;
    const place = Object.prototype.hasOwnProperty.call(d, id) ? d[id] : null;
    if (typeof place !== "number" || !Number.isInteger(place) || place < 0 || place >= n) {
      return null;
    }
    if (order[place] !== -1) return null;
    order[place] = i;
  }
  return order;
}

/** The ballot for `d`, or null unless it places every option once. */
export function encodeRank(d: RankDraft, s: RankSheet): RankString | null {
  const order = rankOrder(d, s);
  return order ? order.map((i) => RANK_ALPHABET[i]).join("") : null;
}

/** A decrypted order as option indexes from first place to last, or null unless it is a full order. */
export function readRankString(plain: string, s: RankSheet): number[] | null {
  const n = s.options.length;
  if (typeof plain !== "string" || plain.length !== n) return null;
  const seen = new Set<number>();
  const order: number[] = [];
  for (const c of plain) {
    const i = RANK_ALPHABET.indexOf(c);
    if (i < 0 || i >= n || seen.has(i)) return null;
    seen.add(i);
    order.push(i);
  }
  return order;
}

/** The exact ciphertext length of a ballot for `s`: one byte per option plus the 16-byte tag. */
export function rankCiphertextChars(s: RankSheet): number {
  return b64urlChars(s.options.length + 16);
}

/** The Borda points of the option in `place` (0 first) among `n` options. */
export function bordaPoints(place: number, n: number): number {
  return n - 1 - place;
}

// ── Readers ──────────────────────────────────────────────────────────

function readRankSheet(raw: unknown): RankSheet | null {
  const s = obj(raw);
  if (!s || typeof s.id !== "string" || !ID_RE.test(s.id)) return null;
  if (!isCleanText(s.title, VOTE_LIMITS.maxTitleChars)) return null;
  const options = readOptions(s.options, VOTE_LIMITS.minRankOptions, VOTE_LIMITS.maxRankOptions);
  if (!options) return null;
  return { id: s.id, title: s.title, options };
}

function readRevealedRank(raw: unknown, s: RankSheet, ballots: number): RevealedRank[] | null {
  const n = s.options.length;
  if (!Array.isArray(raw) || raw.length !== n) return null;
  const out: RevealedRank[] = [];
  let sum = 0;
  for (const rawRow of raw) {
    const r = obj(rawRow);
    if (!r || !isCount(r.points, ballots * (n - 1))) return null;
    sum += r.points;
    out.push({ points: r.points });
  }
  // Every order hands out 0 + 1 + … + (n − 1) points.
  return sum === (ballots * n * (n - 1)) / 2 ? out : null;
}

/** A rank round's host state for this page's `tool`, or null. The signature is the hook's call. */
export function readRankState(raw: unknown, tool: RankRoomTool): RankStateMessage | null {
  if (!isWithinJsonSize(raw, VOTE_LIMITS.maxPayloadChars)) return null;
  const m = obj(raw);
  if (!m || !isRankRoomTool(tool) || !isRankRoomTool(m.tool)) return null;
  const head = readKindStateHead(m, tool, "rank");
  if (!head) return null;
  const sheet = readRankSheet(m.sheet);
  if (!sheet) return null;
  let revealed: RevealedRank[] | null = null;
  if (head.phase === "revealed") {
    revealed = readRevealedRank(m.revealed, sheet, head.ballots);
    if (!revealed) return null;
  }
  return {
    v: PER_ROUND_STATE_VERSION,
    kind: "rank",
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

export interface RankTally {
  roundId: string;
  /** points[option]: Borda points so far. */
  points: number[];
  /** Ballots counted. */
  ballots: number;
}

export function emptyRankTally(roundId: string, s: RankSheet): RankTally {
  return { roundId, points: s.options.map(() => 0), ballots: 0 };
}

/**
 * Count `by`'s order (option indexes from first place, as `readRankString`
 * returns them) as Borda points, after the scale fold's pre-checks. The
 * order itself is not kept. Never mutates its inputs.
 */
export function foldRank(
  t: RankTally,
  ledger: BallotLedger,
  by: string,
  order: readonly number[],
  s: RankSheet,
  ctx: FoldContext
): { ok: true; tally: RankTally; ledger: BallotLedger } | { ok: false; reason: BallotRejection } {
  const rejected = precheckBallot({ by, roundId: t.roundId }, ledger, t, ctx);
  if (rejected) return { ok: false, reason: rejected };
  const n = s.options.length;
  if (t.points.length !== n || !Array.isArray(order) || order.length !== n) {
    return { ok: false, reason: "bad-answers" };
  }
  const seen = new Set<number>();
  for (const i of order) {
    if (!Number.isInteger(i) || i < 0 || i >= n || seen.has(i)) {
      return { ok: false, reason: "bad-answers" };
    }
    seen.add(i);
  }
  const points = t.points.slice();
  order.forEach((option, place) => {
    points[option] += bordaPoints(place, n);
  });
  const voted = new Set(ledger.voted);
  voted.add(by);
  return { ok: true, tally: { ...t, points, ballots: t.ballots + 1 }, ledger: { voted } };
}

// ── Reveal rules ─────────────────────────────────────────────────────

export function canRevealRank(t: RankTally, minN: number): boolean {
  return t.ballots >= effectiveMinN(minN);
}

/** Every option's points; null under minN ballots. */
export function revealRank(t: RankTally, minN: number): RevealedRank[] | null {
  if (!canRevealRank(t, minN)) return null;
  return t.points.map((points) => ({ points }));
}

/** An option's average place (1 for first), from its points: n − points / people. */
export function averagePlace(points: number, ballots: number, n: number): number | null {
  return ballots > 0 ? n - points / ballots : null;
}

// ── The saved result ─────────────────────────────────────────────────

/** A closed rank round as a tool saves it: Borda points only. No ids, no names, no order. */
export interface RankRoundResult {
  kind: "rank";
  roundId: string;
  tool: RankRoomTool;
  sheetId: string;
  title: string;
  /** ISO timestamp of Reveal. */
  closedAt: string;
  minN: number;
  /** People who put the options in order. */
  ballots: number;
  source: "live" | "facilitator";
  options: { id: string; text: string; points: number }[];
}

/** The result to hand a tool's `onSave`. Null under minN, or when `revealed` doesn't fit `s`. */
export function toRankResult(
  s: RankSheet,
  revealed: readonly RevealedRank[],
  meta: RoundResultMeta & { tool: RankRoomTool }
): RankRoundResult | null {
  const minN = effectiveMinN(meta.minN, meta.tool);
  if (meta.ballots < minN || revealed.length !== s.options.length) return null;
  return {
    kind: "rank",
    roundId: meta.roundId,
    tool: meta.tool,
    sheetId: s.id,
    title: s.title,
    closedAt: meta.closedAt,
    minN,
    ballots: meta.ballots,
    source: meta.source,
    options: s.options.map((option, i) => ({
      id: option.id,
      text: option.text,
      points: revealed[i].points,
    })),
  };
}

/** The options most points first (ties keep the sheet's order). */
export function rankStanding<T extends { points: number }>(options: readonly T[]): T[] {
  return options
    .map((x, i) => ({ x, i }))
    .sort((a, b) => b.x.points - a.x.points || a.i - b.i)
    .map(({ x }) => x);
}

/** The round as Markdown: one row per option, most points first. */
export function rankRoundMarkdown(r: RankRoundResult): string {
  const how = r.source === "live" ? "ranked anonymously in a live round" : "entered by hand";
  const n = r.options.length;
  const lines = [
    `# ${mdCell(r.title)}`,
    "",
    `${r.ballots} ${r.ballots === 1 ? "person" : "people"} ${how}, ${r.closedAt.slice(0, 10)}. ` +
      `Points: ${n - 1} for each first place down to 0 for each last.`,
    "",
    "| Place | Option | Points | Average place |",
    "| ---: | --- | ---: | ---: |",
  ];
  rankStanding(r.options).forEach((x, i) => {
    const avg = averagePlace(x.points, r.ballots, n);
    lines.push(
      `| ${i + 1} | ${mdCell(x.text)} | ${x.points} | ${avg === null ? "—" : String(Math.round(avg * 10) / 10)} |`
    );
  });
  return `${lines.join("\n")}\n`;
}
