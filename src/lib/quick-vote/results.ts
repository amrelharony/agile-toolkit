/**
 * Quick Vote's saved results: a closed round's totals as the vote kit
 * hands them to `onSave` (never a ballot, a name or who picked what), plus
 * what the host adds afterwards: the real answer to a guess, the value
 * written to a backlog item, where the result was sent.
 *
 * The result shapes below mirror the kit's (`VoteRoundResult`,
 * `ChoiceRoundResult`, `RankRoundResult`, `NumberRoundResult`) field for
 * field, so the page passes them straight through; the tool's model.ts
 * checks at compile time that both ways still fit. They are written out
 * here, from the kit's protocol types only, so Amr's actions can read
 * saved results without loading the kit's counting code.
 *
 * Everything read back from storage is rebuilt field by field and capped
 * (`normalizeResults`): a synced or hand-edited value can hold anything.
 * Pure and server-safe.
 */

import type { VoteRoomTool, VoteScale } from "@/lib/realtime/vote-room/protocol";
import type { HandoffLink, HandoffRouteId } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { cleanLine } from "./draft";
import { isPresetId, presetById, type PresetId, type QuickVoteKind } from "./presets";

// ── Shapes (the kit's, totals only) ──────────────────────────────────

type Source = "live" | "facilitator";

/** A scale round (the kit's `VoteRoundResult`): count per point, per question. */
export interface StoredScaleResult {
  roundId: string;
  tool: VoteRoomTool;
  questionnaireId: string;
  title: string;
  scale: VoteScale;
  closedAt: string;
  minN: number;
  ballots: number;
  source: Source;
  questions: {
    id: string;
    text: string;
    responses: number;
    distribution: number[] | null;
  }[];
}

/** A choice round (the kit's `ChoiceRoundResult`): people (or dots) per option. */
export interface StoredChoiceResult {
  kind: "choice";
  roundId: string;
  tool: "quick-vote";
  sheetId: string;
  title: string;
  mode: "single" | "multi" | "dots";
  limit: number;
  closedAt: string;
  minN: number;
  ballots: number;
  source: Source;
  options: { id: string; text: string; total: number; backers: number | null }[];
}

/** A rank round (the kit's `RankRoundResult`): Borda points per option. */
export interface StoredRankResult {
  kind: "rank";
  roundId: string;
  tool: "quick-vote";
  sheetId: string;
  title: string;
  closedAt: string;
  minN: number;
  ballots: number;
  source: Source;
  options: { id: string; text: string; points: number }[];
}

/** A number round (the kit's `NumberRoundResult`): the median, and the spread from 5. */
export interface StoredNumberResult {
  kind: "number";
  roundId: string;
  tool: "quick-vote";
  sheetId: string;
  title: string;
  min: number;
  max: number;
  decimals: 0 | 1 | 2;
  unit: string;
  closedAt: string;
  minN: number;
  ballots: number;
  source: Source;
  median: number;
  spread: { min: number; q1: number; q3: number; max: number; histogram: number[] } | null;
}

export type StoredRoundResult =
  | StoredScaleResult
  | StoredChoiceResult
  | StoredRankResult
  | StoredNumberResult;

/** The routes a result can be sent on. */
export const RESULT_ROUTES = [
  "decision",
  "retro-topic",
] as const satisfies readonly HandoffRouteId[];
export type ResultRoute = (typeof RESULT_ROUTES)[number];

/** One saved round. */
export interface SavedResult {
  id: string;
  /** The format it was run as. */
  presetId: PresetId;
  /** When the host saved it (ISO). */
  savedAt: string;
  result: StoredRoundResult;
  /** Guess the number: the real answer, added afterwards. */
  realAnswer?: number;
  /** Value poker: the backlog item it valued. */
  backlogItemId?: string;
  /** Value poker: the value written to that item (absent until the host saves one). */
  valueSaved?: number;
  /** Where it was sent (the Decision Log, the retro). */
  sentTo?: HandoffLink[];
}

/** The most results kept: years of meetings, without growing forever. */
export const MAX_RESULTS = 100;

// ── Reading back ─────────────────────────────────────────────────────

const ID_RE = /^[A-Za-z0-9:_-]{1,64}$/;
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const isCount = (v: unknown, max = 100_000): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isId = (v: unknown): v is string => typeof v === "string" && ID_RE.test(v);
const isTime = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));
const text = (v: unknown, max: number): string | null => {
  const t = cleanLine(v, max);
  return t ? t : null;
};

/** The parts every kind of result has, or null. */
function readHead(r: Record<string, unknown>) {
  if (r.tool !== "quick-vote") return null;
  if (typeof r.roundId !== "string" || !r.roundId || r.roundId.length > 64) return null;
  const title = text(r.title, 200);
  if (!title || !isTime(r.closedAt)) return null;
  if (!isCount(r.minN, 99) || r.minN < 1 || !isCount(r.ballots, 9_999)) return null;
  if (r.source !== "live" && r.source !== "facilitator") return null;
  return {
    roundId: r.roundId,
    tool: "quick-vote" as const,
    title,
    closedAt: r.closedAt,
    minN: r.minN,
    ballots: r.ballots,
    source: r.source as Source,
  };
}

function readOptionsOf<T>(
  raw: unknown,
  read: (o: Record<string, unknown>) => T | null
): T[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 12) return null;
  const out: T[] = [];
  for (const x of raw) {
    const o = obj(x);
    const row = o ? read(o) : null;
    if (!row) return null;
    out.push(row);
  }
  return out;
}

/** A stored round result, rebuilt field by field, or null when it isn't one. */
export function normalizeRoundResult(raw: unknown): StoredRoundResult | null {
  const r = obj(raw);
  if (!r) return null;
  const head = readHead(r);
  if (!head) return null;

  if (r.kind === undefined) {
    const scale = obj(r.scale);
    if (!isId(r.questionnaireId) || !scale || !isId(scale.id)) return null;
    if (!Array.isArray(scale.points) || scale.points.length < 2 || scale.points.length > 11) {
      return null;
    }
    const points: VoteScale["points"] = [];
    for (const x of scale.points) {
      const p = obj(x);
      const label = p ? text(p.label, 40) : null;
      if (!p || !label || !Number.isInteger(p.value)) return null;
      points.push({ value: p.value as number, label });
    }
    if (!Array.isArray(r.questions) || r.questions.length < 1 || r.questions.length > 32) {
      return null;
    }
    const questions: StoredScaleResult["questions"] = [];
    for (const x of r.questions) {
      const q = obj(x);
      const qText = q ? text(q.text, 200) : null;
      if (!q || !isId(q.id) || !qText || !isCount(q.responses, 9_999)) return null;
      let distribution: number[] | null = null;
      if (q.distribution !== null) {
        if (
          !Array.isArray(q.distribution) ||
          q.distribution.length !== points.length ||
          !q.distribution.every((n) => isCount(n, 9_999))
        ) {
          return null;
        }
        distribution = (q.distribution as number[]).slice();
      }
      questions.push({ id: q.id, text: qText, responses: q.responses, distribution });
    }
    return {
      roundId: head.roundId,
      tool: head.tool,
      questionnaireId: r.questionnaireId,
      title: head.title,
      scale: { id: scale.id, points },
      closedAt: head.closedAt,
      minN: head.minN,
      ballots: head.ballots,
      source: head.source,
      questions,
    };
  }

  if (!isId(r.sheetId)) return null;

  if (r.kind === "choice") {
    if (r.mode !== "single" && r.mode !== "multi" && r.mode !== "dots") return null;
    if (!isCount(r.limit, 12) || r.limit < 1) return null;
    const options = readOptionsOf(r.options, (o) => {
      const t = text(o.text, 120);
      if (!isId(o.id) || !t || !isCount(o.total)) return null;
      if (o.backers !== null && !isCount(o.backers)) return null;
      return { id: o.id, text: t, total: o.total, backers: o.backers as number | null };
    });
    if (!options) return null;
    return {
      kind: "choice",
      ...head,
      sheetId: r.sheetId,
      mode: r.mode,
      limit: r.limit,
      options,
    };
  }

  if (r.kind === "rank") {
    const options = readOptionsOf(r.options, (o) => {
      const t = text(o.text, 120);
      return isId(o.id) && t && isCount(o.points) ? { id: o.id, text: t, points: o.points } : null;
    });
    if (!options || options.length > 10) return null;
    return { kind: "rank", ...head, sheetId: r.sheetId, options };
  }

  if (r.kind === "number") {
    if (!isNum(r.min) || !isNum(r.max) || r.min >= r.max || !isNum(r.median)) return null;
    if (r.decimals !== 0 && r.decimals !== 1 && r.decimals !== 2) return null;
    const unit = typeof r.unit === "string" ? cleanLine(r.unit, 8) : "";
    let spread: StoredNumberResult["spread"] = null;
    if (r.spread !== null) {
      const s = obj(r.spread);
      if (
        !s ||
        !isNum(s.min) ||
        !isNum(s.q1) ||
        !isNum(s.q3) ||
        !isNum(s.max) ||
        !Array.isArray(s.histogram) ||
        s.histogram.length !== 10 ||
        !s.histogram.every((n) => isCount(n, 9_999))
      ) {
        return null;
      }
      spread = {
        min: s.min,
        q1: s.q1,
        q3: s.q3,
        max: s.max,
        histogram: (s.histogram as number[]).slice(),
      };
    }
    return {
      kind: "number",
      ...head,
      sheetId: r.sheetId,
      min: r.min,
      max: r.max,
      decimals: r.decimals,
      unit,
      median: r.median,
      spread,
    };
  }
  return null;
}

/** The kind of round a result is ("scale" for the kit's result without a `kind`). */
export function resultKind(r: StoredRoundResult): QuickVoteKind {
  return "kind" in r ? r.kind : "scale";
}

/** The format a result with no stored one most likely came from. */
function presetForKind(kind: QuickVoteKind): PresetId {
  return kind === "scale"
    ? "custom-scale"
    : kind === "rank"
      ? "ranking"
      : kind === "number"
        ? "guess-number"
        : "poll";
}

function readLinks(raw: unknown): HandoffLink[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: HandoffLink[] = [];
  for (const x of raw.slice(0, 10)) {
    const l = obj(x);
    if (!l || !(RESULT_ROUTES as readonly string[]).includes(l.route as string)) continue;
    if (typeof l.targetId !== "string" || !l.targetId || l.targetId.length > 120) continue;
    if (!isTime(l.at)) continue;
    out.push({ route: l.route as ResultRoute, targetId: l.targetId, at: l.at });
  }
  return out.length > 0 ? out : undefined;
}

/** One saved result read back, or null. */
export function normalizeSavedResult(raw: unknown): SavedResult | null {
  const r = obj(raw);
  if (!r || typeof r.id !== "string" || !r.id || r.id.length > 80) return null;
  const result = normalizeRoundResult(r.result);
  if (!result || !isTime(r.savedAt)) return null;
  const kind = resultKind(result);
  const fromStore = isPresetId(r.presetId) ? r.presetId : null;
  // A format of another kind than the result can't be right.
  const presetId =
    fromStore && presetById(fromStore)?.kind === kind ? fromStore : presetForKind(kind);
  const saved: SavedResult = { id: r.id, presetId, savedAt: r.savedAt, result };
  if (kind === "number" && isNum(r.realAnswer)) saved.realAnswer = r.realAnswer;
  if (presetId === "value-poker") {
    if (typeof r.backlogItemId === "string" && r.backlogItemId && r.backlogItemId.length <= 64) {
      saved.backlogItemId = r.backlogItemId;
    }
    if (isCount(r.valueSaved, 100)) saved.valueSaved = r.valueSaved;
  }
  const links = readLinks(r.sentTo);
  if (links) saved.sentTo = links;
  return saved;
}

/** Saved results read back: valid ones only, each id once, newest first, at most MAX_RESULTS. */
export function normalizeResults(raw: unknown): SavedResult[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SavedResult[] = [];
  for (const x of raw) {
    const saved = normalizeSavedResult(x);
    if (!saved || seen.has(saved.id)) continue;
    seen.add(saved.id);
    out.push(saved);
  }
  out.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
  return out.slice(0, MAX_RESULTS);
}

// ── Reading a result ─────────────────────────────────────────────────

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** "a, b and c". */
function listAnd(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** A number with its unit: "40%", "12 days". */
export function withUnit(n: number, unit: string): string {
  const num = n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (!unit) return num;
  return /[0-9A-Za-zÀ-ɏ]/.test(unit) ? `${num} ${unit}` : `${num}${unit}`;
}

/** A scale round's mean (its first question), or null while withheld. */
export function scaleMean(r: StoredScaleResult): number | null {
  const d = r.questions[0]?.distribution;
  if (!d) return null;
  const n = d.reduce((a, b) => a + b, 0);
  if (n === 0) return null;
  return d.reduce((sum, c, i) => sum + c * r.scale.points[i].value, 0) / n;
}

/** The options with the most people (or dots), and that total; none when nothing was picked. */
export function choiceLeaders(r: StoredChoiceResult): { texts: string[]; total: number } {
  const top = Math.max(0, ...r.options.map((o) => o.total));
  if (top === 0) return { texts: [], total: 0 };
  return { texts: r.options.filter((o) => o.total === top).map((o) => o.text), total: top };
}

/** Value poker: the most-picked values (several when tied), as numbers. */
export function valuePicks(r: StoredRoundResult): number[] {
  if (resultKind(r) !== "choice") return [];
  return choiceLeaders(r as StoredChoiceResult)
    .texts.map(Number)
    .filter((n) => Number.isFinite(n));
}

/** One sentence for a saved round: who answered and what came out on top. */
export function resultSummary(saved: SavedResult): string {
  const r = saved.result;
  const who = `${people(r.ballots)} answered`;
  switch (resultKind(r)) {
    case "scale": {
      const s = r as StoredScaleResult;
      const mean = scaleMean(s);
      const top = s.scale.points[s.scale.points.length - 1]?.value;
      if (mean === null) return `${who}; too few to show the scale.`;
      const d = s.questions[0].distribution as number[];
      const most = Math.max(...d);
      const modes = s.scale.points.filter((_, i) => d[i] === most).map((p) => p.label);
      return `${who}. Average ${round1(mean)} of ${top}; most said ${listAnd(modes)} (${most}).`;
    }
    case "choice": {
      const c = r as StoredChoiceResult;
      const { texts, total } = choiceLeaders(c);
      if (texts.length === 0) return `${who}; nothing was picked.`;
      const what =
        c.mode === "dots" ? (total === 1 ? "dot" : "dots") : total === 1 ? "vote" : "votes";
      return texts.length === 1
        ? `${who}. Top: ${texts[0]} (${total} ${what}).`
        : `${who}. Tied at the top: ${listAnd(texts)} (${total} ${what} each).`;
    }
    case "rank": {
      const k = r as StoredRankResult;
      const top = Math.max(...k.options.map((o) => o.points));
      const leaders = k.options.filter((o) => o.points === top).map((o) => o.text);
      return leaders.length === 1
        ? `${who}. Ranked first overall: ${leaders[0]}.`
        : `${who}. Tied first: ${listAnd(leaders)}.`;
    }
    case "number": {
      const n = r as StoredNumberResult;
      const base = `${who}. Median guess ${withUnit(n.median, n.unit)}.`;
      return saved.realAnswer === undefined ? base : `${base} ${guessVerdict(n, saved.realAnswer)}`;
    }
  }
}

/**
 * Guess the number, once the real answer is in: how far the median was,
 * and where the real answer sits against the guesses (the spread shows
 * from 5 answers; before that only the median compares).
 */
export function guessVerdict(r: StoredNumberResult, real: number): string {
  const off = Math.abs(r.median - real);
  const dir = r.median === real ? "" : r.median > real ? " high" : " low";
  const pct = real !== 0 ? ` (${Math.round((off / Math.abs(real)) * 100)}%)` : "";
  const median =
    off === 0
      ? `The real answer was ${withUnit(real, r.unit)}: the median guess was spot on.`
      : `The real answer was ${withUnit(real, r.unit)}: the median guess was ${withUnit(round1(off), r.unit)}${dir}${pct}.`;
  if (!r.spread) return median;
  const s = r.spread;
  const where =
    real < s.min || real > s.max
      ? "Nobody guessed that far out."
      : real >= s.q1 && real <= s.q3
        ? "It sits inside the middle half of the guesses."
        : "It sits inside the guesses, outside their middle half.";
  return `${median} ${where}`;
}

/** Answers on a scale at or below `value`, in a scale result's first question. */
function atOrBelow(r: StoredScaleResult, value: number): number {
  const d = r.questions[0]?.distribution;
  if (!d) return 0;
  return r.scale.points.reduce((n, p, i) => (p.value <= value ? n + d[i] : n), 0);
}

/**
 * Whether a saved round shows the room agreeing, for the formats that ask
 * for agreement: fist of five with nobody under 3, gradients of agreement
 * with nobody below "I can live with it", a Roman vote with no thumbs down
 * and most thumbs up. False for every other format, and for a withheld scale.
 */
export function showsAgreement(saved: SavedResult): boolean {
  const r = saved.result;
  if (saved.presetId === "fist-of-five" && resultKind(r) === "scale") {
    const s = r as StoredScaleResult;
    return scaleMean(s) !== null && atOrBelow(s, 2) === 0;
  }
  if (saved.presetId === "consent" && resultKind(r) === "choice") {
    const c = r as StoredChoiceResult;
    return c.options.length === 8 && c.options.slice(4).every((o) => o.total === 0);
  }
  if (saved.presetId === "roman" && resultKind(r) === "choice") {
    const c = r as StoredChoiceResult;
    const [up, , down] = c.options;
    return Boolean(up && down) && down.total === 0 && up.total * 2 > c.ballots;
  }
  return false;
}

/**
 * The day a result was saved, YYYY-MM-DD in the viewer's own time zone, as
 * the list shows it (an ISO slice would give the UTC day: yesterday, for a
 * round saved after midnight east of UTC).
 */
export function savedDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : todayLocalISO(d);
}

/** The format's name for a saved result. */
export function presetName(saved: SavedResult): string {
  return presetById(saved.presetId)?.name ?? "Quick Vote";
}

/** The page's one line about the latest result, or the empty state's. */
export function latestVerdict(results: readonly SavedResult[]): string {
  const latest = results[0];
  if (!latest) return "No results saved yet. Pick a format, ask, and save the totals.";
  return `Latest, ${presetName(latest)}: “${latest.result.title}”. ${resultSummary(latest)}`;
}
