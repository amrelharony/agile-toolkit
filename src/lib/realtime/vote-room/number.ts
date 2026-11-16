/**
 * Number rounds (Quick Vote's "guess the number", confidence in %, how
 * many days): each person gives one number in a range the host sets, and
 * the host keeps the numbers without their senders until Reveal.
 *
 * A host publishes a `NumberSheet`: the range (`min` to `max`), how many
 * decimal places an answer may have (0 to 2) and a unit. A participant's
 * answer travels as its distance from `min` in steps of the smallest
 * decimal, zero-padded to the digits of the whole range, so every ballot in
 * a round has the same ciphertext size: it depends only on the range,
 * which is public. The host adds each answer to a `NumberTally`, a sorted
 * list of steps (so the order answers came in is gone with the sender),
 * and drops the ballot.
 *
 * Reveal needs minN ballots (3) and shows how many answered and the
 * median. The spread (lowest, quartiles, highest and a 10-bucket
 * histogram) shows only from `VOTE_LIMITS.minNSpread` (5) answers: the
 * lowest and highest are someone's exact answer, and at 3 answers the
 * quartiles would be too. The saved result keeps those statistics, never
 * the list.
 *
 * Privacy (see RUNBOOK "Live vote rounds"): with 3 or 4 answers the median
 * is one person's exact answer (not who gave it), as a scale round's
 * distribution is. From 5, the lowest and highest answers are exact too.
 *
 * Pure and server-safe (MCP actions may import it): no React, no store,
 * no browser globals.
 */

import { isWithinJsonSize, shareableText } from "../sanitize";
import {
  PER_ROUND_STATE_VERSION,
  VOTE_LIMITS,
  isNumberRoomTool,
  readKindStateHead,
  type HostKeys,
  type NumberRoomTool,
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

export type NumberDecimals = 0 | 1 | 2;

/** What a number round asks: one number from `min` to `max`. */
export interface NumberSheet {
  id: string;
  title: string;
  /** The lowest answer. At most `decimals` decimal places, within ±1,000,000. */
  min: number;
  /** The highest answer, above `min`. */
  max: number;
  /** Decimal places an answer may have. */
  decimals: NumberDecimals;
  /** Shown with numbers ("days", "%"), at most 8 characters; may be "". */
  unit: string;
  hint?: string;
}

/** The spread of a revealed number round (from `minNSpread` answers). */
export interface NumberSpread {
  min: number;
  /** The lower quartile (a quarter of the answers are at or below it). */
  q1: number;
  /** The upper quartile. */
  q3: number;
  max: number;
  /** People per bucket, 10 equal buckets across the sheet's range (`numberBucketRange`). */
  histogram: number[];
}

/** A revealed number round. */
export interface RevealedNumber {
  /** People who answered. */
  count: number;
  median: number;
  /** Null under `minNSpread` answers. */
  spread: NumberSpread | null;
}

export interface NumberStateBody {
  v: typeof PER_ROUND_STATE_VERSION;
  kind: "number";
  /** The host's member id. */
  by: string;
  /** Rises with every state the host sends; participants drop anything older. */
  seq: number;
  tool: NumberRoomTool;
  /** nanoid(12), new every round. */
  roundId: string;
  /** Epoch ms when the room closes for everyone. */
  endsAt: number;
  minN: number;
  sheet: NumberSheet;
  keys: HostKeys;
  phase: RoundPhase;
  /** Ballots counted this round. Never a statistic before Reveal. */
  ballots: number;
  /** Accepted ballot ids, oldest first. [] once revealed. */
  acks: string[];
  /** Non-null exactly when the phase is "revealed". */
  revealed: RevealedNumber | null;
}

export type NumberStateMessage = Signed<NumberStateBody>;

/** An answer as it is encrypted: its steps above `min`, zero-padded to `numberWidth(sheet)` digits. */
export type NumberString = string;

/** The draft key of a number round's only answer. */
export const NUMBER_DRAFT_KEY = "value";

/** A participant's form: `{ value: n }`, or null while blank. */
export type NumberDraft = Record<string, number | null>;

// ── Steps ────────────────────────────────────────────────────────────

const scaleOf = (decimals: number) => 10 ** decimals;

/** Whether `v` has at most `decimals` decimal places (to within floating-point noise). */
function hasDecimals(v: number, decimals: number): boolean {
  const scaled = v * scaleOf(decimals);
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/** The answers the range holds, less one: `max` in steps above `min`. */
export function numberSpan(s: Pick<NumberSheet, "min" | "max" | "decimals">): number {
  return Math.round((s.max - s.min) * scaleOf(s.decimals));
}

/** Digits of one answer on the wire: those of the span (1 to 8). */
export function numberWidth(s: Pick<NumberSheet, "min" | "max" | "decimals">): number {
  return String(numberSpan(s)).length;
}

/** `value` in steps above `min`, or null when it isn't an answer `s` takes. */
export function numberToSteps(value: unknown, s: NumberSheet): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < s.min || value > s.max || !hasDecimals(value, s.decimals)) return null;
  const steps = Math.round((value - s.min) * scaleOf(s.decimals));
  return steps >= 0 && steps <= numberSpan(s) ? steps : null;
}

/** A number of steps (maybe fractional) above `min`, as a value, to two places past the sheet's. */
export function stepsToNumber(steps: number, s: NumberSheet): number {
  const places = s.decimals + 2;
  const v = s.min + steps / scaleOf(s.decimals);
  return Math.round(v * 10 ** places) / 10 ** places;
}

/** The bucket (0 to 9) `steps` falls in, for a range of `span` steps. */
export function numberBucketOf(steps: number, span: number): number {
  return Math.min(
    VOTE_LIMITS.numberBuckets - 1,
    Math.floor((steps * VOTE_LIMITS.numberBuckets) / (span + 1))
  );
}

/** Bucket `k`'s lowest and highest answer, or null when it holds none (a range under 10 answers). */
export function numberBucketRange(k: number, s: NumberSheet): [number, number] | null {
  const span = numberSpan(s);
  const b = VOTE_LIMITS.numberBuckets;
  const lo = Math.ceil((k * (span + 1)) / b);
  const hi = Math.ceil(((k + 1) * (span + 1)) / b) - 1;
  if (lo > hi) return null;
  return [stepsToNumber(lo, s), stepsToNumber(hi, s)];
}

/** A number with its unit: "40%" for a symbol, "12 days" for a word, "3.5" without. */
export function numberAmount(n: number, unit: string, decimals = 2): string {
  const num = n.toLocaleString("en-US", { maximumFractionDigits: decimals });
  if (!unit) return num;
  return /[0-9A-Za-zÀ-ɏͰ-ӿ]/.test(unit) ? `${num} ${unit}` : `${num}${unit}`;
}

// ── Host side: what it may share ─────────────────────────────────────

type SheetCheck = { ok: true; sheet: NumberSheet } | { ok: false; problem: string };

function checkNumberSheet(s: NumberSheet): SheetCheck {
  const no = (problem: string): SheetCheck => ({ ok: false, problem });
  if (!s || typeof s !== "object") return no("There is nothing to ask.");
  if (typeof s.id !== "string" || !ID_RE.test(s.id)) {
    return no(`The round's id can't be shared live: ${ID_RULE}.`);
  }
  const title = shareableText(String(s.title ?? ""), VOTE_LIMITS.maxTitleChars);
  if (!title) return no("The round needs a question.");
  const decimals = s.decimals;
  if (decimals !== 0 && decimals !== 1 && decimals !== 2) {
    return no(`Answers can have 0 to ${VOTE_LIMITS.maxNumberDecimals} decimal places.`);
  }
  const lim = VOTE_LIMITS.maxNumberAbs;
  for (const [label, v] of [
    ["lowest", s.min],
    ["highest", s.max],
  ] as const) {
    if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > lim) {
      return no(
        `The ${label} answer needs to be a number from ${(-lim).toLocaleString("en-US")} to ${lim.toLocaleString("en-US")}.`
      );
    }
    if (!hasDecimals(v, decimals)) {
      return no(`The ${label} answer can have at most ${decimals} decimal places.`);
    }
  }
  if (s.min >= s.max) return no("The highest answer needs to be above the lowest.");
  if (numberSpan(s) > VOTE_LIMITS.maxNumberSteps) {
    return no("The range is too wide for its decimal places. Narrow it, or use fewer decimals.");
  }
  const unit = shareableText(String(s.unit ?? ""), 64);
  if (unit.length > VOTE_LIMITS.maxNumberUnitChars) {
    return no(
      `The unit can be at most ${VOTE_LIMITS.maxNumberUnitChars} characters, like % or days.`
    );
  }
  // Rebuilt on the step grid, so the wire never carries 0.30000000000000004.
  const min = Math.round(s.min * scaleOf(decimals)) / scaleOf(decimals);
  const max = Math.round(s.max * scaleOf(decimals)) / scaleOf(decimals);
  const sheet: NumberSheet = { id: s.id, title, min, max, decimals, unit };
  const hint = typeof s.hint === "string" ? shareableText(s.hint, VOTE_LIMITS.maxHintChars) : "";
  if (hint) sheet.hint = hint;
  return { ok: true, sheet };
}

/** The sheet as the host may share it, rebuilt field by field. Null when it can't be shared. */
export function toWireNumberSheet(s: NumberSheet): NumberSheet | null {
  const checked = checkNumberSheet(s);
  return checked.ok ? checked.sheet : null;
}

/** Why `s` can't be shared live, in one sentence for the host, or null when it can. */
export function numberSheetProblem(s: NumberSheet): string | null {
  const checked = checkNumberSheet(s);
  return checked.ok ? null : checked.problem;
}

// ── Answers ──────────────────────────────────────────────────────────

/** What is wrong with a number draft. */
export type NumberProblem = "missing" | "out-of-range" | "too-precise";

/** The first thing wrong with `d`, or null when it can be sent. */
export function numberDraftProblem(d: NumberDraft, s: NumberSheet): NumberProblem | null {
  const v = Object.prototype.hasOwnProperty.call(d, NUMBER_DRAFT_KEY) ? d[NUMBER_DRAFT_KEY] : null;
  if (v === null || v === undefined || typeof v !== "number" || !Number.isFinite(v)) {
    return "missing";
  }
  if (v < s.min || v > s.max) return "out-of-range";
  if (!hasDecimals(v, s.decimals)) return "too-precise";
  return null;
}

/** The ballot for `d`, or null when `numberDraftProblem` finds anything. */
export function encodeNumber(d: NumberDraft, s: NumberSheet): NumberString | null {
  if (numberDraftProblem(d, s)) return null;
  const steps = numberToSteps(d[NUMBER_DRAFT_KEY], s);
  return steps === null ? null : String(steps).padStart(numberWidth(s), "0");
}

/** A decrypted answer in steps above `min`, or null: the wrong length, not digits, or out of range. */
export function readNumberString(plain: string, s: NumberSheet): number | null {
  if (typeof plain !== "string" || plain.length !== numberWidth(s) || !/^[0-9]+$/.test(plain)) {
    return null;
  }
  const steps = Number(plain);
  return Number.isInteger(steps) && steps <= numberSpan(s) ? steps : null;
}

/** The exact ciphertext length of a ballot for `s`: its digits plus the 16-byte tag. */
export function numberCiphertextChars(s: NumberSheet): number {
  return b64urlChars(numberWidth(s) + 16);
}

// ── Readers ──────────────────────────────────────────────────────────

function readNumberSheet(raw: unknown): NumberSheet | null {
  const s = obj(raw);
  if (!s || typeof s.id !== "string" || !ID_RE.test(s.id)) return null;
  if (!isCleanText(s.title, VOTE_LIMITS.maxTitleChars)) return null;
  if (s.decimals !== 0 && s.decimals !== 1 && s.decimals !== 2) return null;
  const decimals = s.decimals;
  for (const v of [s.min, s.max]) {
    if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > VOTE_LIMITS.maxNumberAbs) {
      return null;
    }
    if (!hasDecimals(v, decimals)) return null;
  }
  const min = s.min as number;
  const max = s.max as number;
  if (min >= max || numberSpan({ min, max, decimals }) > VOTE_LIMITS.maxNumberSteps) return null;
  if (typeof s.unit !== "string" || s.unit.length > VOTE_LIMITS.maxNumberUnitChars) return null;
  if (s.unit !== "" && !isCleanText(s.unit, VOTE_LIMITS.maxNumberUnitChars)) return null;
  if (s.hint !== undefined && !isCleanText(s.hint, VOTE_LIMITS.maxHintChars)) return null;
  const sheet: NumberSheet = { id: s.id, title: s.title, min, max, decimals, unit: s.unit };
  if (typeof s.hint === "string") sheet.hint = s.hint;
  return sheet;
}

const inRange = (v: unknown, s: NumberSheet): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= s.min && v <= s.max;

function readRevealedNumber(
  raw: unknown,
  s: NumberSheet,
  ballots: number,
  minN: number
): RevealedNumber | null {
  const r = obj(raw);
  if (!r || r.count !== ballots || !inRange(r.median, s)) return null;
  const spreadShown = ballots >= Math.max(minN, VOTE_LIMITS.minNSpread);
  if (r.spread === null) {
    return spreadShown ? null : { count: ballots, median: r.median, spread: null };
  }
  if (!spreadShown) return null;
  const sp = obj(r.spread);
  if (!sp) return null;
  const { min, q1, q3, max } = sp;
  if (!inRange(min, s) || !inRange(q1, s) || !inRange(q3, s) || !inRange(max, s)) return null;
  if (!(min <= q1 && q1 <= r.median && r.median <= q3 && q3 <= max)) return null;
  // The lowest and highest are answers: on the step grid.
  const minSteps = numberToSteps(min, s);
  const maxSteps = numberToSteps(max, s);
  if (minSteps === null || maxSteps === null) return null;
  const h = sp.histogram;
  if (!Array.isArray(h) || h.length !== VOTE_LIMITS.numberBuckets) return null;
  let people = 0;
  let first = -1;
  let last = -1;
  for (let k = 0; k < h.length; k++) {
    if (!isCount(h[k], ballots)) return null;
    people += h[k] as number;
    if ((h[k] as number) > 0) {
      if (first < 0) first = k;
      last = k;
    }
  }
  if (people !== ballots) return null;
  const span = numberSpan(s);
  if (first !== numberBucketOf(minSteps, span) || last !== numberBucketOf(maxSteps, span)) {
    return null;
  }
  return {
    count: ballots,
    median: r.median,
    spread: { min, q1, q3, max, histogram: (h as number[]).slice() },
  };
}

/** A number round's host state for this page's `tool`, or null. The signature is the hook's call. */
export function readNumberState(raw: unknown, tool: NumberRoomTool): NumberStateMessage | null {
  if (!isWithinJsonSize(raw, VOTE_LIMITS.maxPayloadChars)) return null;
  const m = obj(raw);
  if (!m || !isNumberRoomTool(tool) || !isNumberRoomTool(m.tool)) return null;
  const head = readKindStateHead(m, tool, "number");
  if (!head) return null;
  const sheet = readNumberSheet(m.sheet);
  if (!sheet) return null;
  let revealed: RevealedNumber | null = null;
  if (head.phase === "revealed") {
    revealed = readRevealedNumber(m.revealed, sheet, head.ballots, head.minN);
    if (!revealed) return null;
  }
  return {
    v: PER_ROUND_STATE_VERSION,
    kind: "number",
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

export interface NumberTally {
  roundId: string;
  /** Every answer so far in steps above `min`, lowest first: no sender, no arrival order. */
  steps: number[];
  /** Ballots counted. */
  ballots: number;
}

export function emptyNumberTally(roundId: string): NumberTally {
  return { roundId, steps: [], ballots: 0 };
}

/** `sorted` with `v` inserted in order. */
function insertSorted(sorted: readonly number[], v: number): number[] {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return [...sorted.slice(0, lo), v, ...sorted.slice(lo)];
}

/**
 * Count `by`'s answer (steps above `min`, as `readNumberString` returns
 * it), after the scale fold's pre-checks. Never mutates its inputs.
 */
export function foldNumber(
  t: NumberTally,
  ledger: BallotLedger,
  by: string,
  steps: number,
  s: NumberSheet,
  ctx: FoldContext
): { ok: true; tally: NumberTally; ledger: BallotLedger } | { ok: false; reason: BallotRejection } {
  const rejected = precheckBallot({ by, roundId: t.roundId }, ledger, t, ctx);
  if (rejected) return { ok: false, reason: rejected };
  if (!Number.isInteger(steps) || steps < 0 || steps > numberSpan(s)) {
    return { ok: false, reason: "bad-answers" };
  }
  const voted = new Set(ledger.voted);
  voted.add(by);
  return {
    ok: true,
    tally: { ...t, steps: insertSorted(t.steps, steps), ballots: t.ballots + 1 },
    ledger: { voted },
  };
}

// ── Reveal rules and statistics ──────────────────────────────────────

/** The `p` quantile (0 to 1) of ascending `sorted`, interpolated between neighbours. */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const h = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(h);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function canRevealNumber(t: NumberTally, minN: number): boolean {
  return t.ballots >= effectiveMinN(minN);
}

/** Whether a round of `ballots` answers under `minN` may show its spread. */
export function numberSpreadShows(ballots: number, minN: number): boolean {
  return ballots >= Math.max(effectiveMinN(minN), VOTE_LIMITS.minNSpread);
}

/**
 * The count and median; the lowest, quartiles, highest and histogram only
 * from `minNSpread` answers. Null under minN ballots.
 */
export function revealNumber(t: NumberTally, s: NumberSheet, minN: number): RevealedNumber | null {
  if (!canRevealNumber(t, minN) || t.steps.length !== t.ballots) return null;
  const sorted = t.steps;
  const median = stepsToNumber(quantile(sorted, 0.5), s);
  if (!numberSpreadShows(t.ballots, minN)) return { count: t.ballots, median, spread: null };
  const span = numberSpan(s);
  const histogram = new Array<number>(VOTE_LIMITS.numberBuckets).fill(0);
  for (const v of sorted) histogram[numberBucketOf(v, span)] += 1;
  return {
    count: t.ballots,
    median,
    spread: {
      min: stepsToNumber(sorted[0], s),
      q1: stepsToNumber(quantile(sorted, 0.25), s),
      q3: stepsToNumber(quantile(sorted, 0.75), s),
      max: stepsToNumber(sorted[sorted.length - 1], s),
      histogram,
    },
  };
}

// ── The saved result ─────────────────────────────────────────────────

/** A closed number round as a tool saves it: statistics only. No ids, no names, no answer list. */
export interface NumberRoundResult {
  kind: "number";
  roundId: string;
  tool: NumberRoomTool;
  sheetId: string;
  title: string;
  min: number;
  max: number;
  decimals: NumberDecimals;
  unit: string;
  /** ISO timestamp of Reveal. */
  closedAt: string;
  minN: number;
  /** People who answered. */
  ballots: number;
  source: "live" | "facilitator";
  median: number;
  /** Null under 5 answers. */
  spread: NumberSpread | null;
}

/** The result to hand a tool's `onSave`. Null under minN, or when `revealed` doesn't fit. */
export function toNumberResult(
  s: NumberSheet,
  revealed: RevealedNumber,
  meta: RoundResultMeta & { tool: NumberRoomTool }
): NumberRoundResult | null {
  const minN = effectiveMinN(meta.minN, meta.tool);
  if (meta.ballots < minN || revealed.count !== meta.ballots) return null;
  const spread =
    numberSpreadShows(meta.ballots, minN) && revealed.spread
      ? { ...revealed.spread, histogram: revealed.spread.histogram.slice() }
      : null;
  return {
    kind: "number",
    roundId: meta.roundId,
    tool: meta.tool,
    sheetId: s.id,
    title: s.title,
    min: s.min,
    max: s.max,
    decimals: s.decimals,
    unit: s.unit,
    closedAt: meta.closedAt,
    minN,
    ballots: meta.ballots,
    source: meta.source,
    median: revealed.median,
    spread,
  };
}

/** The sheet a saved result was asked with (for showing it again). */
export function numberSheetOf(r: NumberRoundResult): NumberSheet {
  return {
    id: r.sheetId,
    title: r.title,
    min: r.min,
    max: r.max,
    decimals: r.decimals,
    unit: r.unit,
  };
}

/** The round as Markdown: count, median, the spread and the histogram (or why not). */
export function numberRoundMarkdown(r: NumberRoundResult): string {
  const how = r.source === "live" ? "answered anonymously in a live round" : "entered by hand";
  const amount = (n: number) => numberAmount(n, r.unit, r.decimals + 2);
  const lines = [
    `# ${mdCell(r.title)}`,
    "",
    `${r.ballots} ${r.ballots === 1 ? "person" : "people"} ${how}, ${r.closedAt.slice(0, 10)}, ` +
      `from ${amount(r.min)} to ${amount(r.max)}.`,
    "",
    `Median: ${amount(r.median)}.`,
  ];
  if (!r.spread) {
    lines.push("", `The spread shows from ${Math.max(r.minN, VOTE_LIMITS.minNSpread)} answers.`);
    return `${lines.join("\n")}\n`;
  }
  const sheet = numberSheetOf(r);
  lines.push(
    `Lowest ${amount(r.spread.min)}, middle half ${amount(r.spread.q1)} to ${amount(r.spread.q3)}, highest ${amount(r.spread.max)}.`,
    "",
    "| Range | People |",
    "| --- | ---: |"
  );
  r.spread.histogram.forEach((n, k) => {
    const range = numberBucketRange(k, sheet);
    if (!range) return;
    const label =
      range[0] === range[1] ? amount(range[0]) : `${amount(range[0])}–${amount(range[1])}`;
    lines.push(`| ${mdCell(label)} | ${n} |`);
  });
  return `${lines.join("\n")}\n`;
}
