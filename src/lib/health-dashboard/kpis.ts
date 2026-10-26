/**
 * The health dashboard's six KPIs, worked out from the workspace by the
 * shared libraries, so the page, tool.health_dashboard.get_summary and every
 * device read the same numbers the source tools show:
 *
 *   - predictability: the shared `predictability` over the latest pointed
 *     sprints (a sprint closed without points is left out and named), with
 *     the shared velocity beside it;
 *   - team health: the latest saved squad health check, scored by the shared
 *     `healthShare` (never the unsaved draft, which starts all green);
 *   - open and critical impediments: the shared `impedimentSummary`;
 *   - open standup blockers: recent ones only (the blocker window), not
 *     resolved and not already raised as impediments (those count there),
 *     one per person and blocker however many days it was repeated;
 *   - cycle time P85: finished stories (Sprint board) and cards (Flow board)
 *     through lib/flow, the board stamps instead of another tool's
 *     device-local store.
 *
 * Rows from a tool's "Load an example" (`example-` ids) are left out unless
 * asked for, so an example never counts in a real team's numbers. Pure, and
 * safe for the agent's server bundle.
 */

import type {
  AsyncUpdate,
  HealthCheck,
  HealthCheckEntry,
  HealthDashboardConfig,
  Impediment,
  KanbanBoard,
  KpiThreshold,
  Sprint,
  StandupEntry,
  Story,
} from "@/lib/stores/workspace-types";
import { HEALTH_CHECK_ID, KANBAN_BOARD_ID } from "@/lib/stores/workspace-types";
import { isPointedSprint, predictability, velocity } from "@/lib/sprints/metrics";
import { checksByDate, entryShare } from "@/lib/health-check/score";
import { isExampleId } from "@/lib/utils/example-id";
import { impedimentSummary } from "@/lib/impediments/model";
import { allStandupEntries, hasBlocker } from "@/lib/standup/entries";
import { addDays, cardItems, cycleSummary, finishedItems, storyItems } from "@/lib/flow";
import { enoughData, type SampleKind } from "@/lib/analytics/min-sample";
import { mannKendall } from "@/lib/analytics/trend-test";
import {
  HEALTH_KPI_IDS,
  KPI_DEFINITIONS,
  daysText,
  kpiStatus,
  settingsOf,
  type HealthKpiId,
  type HealthSettings,
  type KpiUnit,
  type TrafficStatus,
} from "./settings";

/** The one squad health check doc's id (kept under this name for older imports). */
export const HEALTH_CHECK_DOC_ID = HEALTH_CHECK_ID;

/** Whether a row came from a tool's "Load an example" (server-safe: lib/utils/example-id). */
const isExampleRow = isExampleId;

/** What the dashboard reads. Every list is optional: a tool never used reads as empty. */
export interface DashboardSources {
  sprints?: readonly Sprint[];
  stories?: readonly Story[];
  kanbanBoards?: readonly KanbanBoard[];
  healthChecks?: readonly HealthCheck[];
  impediments?: readonly Impediment[];
  standupEntries?: readonly StandupEntry[];
  asyncUpdates?: readonly AsyncUpdate[];
  /** The team's settings (HEALTH_DASHBOARD_ID); absent: the defaults. */
  config?: HealthDashboardConfig | null;
  /** Local "YYYY-MM-DD". */
  today: string;
}

export interface DashboardOptions {
  /** Count `example-` rows (the page's in-memory example). */
  includeExamples?: boolean;
}

/** Which way a KPI's history moves: "same" when the test finds no direction. */
export type KpiTrend = "up" | "down" | "same";

/** One KPI as the page, the export and the agent show it. */
export interface HealthKpi {
  id: HealthKpiId;
  name: string;
  unit: KpiUnit;
  higherIsBetter: boolean;
  /** Null without data, or without enough to quote (see `need`). */
  value: number | null;
  /** Null with no value: "No data" is never a colour. */
  status: TrafficStatus | null;
  /** How many things it was worked out from (sprints, lights, impediments, blockers, items). */
  n: number;
  /** Whether the source tool holds anything this KPI reads. */
  hasData: boolean;
  /** Enough data to quote the value (MIN_SAMPLE). */
  enough: boolean;
  /** Where the number comes from, in a sentence. */
  basis: string;
  /** A second line: velocity, overdue and oldest, older blockers, the median. */
  detail?: string;
  /**
   * Oldest first: every pointed sprint's say/do % (not just the window's),
   * each saved check's health %.
   */
  series?: number[];
  /**
   * The direction of that history, absent with nothing to compare: team
   * health against the check before; predictability by the Mann-Kendall
   * test from MIN_SAMPLE.trend sprints ("same" until it confirms one).
   */
  trend?: KpiTrend;
  /** Below the minimum sample: what to add, for NotEnoughData. */
  need?: {
    have: number;
    need: SampleKind;
    unit: readonly [string, string];
    action: string;
    what: string;
  };
  threshold: KpiThreshold;
  source: { label: string; href: string };
  /** Open standup blockers dated before the window (shown as "+N older"). */
  olderOpen?: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function kpi(
  id: HealthKpiId,
  settings: HealthSettings,
  fields: Omit<
    HealthKpi,
    "id" | "name" | "unit" | "higherIsBetter" | "status" | "threshold" | "source"
  >
): HealthKpi {
  const def = KPI_DEFINITIONS[id];
  const threshold = settings.thresholds[id];
  return {
    id,
    name: def.name,
    unit: def.unit,
    higherIsBetter: def.higherIsBetter,
    ...fields,
    status: kpiStatus(id, fields.value, threshold),
    threshold,
    source: def.source,
  };
}

/* ── Predictability ─────────────────────────────────────────────────── */

/**
 * A series' direction by the shared Mann-Kendall test, once MIN_SAMPLE.trend
 * points exist: "same" while it confirms none (it can from 10 points).
 */
function seriesTrend(series: readonly number[]): KpiTrend | undefined {
  if (!enoughData(series.length, "trend")) return undefined;
  const r = mannKendall([...series]);
  return r.significant && r.trend !== "none" ? r.trend : "same";
}

const noCompletedNumber = (s: Sprint) =>
  typeof s.pointsCompleted !== "number" || !Number.isFinite(s.pointsCompleted);

function predictabilityKpi(sprints: readonly Sprint[], settings: HealthSettings): HealthKpi {
  const p = predictability(sprints, { window: settings.windows.sprintWindow });
  // The trend reads every pointed sprint: cut to the window (6 by default),
  // the shared test, which confirms a trend from 10 points, never could.
  const history = predictability(sprints, { window: Number.POSITIVE_INFINITY }).sprints.map(
    (s) => s.pct
  );
  const finished = sprints.filter((s) => s.status === "completed");
  // Name only the sprints left out of the span the window read (from its
  // oldest sprint on), not every one the team ever closed without points.
  const from = p.sprints[0]?.endDate;
  const skipped = finished.filter(
    (s) => !isPointedSprint(s) && (from === undefined || (s.endDate ?? "") >= from)
  );
  const noNumber = skipped.filter(noCompletedNumber).length;
  const unpointed = skipped.length - noNumber;
  const reasons = [
    unpointed > 0 ? plural(unpointed, "unpointed sprint") : null,
    noNumber > 0 ? `${noNumber} closed without a completed number` : null,
  ].filter((r): r is string => r !== null);
  const v = velocity(sprints.filter(isPointedSprint));
  const enough = enoughData(p.count, "average");
  const leftOut = reasons.length > 0 ? ` (${reasons.join(" and ")} left out)` : "";
  const basis =
    p.count > 0
      ? `From the latest ${plural(p.count, "pointed sprint")}${leftOut}: the share that delivered 90–110% of what they committed.`
      : finished.length > 0
        ? `None of the ${plural(finished.length, "finished sprint")} is pointed: ${reasons.join(" and ")}.`
        : "No finished sprints yet.";
  const trend = seriesTrend(history);
  const detail =
    v.average !== null
      ? `Velocity ${v.average} points (latest ${plural(v.count, "sprint")})${
          p.meanSayDoPct !== null ? `; mean say/do ${p.meanSayDoPct}%` : ""
        }.`
      : undefined;
  return kpi("predictability", settings, {
    value: enough ? p.pct : null,
    n: p.count,
    hasData: finished.length > 0,
    enough,
    basis,
    ...(detail ? { detail } : {}),
    series: history,
    ...(trend ? { trend } : {}),
    ...(enough
      ? {}
      : {
          need: {
            have: p.count,
            need: "average" as const,
            unit: ["pointed sprint", "pointed sprints"] as const,
            action: "Close",
            what: "predictability",
          },
        }),
  });
}

/* ── Team health ────────────────────────────────────────────────────── */

/** The squad health check doc: the singleton, else the first one stored. */
function healthDoc(docs: readonly HealthCheck[]): HealthCheck | undefined {
  return docs.find((d) => d.id === HEALTH_CHECK_ID) ?? docs[0];
}

/**
 * The saved checks, oldest first by date (stable, so of two on one day the
 * later saved is last): the history, never the draft `current`. The Health
 * Check page lists them the same way (lib/health-check/score checksByDate).
 */
export function savedHealthChecks(
  doc: HealthCheck | undefined,
  { includeExamples = false }: DashboardOptions = {}
): HealthCheckEntry[] {
  return checksByDate(doc, { includeExamples });
}

/** A check's health as the Health Check page shows it: built-in and custom lights, yellow half. */
const healthPct = (e: HealthCheckEntry): number | null => {
  const share = entryShare(e);
  return share === null ? null : Math.round(share * 100);
};

/** The lights the score was read from (built-in and custom). */
const scoredLights = (e: HealthCheckEntry) =>
  [...Object.values(e.scores ?? {}), ...Object.values(e.customScores ?? {})].filter(
    (s) => s && (s.light === "green" || s.light === "yellow" || s.light === "red")
  ).length;

function teamHealthKpi(
  docs: readonly HealthCheck[],
  settings: HealthSettings,
  opts: DashboardOptions
): HealthKpi {
  const saved = savedHealthChecks(healthDoc(docs), opts);
  const scored = saved
    .map((e) => ({ e, pct: healthPct(e) }))
    .filter((x): x is { e: HealthCheckEntry; pct: number } => x.pct !== null);
  const latest = scored[scored.length - 1];
  const before = scored[scored.length - 2];
  if (!latest) {
    return kpi("team-health", settings, {
      value: null,
      n: 0,
      hasData: false,
      enough: false,
      basis:
        saved.length > 0
          ? "The saved health checks have no lights set."
          : "No saved health check yet: the draft on the Health Check page doesn't count until it is saved.",
    });
  }
  const on = latest.e.date ? ` on ${latest.e.date.slice(0, 10)}` : "";
  const name = latest.e.sprintName?.trim();
  const basis = name
    ? `From the health check for “${name}”${on}: green 1, yellow ½, red 0.`
    : `From the health check${on}: green 1, yellow ½, red 0.`;
  let detail: string | undefined;
  let trend: KpiTrend | undefined;
  if (before) {
    const diff = latest.pct - before.pct;
    trend = diff > 0 ? "up" : diff < 0 ? "down" : "same";
    detail =
      diff === 0
        ? "The same as the check before."
        : `${diff > 0 ? "Up" : "Down"} ${plural(Math.abs(diff), "point")} since the check before.`;
  }
  return kpi("team-health", settings, {
    value: latest.pct,
    n: scoredLights(latest.e),
    hasData: true,
    enough: true,
    basis,
    ...(detail ? { detail } : {}),
    series: scored.map((x) => x.pct),
    ...(trend ? { trend } : {}),
  });
}

/* ── Impediments ────────────────────────────────────────────────────── */

function impedimentKpis(
  list: readonly Impediment[],
  today: string,
  settings: HealthSettings
): [HealthKpi, HealthKpi] {
  const s = impedimentSummary(list, today);
  const has = list.length > 0;
  const unresolved = s.open + s.escalated;
  const oldest =
    s.oldestOpenDays !== null ? `the oldest has been open ${daysText(s.oldestOpenDays)}` : null;
  const detail =
    s.overdue > 0
      ? `${s.overdue} overdue${oldest ? `; ${oldest}` : ""}.`
      : oldest
        ? `None overdue; ${oldest}.`
        : undefined;
  const open = kpi("open-impediments", settings, {
    value: has ? unresolved : null,
    n: s.total,
    hasData: has,
    enough: has,
    basis: has
      ? `${s.open} open and ${s.escalated} escalated, of ${plural(s.total, "impediment")} logged.`
      : "No impediments logged yet.",
    ...(detail ? { detail } : {}),
  });
  const critical = kpi("critical-impediments", settings, {
    value: has ? s.critical : null,
    n: s.total,
    hasData: has,
    enough: has,
    basis: has
      ? `Unresolved impediments at Critical severity, of ${plural(unresolved, "unresolved one")}.`
      : "No impediments logged yet.",
  });
  return [open, critical];
}

/* ── Standup blockers ───────────────────────────────────────────────── */

const blockerKey = (e: StandupEntry) =>
  `${(e.member ?? "").trim().toLowerCase()}|${(e.blockers ?? "").trim().toLowerCase().replace(/\s+/g, " ")}`;

const raisedAsImpediment = (e: StandupEntry) =>
  Array.isArray(e.sentTo) && e.sentTo.some((l) => l?.route === "impediment");

/** The standup blockers the KPI counts, and the ones it leaves to other counts. */
export interface BlockerCount {
  /** Open, recent and not raised as impediments, one per person and blocker. */
  recent: number;
  /** Open ones dated before the window (and not repeated inside it). */
  olderOpen: number;
  /**
   * Open ones mentioned in the window that were raised as impediments (on
   * any day): counted under impediments. One raised long ago and never
   * mentioned since isn't counted here, so the number doesn't only grow.
   */
  raised: number;
  /** Entries read (live and async). */
  entries: number;
}

export function countBlockers(
  standupEntries: readonly StandupEntry[] | undefined,
  asyncUpdates: readonly AsyncUpdate[] | undefined,
  today: string,
  windowDays: number,
  { includeExamples = false }: DashboardOptions = {}
): BlockerCount {
  const entries = allStandupEntries(standupEntries, asyncUpdates).filter(
    (e) => includeExamples || !isExampleRow(e.id)
  );
  const from = addDays(today, -(windowDays - 1)) ?? today;
  // Open blockers mentioned in the window, and only before it.
  const recent = new Set<string>();
  const older = new Set<string>();
  // Every blocker raised as an impediment, whenever: one raised on one day
  // and repeated on another is the impediment's now.
  const raised = new Set<string>();
  for (const e of entries) {
    if (!hasBlocker(e) || e.blockerResolved) continue;
    const key = blockerKey(e);
    if (raisedAsImpediment(e)) raised.add(key);
    if ((e.date ?? "") >= from) recent.add(key);
    else older.add(key);
  }
  let olderOpen = 0;
  older.forEach((k) => {
    if (!recent.has(k) && !raised.has(k)) olderOpen++;
  });
  let counted = 0;
  let raisedRecent = 0;
  recent.forEach((k) => {
    if (raised.has(k)) raisedRecent++;
    else counted++;
  });
  return { recent: counted, olderOpen, raised: raisedRecent, entries: entries.length };
}

function blockersKpi(src: DashboardSources, settings: HealthSettings, opts: DashboardOptions) {
  const days = settings.windows.blockerWindowDays;
  const c = countBlockers(src.standupEntries, src.asyncUpdates, src.today, days, opts);
  const has = c.entries > 0;
  const raised =
    c.raised > 0 ? ` ${plural(c.raised, "more is", "more are")} already an impediment.` : "";
  return kpi("open-blockers", settings, {
    value: has ? c.recent : null,
    n: c.recent,
    hasData: has,
    enough: has,
    basis: has
      ? `Unresolved blockers from standups in the last ${daysText(days)}, one per person and blocker.${raised}`
      : "No standup entries yet.",
    ...(c.olderOpen > 0
      ? {
          detail: `+${c.olderOpen} older unresolved ${c.olderOpen === 1 ? "blocker" : "blockers"}: resolve or raise ${c.olderOpen === 1 ? "it" : "them"} on Standup.`,
        }
      : {}),
    olderOpen: c.olderOpen,
  });
}

/* ── Cycle time ─────────────────────────────────────────────────────── */

function cycleKpi(src: DashboardSources, settings: HealthSettings, opts: DashboardOptions) {
  const days = settings.windows.cycleWindowDays;
  const board = (src.kanbanBoards ?? []).find((b) => b?.id === KANBAN_BOARD_ID);
  const items = [
    ...storyItems(src.stories ?? [], opts),
    ...cardItems(Array.isArray(board?.cards) ? board.cards : [], opts),
  ];
  const from = addDays(src.today, -(days - 1)) ?? src.today;
  const finished = finishedItems(items, { from, to: src.today });
  const summary = cycleSummary(finished.map((f) => f.days));
  const stories = finished.filter((f) => f.kind === "story").length;
  const cards = finished.filter((f) => f.kind === "card").length;
  const enough = enoughData(summary.count, "distribution");
  return kpi("cycle-time-p85", settings, {
    value: enough ? summary.p85 : null,
    n: summary.count,
    hasData: summary.count > 0,
    enough,
    basis:
      summary.count > 0
        ? `From ${plural(stories, "story", "stories")} and ${plural(cards, "card")} finished in the last ${daysText(days)}, start and finish day counted (Sprint and Flow boards).`
        : `No story or card with a start date finished in the last ${daysText(days)}.`,
    ...(enough && summary.median !== null ? { detail: `Median ${daysText(summary.median)}.` } : {}),
    ...(enough
      ? {}
      : {
          need: {
            have: summary.count,
            need: "distribution" as const,
            // "Finish 3 more items with start dates…" (not "finished items").
            unit: ["item with a start date", "items with start dates"] as const,
            action: "Finish",
            what: "the cycle time P85",
          },
        }),
  });
}

/* ── All six ────────────────────────────────────────────────────────── */

/** The six KPIs, in HEALTH_KPI_IDS order, under the team's settings. */
export function dashboardKpis(src: DashboardSources, opts: DashboardOptions = {}): HealthKpi[] {
  const settings = settingsOf(src.config);
  const keep = <T extends { id: string }>(xs: readonly T[] | undefined): T[] =>
    (Array.isArray(xs) ? xs : []).filter(
      (x) => x && typeof x === "object" && (opts.includeExamples || !isExampleRow(x.id))
    );
  const [open, critical] = impedimentKpis(keep(src.impediments), src.today, settings);
  const byId: Record<HealthKpiId, HealthKpi> = {
    predictability: predictabilityKpi(keep(src.sprints), settings),
    "team-health": teamHealthKpi(src.healthChecks ?? [], settings, opts),
    "open-impediments": open,
    "critical-impediments": critical,
    "open-blockers": blockersKpi(src, settings, opts),
    "cycle-time-p85": cycleKpi(src, settings, opts),
  };
  return HEALTH_KPI_IDS.map((id) => byId[id]);
}

const POINTS: Record<TrafficStatus, number> = { green: 2, amber: 1, red: 0 };

/** Where the overall score turns amber and red (green 2, amber 1, red 0, as a %). */
export const OVERALL_CUTS = { green: 75, amber: 50 } as const;

export interface OverallHealth {
  /** The average traffic light of the KPIs with one, as a % (green 100, amber 50, red 0). */
  score: number | null;
  status: TrafficStatus | null;
  /** KPIs with a light. */
  counted: number;
  total: number;
}

/** The average of the KPIs that have a light, each counting the same; null with none. */
export function overallHealth(kpis: readonly HealthKpi[]): OverallHealth {
  const lit = kpis.filter((k) => k.status !== null);
  if (lit.length === 0) return { score: null, status: null, counted: 0, total: kpis.length };
  const sum = lit.reduce((a, k) => a + POINTS[k.status as TrafficStatus], 0);
  const score = Math.round((sum / (lit.length * 2)) * 100);
  const status: TrafficStatus =
    score >= OVERALL_CUTS.green ? "green" : score >= OVERALL_CUTS.amber ? "amber" : "red";
  return { score, status, counted: lit.length, total: kpis.length };
}
