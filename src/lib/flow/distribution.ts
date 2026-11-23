/**
 * Flow distribution: what kinds of work a team finishes (features, defects,
 * debt, risk) against the mix it aims for, and how much of it is failure
 * demand, repeat work caused by an earlier failure. Flow Insights, its
 * agent actions and its next steps read through here, so a story or a card
 * is sorted the same way everywhere.
 *
 * A row's type, in order:
 *   1. the type set on it (`workType`);
 *   2. stories: `storyKind(story) === "fix"` (lib/stories/kind, the rule
 *      release notes use) is a defect;
 *   3. stories: its tags (cards have none);
 *   4. where it was sent from (`sourceRef.tool`), for stories and cards;
 *   5. otherwise not sorted. Title words are only read by the "Sort by
 *      keywords" fallback (`keywordWorkType`), never to count a row.
 *
 * Failure demand: a `demand` set on the row wins; else a defect (set or
 * guessed) is failure demand; else a reopened item (a move out of Done) is.
 *
 * Read live from the stories and the Flow board, never copied. Example rows
 * are left out unless asked for. Pure and server-safe.
 */

import type {
  CapacityPlan,
  KanbanCard,
  Sprint,
  Story,
  WorkDemand,
  WorkflowDefinition,
  WorkType,
} from "@/lib/stores/workspace-types";
import { WORK_DEMANDS, WORK_TYPES } from "@/lib/stores/workspace-types";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { mannKendall } from "@/lib/analytics/trend-test";
import { isoFromDayNumber } from "@/lib/sprints/calendar";
import { storyKind } from "@/lib/stories/kind";
import { isExampleId } from "@/lib/utils/example-id";
import { WORK_TYPE_LABEL, targetSplitOf, type TargetSplit } from "./work-types";
import { blockedInCycle } from "./blocks";
import { cycleSummary, finishedItems } from "./cycle";
import { cardItems, storyItems } from "./items";
import { changedRecently, finishedSprints, teamStability, type TeamStability } from "./stability";
import { weekOf } from "./throughput";
import { dayNumber } from "./days";
import type { FlowItem } from "./types";

/** Which board the numbers come from. */
export type FlowBoard = "sprint" | "flow";

/** How a row's type was found: set on it, or guessed from its kind, tags or source, or title words. */
export type TypeBasis = "set" | "kind" | "tag" | "source" | "keywords";

export interface TypeGuess {
  type: WorkType;
  by: TypeBasis;
}

/** Why a finished item counts as failure demand. */
export type FailureWhy = "marked" | "defect" | "reopened";

const isWorkType = (v: unknown): v is WorkType =>
  typeof v === "string" && (WORK_TYPES as readonly string[]).includes(v);
const isWorkDemand = (v: unknown): v is WorkDemand =>
  typeof v === "string" && (WORK_DEMANDS as readonly string[]).includes(v);

/** A story, not a card: stories have a status, cards a column. */
export function isStoryRow(row: Story | KanbanCard): row is Story {
  return !("column" in row) || (row as { column?: unknown }).column === undefined;
}

const TAG_RULES: readonly { type: WorkType; tags: readonly string[] }[] = [
  { type: "defect", tags: ["defect", "hotfix", "incident"] },
  { type: "debt", tags: ["debt", "tech-debt", "refactor", "cleanup", "upgrade"] },
  { type: "risk", tags: ["risk", "security", "compliance", "spike", "vuln"] },
];

const SOURCE_RULES: readonly { type: WorkType; tools: readonly string[] }[] = [
  { type: "defect", tools: ["bug-triage", "incident-commander", "post-mortem", "flaky-tests"] },
  { type: "debt", tools: ["tech-debt"] },
  { type: "risk", tools: ["risk-register", "premortem", "threat-model", "vuln-burndown"] },
];

/** The row's tags, lower-cased; cards have none. */
function tagsOf(row: Story | KanbanCard): string[] {
  const tags: unknown = (row as Story).tags;
  return Array.isArray(tags)
    ? tags.filter((t): t is string => typeof t === "string").map((t) => t.trim().toLowerCase())
    : [];
}

/** The tool the row was sent from, or undefined. */
export function sourceToolOf(row: Pick<Story, "sourceRef">): string | undefined {
  const tool = row.sourceRef?.tool;
  return typeof tool === "string" && tool ? tool : undefined;
}

/**
 * The row's work type by the rules above, without title words: set, its
 * story kind, its tags, where it came from. Null when nothing says ("not
 * sorted").
 */
export function guessWorkType(row: Story | KanbanCard): TypeGuess | null {
  if (isWorkType(row.workType)) return { type: row.workType, by: "set" };
  const story = isStoryRow(row);
  if (story && storyKind(row) === "fix") return { type: "defect", by: "kind" };
  if (story) {
    const tags = tagsOf(row);
    for (const rule of TAG_RULES) {
      if (tags.some((t) => rule.tags.includes(t))) return { type: rule.type, by: "tag" };
    }
  }
  const from = sourceToolOf(row);
  if (from) {
    for (const rule of SOURCE_RULES) {
      if (rule.tools.includes(from)) return { type: rule.type, by: "source" };
    }
  }
  return null;
}

const KEYWORD_RULES: readonly { type: WorkType; words: RegExp }[] = [
  { type: "defect", words: /\b(fix|fixes|fixed|bugs?|broken|errors?|crash(es|ed|ing)?)\b/i },
  { type: "debt", words: /\b(refactor\w*|upgrade\w*|clean\w*|migrat\w*)\b/i },
  { type: "risk", words: /\b(security|audits?|compliance|risks?|spikes?)\b/i },
];

/**
 * A type from the title (and a card's description or a story's notes):
 * fix, bug, broken, error or crash is a defect; refactor, upgrade, clean or
 * migrate is debt; security, audit, compliance, risk or spike is risk;
 * anything else is a feature. The "Sort by keywords" fallback only.
 */
export function keywordWorkType(title: string, text = ""): WorkType {
  const words = `${title} ${text}`;
  for (const rule of KEYWORD_RULES) if (rule.words.test(words)) return rule.type;
  return "feature";
}

/** Whether the item was reopened: a move out of Done. */
export function wasReopened(item: Pick<FlowItem, "moves"> | null | undefined): boolean {
  return Boolean(item?.moves.some((m) => m.from === "done"));
}

/**
 * Whether a finished row is failure demand, and why: marked on the row,
 * a defect (set or guessed), or reopened. `why` is null when it isn't.
 */
export function isFailureDemand(
  row: Story | KanbanCard,
  item?: Pick<FlowItem, "moves"> | null
): { failure: boolean; why: FailureWhy | null } {
  if (isWorkDemand(row.demand)) {
    return row.demand === "failure"
      ? { failure: true, why: "marked" }
      : { failure: false, why: null };
  }
  if (guessWorkType(row)?.type === "defect") return { failure: true, why: "defect" };
  if (wasReopened(item)) return { failure: true, why: "reopened" };
  return { failure: false, why: null };
}

/** A finished item as the mix counts it. */
export interface MixItem {
  kind: "story" | "card";
  id: string;
  title: string;
  /** Local "YYYY-MM-DD" it was done. */
  doneOn: string;
  /** Null: not sorted. */
  type: WorkType | null;
  /** How the type was found; null when not sorted. */
  typeBy: TypeBasis | null;
  failure: boolean;
  failureWhy: FailureWhy | null;
  reopened: boolean;
  /** The demand set on the row, if any. */
  demand: WorkDemand | null;
}

/** One sprint or ISO week of finished work. */
export interface MixPeriod {
  /** The sprint's id, or the week ("2026-W42"). */
  id: string;
  /** The sprint's name, or the week. */
  label: string;
  /** The sprint's end day, or the week's last finish; null without one. */
  end: string | null;
  items: MixItem[];
  finished: number;
  counts: Record<WorkType, number>;
  unsorted: number;
  /** Items whose type is a guess (not set on them). */
  guessed: number;
  failure: number;
  /** Failure demand as a whole-number share of what finished; null with nothing finished. */
  failurePct: number | null;
}

export interface MixInput {
  board: FlowBoard;
  stories: readonly Story[];
  sprints: readonly Sprint[];
  cards: readonly KanbanCard[];
  /** Keep `example-` rows (a page's in-memory example). */
  includeExamples?: boolean;
  /** Flow board: fill quiet weeks up to this day's week. */
  today?: string;
}

const emptyCounts = (): Record<WorkType, number> => ({ feature: 0, defect: 0, debt: 0, risk: 0 });

function mixItem(row: Story | KanbanCard, item: FlowItem): MixItem {
  const guess = guessWorkType(row);
  const fd = isFailureDemand(row, item);
  return {
    kind: item.kind,
    id: row.id,
    title: typeof row.title === "string" ? row.title : "",
    doneOn: item.doneOn as string,
    type: guess?.type ?? null,
    typeBy: guess?.by ?? null,
    failure: fd.failure,
    failureWhy: fd.why,
    reopened: wasReopened(item),
    demand: isWorkDemand(row.demand) ? row.demand : null,
  };
}

function period(id: string, label: string, end: string | null, items: MixItem[]): MixPeriod {
  const counts = emptyCounts();
  let unsorted = 0;
  let guessed = 0;
  let failure = 0;
  for (const it of items) {
    if (it.type) counts[it.type]++;
    else unsorted++;
    if (it.type && it.typeBy !== "set") guessed++;
    if (it.failure) failure++;
  }
  const finished = items.length;
  return {
    id,
    label,
    end,
    items,
    finished,
    counts,
    unsorted,
    guessed,
    failure,
    failurePct: finished > 0 ? Math.round((failure / finished) * 100) : null,
  };
}

/**
 * Finished work per period, oldest first:
 *   - Sprint board: per finished sprint, its stories (`storyItems` with the
 *     sprint) done on or before its end;
 *   - Flow board: per ISO week of the cards' done days, quiet weeks as 0,
 *     up to `today`'s week when given.
 */
export function mixByPeriod(input: MixInput): MixPeriod[] {
  const { board, includeExamples = false } = input;
  if (board === "sprint") {
    const byId = new Map(input.stories.map((s) => [s.id, s]));
    return finishedSprints(input.sprints, includeExamples).map((sprint) => {
      const end = dayNumber(sprint.endDate);
      const items = storyItems(input.stories, { sprint, includeExamples })
        .filter((it) => it.stage === "done" && it.doneOn !== null)
        .filter((it) => end === null || (dayNumber(it.doneOn) as number) <= end)
        .flatMap((it) => {
          const row = byId.get(it.id);
          return row ? [mixItem(row, it)] : [];
        });
      return period(sprint.id, sprint.name || "Untitled sprint", sprint.endDate ?? null, items);
    });
  }
  const byId = new Map(input.cards.map((c) => [c.id, c]));
  const weeks = new Map<string, MixItem[]>();
  let first: number | null = null;
  let last: number | null = null;
  for (const it of cardItems(input.cards, { includeExamples })) {
    if (it.stage !== "done" || !it.doneOn) continue;
    const row = byId.get(it.id);
    const week = weekOf(it.doneOn);
    const n = dayNumber(it.doneOn);
    if (!row || !week || n === null) continue;
    first = first === null ? n : Math.min(first, n);
    last = last === null ? n : Math.max(last, n);
    const list = weeks.get(week) ?? [];
    list.push(mixItem(row, it));
    weeks.set(week, list);
  }
  if (first === null || last === null) return [];
  const todayN = input.today ? dayNumber(input.today) : null;
  const stop = todayN !== null && todayN > last ? todayN : last;
  const stopWeek = weekOf(isoFromDayNumber(stop));
  const out: MixPeriod[] = [];
  // Day numbers step whole days; a 1000-week cap keeps a bad date from looping long.
  for (let n = first; out.length < 1000; n += 7) {
    const week = weekOf(isoFromDayNumber(n)) as string;
    const items = (weeks.get(week) ?? []).sort((a, b) => a.doneOn.localeCompare(b.doneOn));
    const lastDone = items.length ? items[items.length - 1].doneOn : null;
    out.push(period(week, week, lastDone, items));
    if (week === stopWeek) break;
  }
  return out;
}

/** The last `n` periods. */
export function windowOf<T>(periods: readonly T[], n: number): T[] {
  return n > 0 ? periods.slice(-n) : [];
}

/** The window's totals: finished, per type, unsorted, guessed and failure demand. */
export interface MixTotals {
  finished: number;
  counts: Record<WorkType, number>;
  unsorted: number;
  guessed: number;
  failure: number;
  failurePct: number | null;
}

export function mixTotals(periods: readonly MixPeriod[]): MixTotals {
  const counts = emptyCounts();
  let finished = 0;
  let unsorted = 0;
  let guessed = 0;
  let failure = 0;
  for (const p of periods) {
    finished += p.finished;
    unsorted += p.unsorted;
    guessed += p.guessed;
    failure += p.failure;
    for (const t of WORK_TYPES) counts[t] += p.counts[t];
  }
  return {
    finished,
    counts,
    unsorted,
    guessed,
    failure,
    failurePct: finished > 0 ? Math.round((failure / finished) * 100) : null,
  };
}

/** One kind of work against its target. */
export interface TargetGap {
  type: WorkType;
  target: number;
  /** Its whole-number share of the sorted work finished; null when none is sorted. */
  delivered: number | null;
  /** delivered − target, in points; null without a delivered share. */
  gap: number | null;
}

/**
 * Each kind of work's share of the sorted work the periods finished (set
 * or guessed; not-sorted items left out) against the target mix. Empty
 * without a target.
 */
export function targetGaps(periods: readonly MixPeriod[], target: TargetSplit | null): TargetGap[] {
  if (!target) return [];
  const totals = mixTotals(periods);
  const sorted = WORK_TYPES.reduce((n, t) => n + totals.counts[t], 0);
  return WORK_TYPES.map((type) => {
    const delivered = sorted > 0 ? Math.round((totals.counts[type] / sorted) * 100) : null;
    return {
      type,
      target: target[type],
      delivered,
      gap: delivered === null ? null : delivered - target[type],
    };
  });
}

/** "Debt 5% vs 15% target". */
export function gapLabel(g: TargetGap): string {
  return `${WORK_TYPE_LABEL[g.type]} ${g.delivered ?? "—"}% vs ${g.target}% target`;
}

/**
 * Mann-Kendall's own floor: it never calls a trend below 10 points
 * (lib/analytics/trend-test), so a "no trend" there would only mean "too
 * few periods". The Impediments page gates its trend the same way.
 */
export const FLOW_TREND_MIN = Math.max(MIN_SAMPLE.trend, 10);

export interface FailureTrend {
  /** Periods with finished work that it read. */
  n: number;
  trend: "up" | "down" | "none";
  pValue: number;
  significant: boolean;
  sentence: string;
}

/**
 * The trend of the failure-demand share over every period with finished
 * work (not only the window), or null below FLOW_TREND_MIN such periods.
 */
export function failureTrend(periods: readonly MixPeriod[], board: FlowBoard): FailureTrend | null {
  const series = periods.filter((p) => p.failurePct !== null).map((p) => p.failurePct as number);
  if (series.length < FLOW_TREND_MIN) return null;
  const t = mannKendall(series);
  const p = t.pValue.toFixed(2);
  const over = `${series.length} ${board === "sprint" ? "sprints" : "weeks"}`;
  const sentence =
    !t.significant || t.trend === "none"
      ? `No clear trend in repeat work over the last ${over} (Mann-Kendall p = ${p}).`
      : t.trend === "up"
        ? `Repeat work is rising over the last ${over} (Mann-Kendall p = ${p}).`
        : `Repeat work is falling over the last ${over} (Mann-Kendall p = ${p}).`;
  return {
    n: series.length,
    trend: t.trend,
    pValue: t.pValue,
    significant: t.significant,
    sentence,
  };
}

/** Why an item counts as repeat work, in words. */
export const FAILURE_WHY_LABEL: Record<FailureWhy, string> = {
  marked: "marked as repeat work",
  defect: "a defect",
  reopened: "reopened",
};

/** How a type was found, in words. */
export const TYPE_BY_LABEL: Record<TypeBasis, string> = {
  set: "set",
  kind: "a fix, by its title or tags",
  tag: "from its tags",
  source: "from the tool it came from",
  keywords: "from its words",
};

/** The finished items in the periods with no type set on them, newest first. */
export function unsortedItems(periods: readonly MixPeriod[]): MixItem[] {
  return periods
    .flatMap((p) => p.items)
    .filter((it) => it.typeBy !== "set")
    .sort((a, b) => b.doneOn.localeCompare(a.doneOn));
}

/* ── The whole read, for the page, its export and the agent ─────────── */

/** The window sizes the page offers: sprints, or weeks on the Flow board. */
export const SPRINT_WINDOWS = [3, 6, 12] as const;
export const WEEK_WINDOWS = [4, 12, 26] as const;
export type SprintWindow = (typeof SPRINT_WINDOWS)[number];
export type WeekWindow = (typeof WEEK_WINDOWS)[number];

export interface InsightsInput {
  /** The board to read; null picks one (`defaultBoard`). */
  board: FlowBoard | null;
  stories: readonly Story[];
  sprints: readonly Sprint[];
  cards: readonly KanbanCard[];
  plans: readonly CapacityPlan[] | undefined;
  workflow: WorkflowDefinition | null | undefined;
  /** Periods in the window (sprints or weeks). */
  periods: number;
  /** Local "YYYY-MM-DD". */
  today: string;
  /** Now in ms, for spells still open. */
  now: number;
  includeExamples?: boolean;
}

/** Blocked time inside the cycles of the window's finished items. */
export interface BlockedShare {
  /** Finished items whose cycle could be read (started on or after BLOCK_TRACKING_SINCE). */
  items: number;
  blockedMs: number;
  cycleMs: number;
  /** blocked ÷ cycle as a whole-number percent, from MIN_SAMPLE.distribution items; else null. */
  pct: number | null;
}

export interface FlowInsights {
  board: FlowBoard;
  /** Every period, oldest first (the trend reads them all). */
  all: MixPeriod[];
  /** The window's periods, oldest first. */
  periods: MixPeriod[];
  totals: MixTotals;
  target: TargetSplit | null;
  gaps: TargetGap[];
  trend: FailureTrend | null;
  stability: TeamStability;
  /** The window's cycle-time P85 in days, from MIN_SAMPLE.distribution items; else null. */
  cycleP85: number | null;
  blocked: BlockedShare;
  verdict: string;
}

/** The Sprint board when a sprint has finished, else the Flow board when a card has, else the Sprint board. */
export function defaultBoard(
  input: Pick<InsightsInput, "sprints" | "cards" | "includeExamples">
): FlowBoard {
  if (finishedSprints(input.sprints, input.includeExamples).length > 0) return "sprint";
  const done = input.cards.some(
    (c) => c && c.column === "done" && (input.includeExamples || !isExampleId(c.id))
  );
  return done ? "flow" : "sprint";
}

function blockedShare(
  periods: readonly MixPeriod[],
  stories: readonly Story[],
  cards: readonly KanbanCard[],
  now: number
): BlockedShare {
  const storyById = new Map(stories.map((s) => [s.id, s]));
  const cardById = new Map(cards.map((c) => [c.id, c]));
  let items = 0;
  let blockedMs = 0;
  let cycleMs = 0;
  for (const p of periods) {
    for (const it of p.items) {
      const row = it.kind === "story" ? storyById.get(it.id) : cardById.get(it.id);
      const read = row ? blockedInCycle(row, now) : null;
      if (!read || read.cycleMs <= 0) continue;
      items++;
      blockedMs += read.blockedMs;
      cycleMs += read.cycleMs;
    }
  }
  const pct =
    items >= MIN_SAMPLE.distribution && cycleMs > 0
      ? Math.round((blockedMs / cycleMs) * 100)
      : null;
  return { items, blockedMs, cycleMs, pct };
}

function cycleP85Of(
  periods: readonly MixPeriod[],
  stories: readonly Story[],
  cards: readonly KanbanCard[],
  board: FlowBoard,
  includeExamples: boolean
): number | null {
  const ids = new Set(periods.flatMap((p) => p.items.map((it) => it.id)));
  const items =
    board === "sprint"
      ? storyItems(
          stories.filter((s) => ids.has(s.id)),
          { includeExamples }
        )
      : cardItems(
          cards.filter((c) => ids.has(c.id)),
          { includeExamples }
        );
  const days = finishedItems(items).map((f) => f.days);
  return days.length >= MIN_SAMPLE.distribution ? cycleSummary(days).p85 : null;
}

const unitOf = (board: FlowBoard, n: number) =>
  board === "sprint" ? (n === 1 ? "sprint" : "sprints") : n === 1 ? "week" : "weeks";

/**
 * The one-sentence read above the page: what finished over the window, how
 * much was repeat work, the widest gap to the target mix (5 points or
 * more), what isn't sorted, and a team change in the last two sprints.
 * Counts only, never names.
 */
export function flowVerdict(x: Omit<FlowInsights, "verdict">): string {
  const n = x.periods.length;
  if (x.totals.finished === 0) {
    return x.board === "sprint"
      ? "Nothing finished yet in a completed sprint. Finish work on the Sprint board to see its mix."
      : "Nothing finished yet on the Flow board. Move cards to Done to see their mix.";
  }
  const parts: string[] = [
    `${x.totals.finished} ${x.totals.finished === 1 ? "item" : "items"} finished over the last ${n} ${unitOf(x.board, n)}`,
  ];
  if (x.totals.failurePct !== null) parts.push(`${x.totals.failurePct}% of it repeat work`);
  const widest = x.gaps
    .filter((g): g is TargetGap & { gap: number } => g.gap !== null && Math.abs(g.gap) >= 5)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
  if (widest) parts.push(gapLabel(widest));
  let out = `${parts.join(", ")}.`;
  if (x.totals.unsorted > 0) {
    out += ` ${x.totals.unsorted} ${x.totals.unsorted === 1 ? "isn't" : "aren't"} sorted yet.`;
  }
  const change = x.stability.lastChange;
  if (change && changedRecently(x.stability)) {
    const who = [
      change.joined.length ? `${change.joined.length} joined` : "",
      change.left.length ? `${change.left.length} left` : "",
    ]
      .filter(Boolean)
      .join(", ");
    out += ` The team changed in ${change.name} (${who}).`;
  }
  return out;
}

/** Everything Flow Insights shows, read live from the workspace. */
export function flowInsights(input: InsightsInput): FlowInsights {
  const includeExamples = input.includeExamples ?? false;
  const board = input.board ?? defaultBoard(input);
  const all = mixByPeriod({
    board,
    stories: input.stories,
    sprints: input.sprints,
    cards: input.cards,
    includeExamples,
    today: input.today,
  });
  const periods = windowOf(all, input.periods);
  const totals = mixTotals(periods);
  const target = targetSplitOf(input.workflow);
  const partial: Omit<FlowInsights, "verdict"> = {
    board,
    all,
    periods,
    totals,
    target,
    gaps: targetGaps(periods, target),
    trend: failureTrend(all, board),
    stability: teamStability(input.sprints, input.plans, input.stories, { includeExamples }),
    cycleP85: cycleP85Of(periods, input.stories, input.cards, board, includeExamples),
    blocked: blockedShare(periods, input.stories, input.cards, input.now),
  };
  return { ...partial, verdict: flowVerdict(partial) };
}
