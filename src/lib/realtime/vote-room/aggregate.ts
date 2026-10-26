/**
 * Anonymous vote rounds: counting, the reveal rules, and the saved result.
 *
 * The host folds each decrypted ballot into a `Tally` (counts per question
 * per scale point) and a `BallotLedger` (the presence keys that answered,
 * so nobody counts twice), then drops the ballot. Nothing here keeps an
 * answer next to the person who gave it. At Reveal the ledger goes too, and
 * `revealTally` gives a question's distribution only from `minN` answers.
 *
 * `VoteRoundResult` is what a tool saves: totals only, no ids, no names.
 * The facilitator fallback (counted hands, paper) builds the same result
 * through `foldCounts`, under the same minN rule.
 *
 * Pure and server-safe (MCP actions may import it): no React, no store,
 * no browser globals.
 */

import { VISITOR_LIMITS } from "../visitor-rooms";
import {
  VOTE_LIMITS,
  type BallotEnvelope,
  type Questionnaire,
  type RevealedQuestion,
  type VoteRoomTool,
  type VoteScale,
} from "./protocol";

// ── Types ────────────────────────────────────────────────────────────

export interface Tally {
  roundId: string;
  /** Points on the scale: every row of `counts` has this many entries. */
  points: number;
  /** counts[question][point]: how many ballots chose that point. */
  counts: number[][];
  /** responses[question]: ballots that answered it (didn't skip). */
  responses: number[];
  /** Ballots counted. */
  ballots: number;
}

/** The presence keys that answered this round. Dropped at Reveal. */
export interface BallotLedger {
  voted: ReadonlySet<string>;
}

export type BallotRejection =
  | "closed"
  | "wrong-round"
  | "removed"
  | "not-admitted"
  | "duplicate"
  | "round-full"
  | "bad-answers";

export interface FoldContext {
  /** The round takes ballots (not revealed, room live). */
  open: boolean;
  roundId: string;
  /** Members holding a seat now (`useRoom`'s list, at most 20). */
  admitted: ReadonlySet<string>;
  /** Members the host removed. */
  removed: ReadonlySet<string>;
}

export type FoldResult =
  | { ok: true; tally: Tally; ledger: BallotLedger }
  | { ok: false; reason: BallotRejection };

// ── Building and folding ─────────────────────────────────────────────

export function emptyTally(roundId: string, q: Questionnaire): Tally {
  const points = q.scale.points.length;
  return {
    roundId,
    points,
    counts: q.questions.map(() => new Array<number>(points).fill(0)),
    responses: q.questions.map(() => 0),
    ballots: 0,
  };
}

export function emptyLedger(): BallotLedger {
  return { voted: new Set<string>() };
}

/**
 * The cheap checks, run on a ballot's envelope before anything is
 * decrypted, so the rate limits bound the work a flood can cause. Null
 * when the ballot may be opened.
 */
export function precheckBallot(
  env: Pick<BallotEnvelope, "by" | "roundId">,
  ledger: BallotLedger,
  tally: Tally,
  ctx: FoldContext
): BallotRejection | null {
  if (!ctx.open) return "closed";
  if (env.roundId !== ctx.roundId || tally.roundId !== ctx.roundId) return "wrong-round";
  if (ctx.removed.has(env.by)) return "removed";
  if (!ctx.admitted.has(env.by)) return "not-admitted";
  if (ledger.voted.has(env.by)) return "duplicate";
  if (tally.ballots >= VOTE_LIMITS.maxBallotsPerRound) return "round-full";
  return null;
}

/**
 * Count `by`'s answers (point indexes, -1 for skipped, as `readAnswerString`
 * returns them). Re-runs the pre-checks, because the round, the phase or the
 * seats can change while a ballot is being decrypted. Never mutates its
 * inputs.
 */
export function foldBallot(
  tally: Tally,
  ledger: BallotLedger,
  by: string,
  answers: readonly number[],
  ctx: FoldContext
): FoldResult {
  const rejected = precheckBallot({ by, roundId: tally.roundId }, ledger, tally, ctx);
  if (rejected) return { ok: false, reason: rejected };
  if (!Array.isArray(answers) || answers.length !== tally.counts.length) {
    return { ok: false, reason: "bad-answers" };
  }
  let answered = 0;
  for (const a of answers) {
    if (!Number.isInteger(a) || a < -1 || a >= tally.points) {
      return { ok: false, reason: "bad-answers" };
    }
    if (a >= 0) answered++;
  }
  if (answered === 0) return { ok: false, reason: "bad-answers" };
  const counts = tally.counts.map((row, i) => {
    const a = answers[i];
    if (a < 0) return row;
    const next = row.slice();
    next[a] += 1;
    return next;
  });
  const responses = tally.responses.map((n, i) => (answers[i] >= 0 ? n + 1 : n));
  const voted = new Set(ledger.voted);
  voted.add(by);
  return {
    ok: true,
    tally: { ...tally, counts, responses, ballots: tally.ballots + 1 },
    ledger: { voted },
  };
}

/**
 * Add counts entered by a facilitator (hands counted, paper collected):
 * `counts[question][point]` non-negative integers, `ballots` the people who
 * answered. Null when the shape is wrong, a count isn't a whole number, a
 * question has more answers than people, or the total passes
 * `VOTE_LIMITS.maxTallyBallots`. Never mutates `tally`.
 */
export function foldCounts(
  tally: Tally,
  counts: readonly (readonly number[])[],
  ballots: number
): Tally | null {
  if (!Array.isArray(counts) || counts.length !== tally.counts.length) return null;
  if (!Number.isInteger(ballots) || ballots < 0) return null;
  const total = tally.ballots + ballots;
  if (total > VOTE_LIMITS.maxTallyBallots) return null;
  const nextCounts: number[][] = [];
  const nextResponses: number[] = [];
  for (let i = 0; i < counts.length; i++) {
    const row = counts[i];
    if (!Array.isArray(row) || row.length !== tally.points) return null;
    let added = 0;
    for (const n of row) {
      if (!Number.isInteger(n) || n < 0) return null;
      added += n;
    }
    if (added > ballots) return null;
    nextCounts.push(tally.counts[i].map((c, j) => c + row[j]));
    nextResponses.push(tally.responses[i] + added);
  }
  return { ...tally, counts: nextCounts, responses: nextResponses, ballots: total };
}

// ── Reveal rules ─────────────────────────────────────────────────────

/**
 * The minN a round really uses: `requested` rounded up and clamped to
 * [VOTE_LIMITS.minNFloor, the seat cap], or the floor when unset.
 */
export function effectiveMinN(requested?: number): number {
  const floor = VOTE_LIMITS.minNFloor;
  if (typeof requested !== "number" || !Number.isFinite(requested)) return floor;
  return Math.min(VISITOR_LIMITS.maxMembers, Math.max(floor, Math.ceil(requested)));
}

/** Whether the round has enough ballots to reveal. */
export function canReveal(t: Tally, minN: number): boolean {
  return t.ballots >= effectiveMinN(minN);
}

/** Every question's result: its distribution only when it has at least minN answers. */
export function revealTally(t: Tally, minN: number): RevealedQuestion[] {
  const m = effectiveMinN(minN);
  return t.counts.map((row, i) => ({
    responses: t.responses[i],
    distribution: t.responses[i] >= m ? row.slice() : null,
  }));
}

// ── Statistics ───────────────────────────────────────────────────────

function total(d: readonly number[]): number {
  return d.reduce((a, b) => a + b, 0);
}

/** The mean point value, or null with no answers. */
export function distributionMean(d: readonly number[], scale: VoteScale): number | null {
  const n = total(d);
  if (n === 0) return null;
  let sum = 0;
  d.forEach((c, i) => {
    sum += c * (scale.points[i]?.value ?? 0);
  });
  return sum / n;
}

/** The median point value (the middle two averaged for an even count), or null with no answers. */
export function distributionMedian(d: readonly number[], scale: VoteScale): number | null {
  const n = total(d);
  if (n === 0) return null;
  // Values in ascending order with their counts, whatever order the scale lists them in.
  const sorted = scale.points
    .map((p, i) => ({ value: p.value, count: d[i] ?? 0 }))
    .sort((a, b) => a.value - b.value);
  const at = (k: number): number => {
    let seen = 0;
    for (const s of sorted) {
      seen += s.count;
      if (k < seen) return s.value;
    }
    return sorted[sorted.length - 1].value;
  };
  return n % 2 === 1 ? at((n - 1) / 2) : (at(n / 2 - 1) + at(n / 2)) / 2;
}

/** Point `i`'s share of the answers (0–1), or null with no answers. */
export function pointShare(d: readonly number[], i: number): number | null {
  const n = total(d);
  if (n === 0) return null;
  return (d[i] ?? 0) / n;
}

// ── The saved result ─────────────────────────────────────────────────

/** A closed round as a tool saves it: totals only. No ids, no names, nothing per person. */
export interface VoteRoundResult {
  roundId: string;
  tool: VoteRoomTool;
  questionnaireId: string;
  title: string;
  scale: VoteScale;
  /** ISO timestamp of Reveal (or of the facilitator's entry). */
  closedAt: string;
  minN: number;
  ballots: number;
  /** "live": answered in a vote room; "facilitator": counts entered by hand. */
  source: "live" | "facilitator";
  questions: {
    id: string;
    text: string;
    responses: number;
    /** Count per scale point; null when withheld (fewer than minN answers). */
    distribution: number[] | null;
  }[];
}

export interface RoundResultMeta {
  tool: VoteRoomTool;
  roundId: string;
  closedAt: string;
  minN: number;
  ballots: number;
  source: "live" | "facilitator";
}

/**
 * The result to hand a tool's `onSave`. Applies the minN rule again, so a
 * caller can't save a distribution the room would have withheld.
 */
export function toRoundResult(
  q: Questionnaire,
  revealed: readonly RevealedQuestion[],
  meta: RoundResultMeta
): VoteRoundResult {
  const minN = effectiveMinN(meta.minN);
  return {
    roundId: meta.roundId,
    tool: meta.tool,
    questionnaireId: q.id,
    title: q.title,
    scale: { id: q.scale.id, points: q.scale.points.map((p) => ({ ...p })) },
    closedAt: meta.closedAt,
    minN,
    ballots: meta.ballots,
    source: meta.source,
    questions: q.questions.map((question, i) => {
      const r = revealed[i];
      const responses = r?.responses ?? 0;
      return {
        id: question.id,
        text: question.text,
        responses,
        distribution: r?.distribution && responses >= minN ? r.distribution.slice() : null,
      };
    }),
  };
}

/** One table cell: one line, pipes escaped. */
function mdCell(s: string): string {
  return s
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function round1(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** The round as Markdown: one row per question, withheld questions said plainly. */
export function voteRoundMarkdown(r: VoteRoundResult): string {
  const labels = r.scale.points.map((p) => mdCell(p.label));
  const how = r.source === "live" ? "answered anonymously in a live round" : "entered by hand";
  const day = r.closedAt.slice(0, 10);
  const lines = [
    `# ${mdCell(r.title)}`,
    "",
    `${r.ballots} ${r.ballots === 1 ? "person" : "people"} ${how}, ${day}. ` +
      `A question shows its results from ${r.minN} answers.`,
    "",
    `| Question | ${labels.join(" | ")} | Answers | Mean |`,
    `| --- | ${labels.map(() => "---:").join(" | ")} | ---: | ---: |`,
  ];
  for (const q of r.questions) {
    if (!q.distribution) {
      lines.push(
        `| ${mdCell(q.text)} | ${labels.map(() => "—").join(" | ")} | ${q.responses} | Withheld (fewer than ${r.minN} answers) |`
      );
      continue;
    }
    const mean = distributionMean(q.distribution, r.scale);
    lines.push(
      `| ${mdCell(q.text)} | ${q.distribution.join(" | ")} | ${q.responses} | ${mean === null ? "—" : round1(mean)} |`
    );
  }
  return `${lines.join("\n")}\n`;
}
