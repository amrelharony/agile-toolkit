/**
 * Weighted decision matrices (Pugh / MCDA): options scored 1–10 against
 * weighted criteria, total = Σ score × weight.
 *
 * Several named matrices can live side by side; an option or criterion
 * belongs to one through `matrixId`, and rows from before named matrices
 * (no `matrixId`) are the default matrix's (DEFAULT_WEIGHTED_MATRIX_ID),
 * which needs no stored document until it is first named.
 *
 * The rules the page and the agent actions share:
 *   - A criterion counts while its weight is above 0 ("active").
 *   - An empty cell is not scored, never 0: an option's Total exists only
 *     once every active criterion has a score on the 1–10 scale, and until
 *     then it reads as a partial total with the cells still to fill.
 *   - The leader (the star) is the highest complete Total; an incomplete
 *     option never gets it, however high its partial sum. But an
 *     incomplete option whose lowest possible Total (its scores so far
 *     plus SCORE_MIN on every empty cell) already beats the leader's is
 *     certain to overtake it: the verdict says so, and the result can't go
 *     to a decision record until that option is scored.
 *   - A tie: complete options within TIE_MARGIN (5 %) of the leader's Total.
 *   - Sensitivity: the smallest change to one criterion's weight, within
 *     ±SENSITIVITY_LIMIT (50 %), that hands the lead to another option.
 *     Totals are linear in each weight, so the flip point is exact.
 *
 * Pure and server-safe: the Weighted Decision page and the
 * tool.weighted_decision agent actions both compute through matrixResult,
 * so the two always agree on a matrix's totals, leader, tie and verdict.
 */

import type {
  HandoffLink,
  HandoffRef,
  WeightedCriterion,
  WeightedMatrix,
  WeightedOption,
} from "@/lib/stores/workspace-types";
import { DEFAULT_WEIGHTED_MATRIX_ID, weightedMatrixIdOf } from "@/lib/stores/workspace-types";
import type { HandoffSource } from "@/lib/handoffs/types";
import { fmt } from "@/lib/charts/chart-text";
import { isExampleId } from "@/lib/utils/example-id";

export { DEFAULT_WEIGHTED_MATRIX_ID };

/** Every cell is scored on this scale; an empty cell is "not scored". */
export const SCORE_MIN = 1;
export const SCORE_MAX = 10;
/** The top two complete totals within this share of the leader's are a tie. */
export const TIE_MARGIN = 0.05;
/** A weight change up to this share (either way) that flips the leader is worth a warning. */
export const SENSITIVITY_LIMIT = 0.5;

export const MATRIX_NAME_MAX = 120;
export const MATRIX_QUESTION_MAX = 300;
export const CRITERION_NAME_MAX = 120;
export const OPTION_NAME_MAX = 200;
/** What a 1 and a 10 mean on a criterion. */
export const MEANING_MAX = 200;
export const NOTE_MAX = 500;
export const WEIGHT_MAX = 1000;

/** What the default matrix is called until someone names it. */
export const DEFAULT_MATRIX_NAME = "Untitled matrix";

/** The rows of one matrix (a row without a matrixId is the default matrix's). */
export function rowsOf<T extends { matrixId?: string }>(
  matrixId: string,
  rows: readonly T[] | undefined
): T[] {
  return (rows ?? []).filter((r) => weightedMatrixIdOf(r) === matrixId);
}

/**
 * The matrices to choose from: the stored ones, oldest first, and before
 * them the default matrix while rows sit in it and nobody has named it
 * (it has no stored document then). A stored default matrix keeps its
 * place among the others.
 */
export function matricesOf(
  stored: readonly WeightedMatrix[] | undefined,
  options: readonly WeightedOption[] | undefined,
  criteria: readonly WeightedCriterion[] | undefined
): WeightedMatrix[] {
  const list = [...(stored ?? [])].sort((a, b) =>
    (a.createdAt ?? "") < (b.createdAt ?? "")
      ? -1
      : (a.createdAt ?? "") > (b.createdAt ?? "")
        ? 1
        : 0
  );
  const hasDefaultDoc = list.some((m) => m.id === DEFAULT_WEIGHTED_MATRIX_ID);
  const hasDefaultRows =
    rowsOf(DEFAULT_WEIGHTED_MATRIX_ID, options).length > 0 ||
    rowsOf(DEFAULT_WEIGHTED_MATRIX_ID, criteria).length > 0;
  if (!hasDefaultDoc && hasDefaultRows) list.unshift(defaultMatrix());
  return list;
}

/** The default matrix as it reads before anyone names it. */
export function defaultMatrix(): WeightedMatrix {
  return { id: DEFAULT_WEIGHTED_MATRIX_ID, name: DEFAULT_MATRIX_NAME, createdAt: "" };
}

/** The matrix with `id`, or the default matrix's unnamed document for that id. */
export function findMatrix(
  stored: readonly WeightedMatrix[] | undefined,
  id: string
): WeightedMatrix | undefined {
  const doc = (stored ?? []).find((m) => m.id === id);
  if (doc) return doc;
  return id === DEFAULT_WEIGHTED_MATRIX_ID ? defaultMatrix() : undefined;
}

/** What the matrix decides, for a heading or a decision record's title. */
export function matrixTitle(m: Pick<WeightedMatrix, "name" | "question">): string {
  return m.question?.trim() || m.name.trim() || DEFAULT_MATRIX_NAME;
}

/* ── Cells ───────────────────────────────────────────────────────────── */

export function isOnScale(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= SCORE_MIN && n <= SCORE_MAX;
}

/** One cell: not scored, a score on the scale, or a stored value off it (an agent's). */
export type Cell =
  | { kind: "empty" }
  | { kind: "scored"; value: number }
  | { kind: "off"; value: number };

export function cellOf(option: Pick<WeightedOption, "scores">, criterionId: string): Cell {
  const v = option.scores?.[criterionId];
  if (typeof v !== "number" || !Number.isFinite(v)) return { kind: "empty" };
  return isOnScale(v) ? { kind: "scored", value: v } : { kind: "off", value: v };
}

/**
 * Why a typed score can't be saved, or null. A blank entry clears the
 * cell (not scored) and is fine.
 */
export function scoreInputError(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < SCORE_MIN || n > SCORE_MAX) {
    return `Scores run from ${SCORE_MIN} to ${SCORE_MAX}.`;
  }
  return null;
}

/** Why a weight can't be saved, or null. Required: a cleared weight is an error, never a silent 1. */
export function weightError(raw: string | number | undefined): string | null {
  if (raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
    return "Give it a weight (0 or more).";
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return "A weight is a number, 0 or more.";
  if (n > WEIGHT_MAX) return `Keep the weight to ${WEIGHT_MAX} or less.`;
  return null;
}

/* ── Results ─────────────────────────────────────────────────────────── */

export interface CriterionShare {
  id: string;
  name: string;
  weight: number;
  /** Counts toward the totals: a weight above 0. */
  active: boolean;
  /** Its share of the active weight, 0..1 (0 when inactive). */
  share: number;
  low?: string;
  high?: string;
}

export interface OptionResult {
  id: string;
  name: string;
  /** Σ score × weight once every active criterion is scored; null until then. */
  total: number | null;
  /** Σ score × weight over the active cells scored so far. */
  partialTotal: number;
  /** Active criteria this option has no score on yet (ids). */
  unscored: string[];
  /** Criteria whose stored score is off the 1–10 scale (not counted until fixed). */
  offScale: string[];
  complete: boolean;
  /** Dense rank among the complete options (1 = top); null for incomplete ones. */
  rank: number | null;
}

export interface SensitivityFlip {
  criterionId: string;
  criterion: string;
  /** The weight change that flips the leader, as a signed share of the weight (−0.2 = 20 % less). */
  changePct: number;
  /** Which way the weight moves: more helps an option that scores higher on it than the leader. */
  direction: "more" | "less";
  /** The weight at which the other option draws level. */
  weightAt: number;
  newLeaderId: string;
  newLeader: string;
}

/** An unfinished option certain to finish above the leader, however its empty cells are scored. */
export interface Overtaker {
  id: string;
  name: string;
  /** Σ score × weight over its cells scored so far. */
  partialTotal: number;
  /** Its lowest possible Total: partialTotal + SCORE_MIN × the weight of every empty cell. */
  minTotal: number;
  /** The active criteria it still needs a score on (ids). */
  unscored: string[];
}

export interface MatrixResult {
  matrixId: string;
  /** Σ of the active weights. */
  weightSum: number;
  criteria: CriterionShare[];
  /** Rank order: complete options by Total, then the incomplete ones by partial total. */
  options: OptionResult[];
  /** The highest complete Total; null while no option is complete. */
  leaderId: string | null;
  /** Complete options within TIE_MARGIN of the leader (the leader first), and the gap to the next. */
  tie: { ids: string[]; gap: number } | null;
  /** Unfinished options certain to overtake the leader once scored, surest first (none without a leader). */
  overtakers: Overtaker[];
  /** Per criterion, the smallest weight change within ±50 % that flips the leader (smallest first). */
  sensitivity: SensitivityFlip[];
  /** Whether sensitivity was worked out (2+ complete options and 2+ weighted criteria). */
  sensitivityChecked: boolean;
  /** Active cells still empty (or off the scale), across every option. */
  emptyCells: number;
  verdict: string;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** The rank order the results and the table's default sort share. */
function compareResults(a: OptionResult, b: OptionResult): number {
  if (a.complete !== b.complete) return a.complete ? -1 : 1;
  const ta = a.total ?? a.partialTotal;
  const tb = b.total ?? b.partialTotal;
  if (ta !== tb) return tb - ta;
  return byName(a, b);
}

/** Totals differ by less than floating-point noise. */
const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/**
 * Everything the page and the agent say about one matrix: each criterion's
 * share, each option's total (or partial total and what's missing), the
 * leader, a tie, the weight changes that would flip the result, and the
 * one-sentence verdict. `criteria` and `options` may be every row in the
 * workspace: only the matrix's own are read.
 */
export function matrixResult(
  matrixId: string,
  allCriteria: readonly WeightedCriterion[] | undefined,
  allOptions: readonly WeightedOption[] | undefined
): MatrixResult {
  const criteriaRows = rowsOf(matrixId, allCriteria);
  const optionRows = rowsOf(matrixId, allOptions);
  const active = criteriaRows.filter((c) => Number.isFinite(c.weight) && c.weight > 0);
  const weightSum = active.reduce((s, c) => s + c.weight, 0);
  const criteria: CriterionShare[] = criteriaRows.map((c) => {
    const on = Number.isFinite(c.weight) && c.weight > 0;
    return {
      id: c.id,
      name: c.name,
      weight: c.weight,
      active: on,
      share: on && weightSum > 0 ? c.weight / weightSum : 0,
      ...(c.low ? { low: c.low } : {}),
      ...(c.high ? { high: c.high } : {}),
    };
  });

  let emptyCells = 0;
  const results: OptionResult[] = optionRows.map((o) => {
    let partial = 0;
    const unscored: string[] = [];
    const offScale: string[] = [];
    for (const c of active) {
      const cell = cellOf(o, c.id);
      if (cell.kind === "scored") partial += cell.value * c.weight;
      else {
        unscored.push(c.id);
        if (cell.kind === "off") offScale.push(c.id);
      }
    }
    emptyCells += unscored.length;
    const complete = active.length > 0 && unscored.length === 0;
    return {
      id: o.id,
      name: o.name,
      total: complete ? partial : null,
      partialTotal: partial,
      unscored,
      offScale,
      complete,
      rank: null,
    };
  });
  results.sort(compareResults);

  // Dense rank over the complete options: equal totals share a rank.
  let rank = 0;
  let last: number | null = null;
  for (const r of results) {
    if (!r.complete || r.total === null) continue;
    if (last === null || !same(r.total, last)) rank += 1;
    r.rank = rank;
    last = r.total;
  }

  const complete = results.filter((r) => r.complete && r.total !== null);
  const leader = complete[0] ?? null;
  let tie: MatrixResult["tie"] = null;
  if (leader && leader.total !== null && complete.length > 1 && leader.total > 0) {
    const lead = leader.total;
    const close = complete.filter((r) => (lead - (r.total ?? 0)) / lead <= TIE_MARGIN + 1e-12);
    if (close.length > 1) tie = { ids: close.map((r) => r.id), gap: lead - (close[1].total ?? 0) };
  }

  // An empty cell will score at least SCORE_MIN, so an unfinished option's
  // lowest possible Total is known now; one already above the leader's
  // Total is certain to take the lead once it is scored.
  const weightOf = new Map(active.map((c) => [c.id, c.weight]));
  const lead = leader?.total ?? null;
  const overtakers: Overtaker[] =
    lead === null
      ? []
      : results
          .filter((r) => !r.complete)
          .map((r) => ({
            id: r.id,
            name: r.name,
            partialTotal: r.partialTotal,
            minTotal: r.unscored.reduce(
              (sum, id) => sum + (weightOf.get(id) ?? 0) * SCORE_MIN,
              r.partialTotal
            ),
            unscored: r.unscored,
          }))
          .filter((o) => o.minTotal > lead && !same(o.minTotal, lead))
          .sort((a, b) => b.minTotal - a.minTotal || byName(a, b));

  const sensitivityChecked = complete.length >= 2 && active.length >= 2;
  const sensitivity =
    sensitivityChecked && leader ? flips(leader, complete, active, optionRows) : [];

  const partial: Omit<MatrixResult, "verdict"> = {
    matrixId,
    weightSum,
    criteria,
    options: results,
    leaderId: leader?.id ?? null,
    tie,
    overtakers,
    sensitivity,
    sensitivityChecked,
    emptyCells,
  };
  return { ...partial, verdict: matrixVerdict(partial) };
}

/**
 * For each active criterion, the smallest change to its weight (within
 * ±SENSITIVITY_LIMIT, and never below 0) at which a complete runner-up
 * draws level with the leader. Totals are linear in one weight, so for
 * runner-up j the change is (T_L − T_j) / (s_j − s_L) when their scores on
 * the criterion differ; the first runner-up to reach the leader is the new
 * one. Smallest change first.
 */
function flips(
  leader: OptionResult,
  complete: readonly OptionResult[],
  active: readonly WeightedCriterion[],
  options: readonly WeightedOption[]
): SensitivityFlip[] {
  const rows = new Map(options.map((o) => [o.id, o]));
  const scoreOn = (id: string, c: string) => {
    const cell = cellOf(rows.get(id) ?? { scores: {} }, c);
    return cell.kind === "scored" ? cell.value : 0;
  };
  const out: SensitivityFlip[] = [];
  for (const c of active) {
    const sL = scoreOn(leader.id, c.id);
    let best: { delta: number; j: OptionResult; up: boolean } | null = null;
    for (const j of complete) {
      if (j.id === leader.id || j.total === null || leader.total === null) continue;
      const sJ = scoreOn(j.id, c.id);
      if (sJ === sL) continue;
      const delta = (leader.total - j.total) / (sJ - sL);
      if (c.weight + delta < 0) continue;
      if (Math.abs(delta) > SENSITIVITY_LIMIT * c.weight + 1e-12) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, j, up: sJ > sL };
    }
    if (best) {
      out.push({
        criterionId: c.id,
        criterion: c.name,
        changePct: best.delta / c.weight,
        direction: best.up ? "more" : "less",
        weightAt: c.weight + best.delta,
        newLeaderId: best.j.id,
        newLeader: best.j.name,
      });
    }
  }
  return out.sort((a, b) => Math.abs(a.changePct) - Math.abs(b.changePct));
}

/** A total as the page shows it (two decimals at most). */
export function formatTotal(n: number): string {
  return fmt(n, 2);
}

/** A change as a whole percent, rounded up so the flip has happened at it: 20. */
export function changePercent(changePct: number): number {
  return Math.max(1, Math.ceil(Math.abs(changePct) * 100 - 1e-9));
}

/** "Weighting Cost 20% less makes Vendor B the winner." */
export function sensitivityText(f: SensitivityFlip): string {
  return `Weighting ${f.criterion} ${changePercent(f.changePct)}% ${f.direction} makes ${f.newLeader} the winner.`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function matrixVerdict(r: Omit<MatrixResult, "verdict">): string {
  if (r.criteria.length === 0 && r.options.length === 0) {
    return "Add the criteria that matter and the options to compare.";
  }
  if (r.criteria.length === 0) return "Add the criteria to score the options on.";
  if (r.options.length === 0) return "Add the options to compare.";
  if (r.weightSum <= 0) return "Every weight is 0: give at least one criterion a weight above 0.";
  const leader = r.options.find((o) => o.id === r.leaderId);
  if (!leader || leader.total === null) {
    return `No option is fully scored yet: ${plural(r.emptyCells, "cell is", "cells are")} empty.`;
  }
  const incomplete = r.options.filter((o) => !o.complete).length;
  if (r.overtakers.length > 0) return overtakeVerdict(r, leader.name, leader.total, incomplete);
  const rest =
    incomplete > 0
      ? ` ${plural(incomplete, "option isn't", "options aren't")} fully scored yet.`
      : "";
  if (r.tie) {
    const names = r.tie.ids.map((id) => r.options.find((o) => o.id === id)?.name ?? id);
    return `${joinNames(names)} are too close to call: ${formatTotal(r.tie.gap)} apart, within ${Math.round(TIE_MARGIN * 100)}% of the top total.${rest}`;
  }
  const second = r.options.find((o) => o.complete && o.id !== leader.id);
  const lead = `${leader.name} leads with ${formatTotal(leader.total)}`;
  const gap =
    second && second.total !== null
      ? `; ${second.name} is ${formatTotal(leader.total - second.total)} behind`
      : "";
  const flip = r.sensitivity[0];
  const sens = flip
    ? `, and weighting ${flip.criterion} ${changePercent(flip.changePct)}% ${flip.direction} would flip it`
    : "";
  return `${lead}${gap}${sens}.${rest}`;
}

/**
 * "Alpha will overtake Bravo once Speed is scored: its scores so far (30)
 * already beat Bravo's Total of 20." The lead isn't the result yet.
 */
function overtakeVerdict(
  r: Omit<MatrixResult, "verdict">,
  leader: string,
  total: number,
  incomplete: number
): string {
  const [first] = r.overtakers;
  const others = incomplete - r.overtakers.length;
  const rest =
    others > 0
      ? ` ${plural(others, "other option isn't", "other options aren't")} fully scored yet.`
      : "";
  if (r.overtakers.length === 1) {
    const names = r.criteria.filter((c) => first.unscored.includes(c.id)).map((c) => c.name);
    return `${first.name} will overtake ${leader} once ${joinNames(names)} ${names.length === 1 ? "is" : "are"} scored: its scores so far (${formatTotal(first.partialTotal)}) already beat ${leader}'s Total of ${formatTotal(total)}.${rest}`;
  }
  return `${joinNames(r.overtakers.map((o) => o.name))} will overtake ${leader} once their empty cells are scored: their scores so far already beat ${leader}'s Total of ${formatTotal(total)}.${rest}`;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/* ── Sending the result to a decision record ─────────────────────────── */

/** "1. Vendor B 78 · 2. Vendor A 72 · Vendor C (not fully scored)". */
export function rankingText(r: MatrixResult): string {
  return r.options
    .map((o) =>
      o.complete && o.total !== null && o.rank !== null
        ? `${o.rank}. ${o.name} ${formatTotal(o.total)}`
        : `${o.name} (not fully scored)`
    )
    .join(" · ");
}

/** Why a matrix can't go to a decision record yet: a code for the agent, a sentence for the page. */
export interface SendBlock {
  reason: "example" | "no_leader" | "overtaken";
  message: string;
}

/**
 * Why the matrix can't go to a decision record yet, or null: example
 * matrices stay out of the Decision Log; it needs a complete leader; and
 * not one an unfinished option is certain to overtake (the record would
 * recommend the option that loses).
 */
export function sendBlock(matrix: Pick<WeightedMatrix, "id">, r: MatrixResult): SendBlock | null {
  if (isExampleId(matrix.id)) {
    return { reason: "example", message: "Example matrices stay out of the Decision Log." };
  }
  if (!r.leaderId) {
    return {
      reason: "no_leader",
      message: "Score every cell of one option first: the record needs a leader.",
    };
  }
  const [first] = r.overtakers;
  if (first) {
    return {
      reason: "overtaken",
      message: `Score ${first.name}'s empty cells first: it will overtake the leader.`,
    };
  }
  return null;
}

/** sendBlock's sentence, or null. */
export function sendError(matrix: Pick<WeightedMatrix, "id">, r: MatrixResult): string | null {
  return sendBlock(matrix, r)?.message ?? null;
}

/**
 * What the record recommends: the leader with its Total, or in a tie the
 * tied options with theirs (alphabetical order among near-equal totals is
 * no reason to name one of them). Undefined without a leader.
 */
export function recommendationOf(r: MatrixResult): string | undefined {
  if (r.tie) {
    const tied = r.tie.ids.flatMap((id) => {
      const o = r.options.find((x) => x.id === id);
      return o && o.total !== null ? [`${o.name} (${formatTotal(o.total)})`] : [];
    });
    return `Too close to call: ${joinNames(tied)} are within ${Math.round(TIE_MARGIN * 100)}% of each other. Talk it through.`;
  }
  const leader = r.options.find((o) => o.id === r.leaderId);
  return leader && leader.total !== null
    ? `${leader.name} (weighted total ${formatTotal(leader.total)})`
    : undefined;
}

/**
 * The proposed decision record a matrix becomes: the question as its
 * title, the verdict and the ranking as its context, the options in rank
 * order, and the leader as the recommendation (the tied options in a tie:
 * recommendationOf). The outcome is left to the team.
 */
export function decisionSourceOf(matrix: WeightedMatrix, r: MatrixResult): HandoffSource {
  const recommendation = recommendationOf(r);
  const sourceRef: HandoffRef = { tool: "weighted-decision", id: matrix.id, doc: matrix.id };
  return {
    title: matrixTitle(matrix),
    description: `${r.verdict}\n\nRanking: ${rankingText(r)}`,
    sourceRef,
    decision: {
      template: "adr",
      options: r.options.map((o) => o.name),
      ...(recommendation ? { recommendation } : {}),
    },
  };
}

/** `links` with `link` recorded, replacing an older link on its route (as the hand-off registry does). */
export function withSentLink(
  links: readonly HandoffLink[] | undefined,
  link: HandoffLink
): HandoffLink[] {
  return [...(links ?? []).filter((l) => l.route !== link.route), link];
}

/** The decision record a matrix was sent to (its last link on the "decision" route), if any. */
export function decisionLinkOf(matrix: Pick<WeightedMatrix, "sentTo">): HandoffLink | undefined {
  return (matrix.sentTo ?? []).find((l) => l.route === "decision");
}

/**
 * The decision record a matrix's result went to, while it still exists in
 * `records` (the Decision Log's list): a link to a deleted record reads as
 * not sent, so the matrix can be sent again, as the page's link does.
 */
export function sentDecisionOf<D extends { id: string }>(
  matrix: Pick<WeightedMatrix, "sentTo">,
  records: readonly D[]
): D | undefined {
  const link = decisionLinkOf(matrix);
  return link ? records.find((d) => d.id === link.targetId) : undefined;
}

/** Where the result went, for the export: proposed, or decided since in the Decision Log. */
export function sentText(decided: boolean): string {
  return decided
    ? "Sent to the Decision Log, where it has since been decided."
    : "Sent to the Decision Log as a proposed decision.";
}

/* ── Saving ──────────────────────────────────────────────────────────── */

/**
 * An option with new values, every other stored field kept (its matrix,
 * its note): agents re-scoring an option must not move it to the default
 * matrix or drop what the team wrote on it.
 */
export function mergeOption(
  stored: WeightedOption | undefined,
  next: Pick<WeightedOption, "id" | "name" | "scores"> & Partial<WeightedOption>
): WeightedOption {
  return { ...(stored ?? {}), ...next, scores: { ...next.scores } };
}

/** The scores a write left off the scale, by criterion id (shown, not counted, until fixed). */
export function offScaleScores(scores: Record<string, number>): string[] {
  return Object.entries(scores)
    .filter(([, v]) => !isOnScale(v))
    .map(([k]) => k);
}
