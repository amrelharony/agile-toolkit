/**
 * Sprint Metrics' trend view, pure: the window the team picked, and the
 * trend rows (lib/sprints/trends) turned into what the charts draw, what
 * their tables and summaries say, and the words for each row's sources.
 * The numbers themselves all come from sprintTrends, so the page, its
 * Markdown and `tool.sprint_metrics.trend` agree. Beside say/do sits the
 * retros' follow-through (lib/retro/actions), read the way Retro Actions
 * rates it: whether the team does what it agrees, next to whether it
 * delivers what it commits to.
 */

import { NO_VALUE, fmt, plural, type ChartText } from "@/lib/charts/chart-text";
import { SAY_DO_GRADE_LABEL, type SayDoGrade } from "@/lib/sprints/metrics";
import { enoughData } from "@/lib/analytics/min-sample";
import { followThroughByRetro, quickAddBoard } from "@/lib/retro/actions";
import type { HandoffLink, RetroBoard } from "@/lib/stores/workspace-types";
import { ratedRetros, settleRetros, totals } from "@/app/(tools)/retro-actions/follow-through";
import {
  CARRY_OVER_SOURCE_LABEL,
  SCOPE_SOURCE_LABEL,
  DEFAULT_TREND_WINDOW,
  type SprintTrendRow,
  type SprintTrendSummary,
} from "@/lib/sprints/trends";

/** How many finished sprints the trend can look back over. */
export const WINDOW_OPTIONS = [3, 6, 12, "all"] as const;
export type TrendWindow = (typeof WINDOW_OPTIONS)[number];

/** Where this browser remembers the window (a per-viewer preference). */
export const WINDOW_KEY = "agile-toolkit:sprint-metrics:window";

/** The default: six sprints, enough for a trend (MIN_SAMPLE.trend). */
export const DEFAULT_WINDOW: TrendWindow = DEFAULT_TREND_WINDOW as TrendWindow;

/** A stored window as one of the options (anything else: the default). */
export function normalizeWindow(raw: unknown): TrendWindow {
  return (WINDOW_OPTIONS as readonly unknown[]).includes(raw)
    ? (raw as TrendWindow)
    : DEFAULT_WINDOW;
}

/** The window as sprintTrends takes it: a count, or null for all. */
export function windowSize(w: TrendWindow): number | null {
  return w === "all" ? null : w;
}

export function windowLabel(w: TrendWindow): string {
  return w === "all" ? "All sprints" : `Last ${w} sprints`;
}

/* ── Retro follow-through ───────────────────────────────────────────── */

export interface FollowThroughRead {
  /** Rated retros in the window: past retros that agreed at least one action. */
  retros: number;
  agreed: number;
  done: number;
  /** done ÷ agreed as a whole percentage; null with too few actions to quote one. */
  pct: number | null;
}

/**
 * The retros' follow-through over the trend's window: of the actions the
 * last `window` rated retros agreed (all of them for null), how many got
 * done. Rated as Retro Actions rates them: the retro still being followed
 * up isn't counted until the next one starts (settleRetros), and an action
 * is done when marked, when its impediment, Kanban card or story finished,
 * or when a carried copy got done. The percentage needs MIN_SAMPLE.average
 * actions behind it.
 */
export function retroFollowThrough(
  boards: readonly RetroBoard[],
  window: number | null,
  targetDone?: (link: HandoffLink) => boolean
): FollowThroughRead {
  const { settled } = settleRetros(
    followThroughByRetro(boards, { targetDone }),
    quickAddBoard(boards)
  );
  const rated = ratedRetros(settled);
  const used = window === null ? rated : rated.slice(-window);
  const { agreed, done } = totals(used);
  return {
    retros: used.length,
    agreed,
    done,
    pct: enoughData(agreed, "average") ? Math.round((done / agreed) * 100) : null,
  };
}

/** "58% · 7 of 12 actions done over the last 3 retros", or that no retro can be rated yet. */
export function followThroughText(read: FollowThroughRead): string {
  if (read.retros === 0) return "No past retro with actions to rate yet";
  const count = `${read.done} of ${plural(read.agreed, "action")} done`;
  const over = read.retros === 1 ? "at the last retro" : `over the last ${read.retros} retros`;
  return read.pct === null ? `${count} ${over}` : `${read.pct}% · ${count} ${over}`;
}

/* ── Say/do chart ───────────────────────────────────────────────────── */

export interface SayDoPoint {
  name: string;
  /** Say/do %, or null without a commitment (no bar). */
  pct: number | null;
  grade?: SayDoGrade;
  committed: number;
  completed: number | null;
}

export function sayDoPoints(summary: Pick<SprintTrendSummary, "rows">): SayDoPoint[] {
  return summary.rows.map((r) => ({
    name: r.sprint.name,
    pct: r.sayDo?.pct ?? null,
    ...(r.sayDo ? { grade: r.sayDo.grade } : {}),
    committed: r.committed,
    completed: r.completed,
  }));
}

export function sayDoChartText(summary: SprintTrendSummary): ChartText {
  const { sayDo } = summary;
  const summaryText =
    sayDo.considered === 0
      ? "No sprint in the window had a commitment to compare with."
      : `${plural(sayDo.considered, "sprint")} with a commitment: ${sayDo.met} met it (90–110%), ${sayDo.close} came close, ${sayDo.missed} missed and ${sayDo.over} did more${
          sayDo.meanPct !== null ? `; say/do averaged ${sayDo.meanPct}%` : ""
        }.`;
  return {
    summary: summaryText,
    table: {
      caption: "Say/do by sprint",
      columns: ["Sprint", "Committed", "Completed", "Say/do", "Grade"],
      rows: summary.rows.map((r) => [
        r.sprint.name,
        fmt(r.committed),
        r.completed === null ? NO_VALUE : fmt(r.completed),
        r.sayDo ? `${r.sayDo.pct}%` : NO_VALUE,
        r.sayDo ? SAY_DO_GRADE_LABEL[r.sayDo.grade] : "No commitment",
      ]),
    },
  };
}

/* ── Carry-over and scope chart ─────────────────────────────────────── */

export interface ChurnPoint {
  name: string;
  /** Carried-over points; null when nothing says. */
  carried: number | null;
  /** Scope added after day 0 (drawn up). */
  added: number;
  /** Scope removed after day 0, as a negative number (drawn down). */
  removed: number;
  churnPct: number | null;
}

export function churnPoints(summary: Pick<SprintTrendSummary, "rows">): ChurnPoint[] {
  return summary.rows.map((r) => ({
    name: r.sprint.name,
    carried: r.carryOver.points,
    added: r.scope.source === "none" ? 0 : r.scope.added,
    removed: r.scope.source === "none" ? 0 : -r.scope.removed,
    churnPct: r.scope.churnPct,
  }));
}

/** "3 stories, 8 points (24%)", "8 points (from the numbers)" or "—". */
export function carryOverText(r: SprintTrendRow): string {
  const c = r.carryOver;
  if (c.points === null) return NO_VALUE;
  const pts = `${fmt(c.points)} ${c.points === 1 ? "point" : "points"}`;
  const head = c.count === null ? pts : `${plural(c.count, "story", "stories")}, ${pts}`;
  return c.pct === null ? head : `${head} (${c.pct}%)`;
}

/** "+5 / −3 (27%)" or "—" when not recorded. */
export function scopeText(r: SprintTrendRow): string {
  const s = r.scope;
  if (s.source === "none") return NO_VALUE;
  return `+${fmt(s.added)} / −${fmt(s.removed)}${s.churnPct === null ? "" : ` (${s.churnPct}%)`}`;
}

/** Where a row's carry-over and scope numbers came from, in words. */
export function sourcesText(r: SprintTrendRow): string {
  const carry = CARRY_OVER_SOURCE_LABEL[r.carryOver.source];
  const scope = SCOPE_SOURCE_LABEL[r.scope.source];
  return carry === scope ? `Both ${carry}` : `Carry-over ${carry}; scope ${scope}`;
}

export function churnChartText(summary: SprintTrendSummary): ChartText {
  const { carryOver, churn } = summary;
  const parts: string[] = [];
  parts.push(
    carryOver.meanPoints !== null
      ? `Carry-over averaged ${fmt(carryOver.meanPoints)} points a sprint over ${plural(carryOver.count, "sprint")}`
      : `${plural(carryOver.count, "sprint")} say what they carried over`
  );
  parts.push(
    churn.meanPct !== null
      ? `scope changed by ${churn.meanPct}% of the commitment after day 0, on average`
      : churn.count === 0
        ? "no sprint has a record of its scope changing"
        : `${plural(churn.count, "sprint")} record how their scope changed`
  );
  return {
    summary: `${parts.join("; ")}.`,
    table: {
      caption: "Carry-over and scope change by sprint",
      columns: ["Sprint", "Carried over", "Scope added", "Scope removed", "Churn", "Source"],
      rows: summary.rows.map((r) => [
        r.sprint.name,
        carryOverText(r),
        r.scope.source === "none" ? NO_VALUE : fmt(r.scope.added),
        r.scope.source === "none" ? NO_VALUE : fmt(r.scope.removed),
        r.scope.churnPct === null ? NO_VALUE : `${r.scope.churnPct}%`,
        sourcesText(r),
      ]),
    },
  };
}
