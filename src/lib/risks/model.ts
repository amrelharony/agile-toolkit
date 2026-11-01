/**
 * Risk Register: one reading of a risk for the page, the "risk" hand-off,
 * next steps, dashboards and the tool.risk_register.* agent actions, so a
 * score, a level, "overdue" and "high" mean the same everywhere.
 *
 * workspace.risks is the one store since Phase 8 (the old page blob moves
 * in through ./legacy-register). Ratings are 1–5; a stored value off the
 * scale (an old blob row, a loose agent write before Phase 8) is read
 * rounded and clamped, and one that isn't a number at all as 1, as the old
 * page scored it. Days are "YYYY-MM-DD"; a timestamp is read by its date.
 *
 * Pure and server-safe: only types, lib/utils/example-id, the sprint
 * calendar and cadence helpers and lib/analytics' sample sizes and
 * survival curve, so the agent actions can run it inside the MCP route
 * handler.
 */

import type {
  HandoffLink,
  HandoffRef,
  ImpedimentSeverity,
  Risk,
  RiskScale,
} from "@/lib/stores/workspace-types";
import { HANDOFF_ROUTE_IDS } from "@/lib/stores/workspace-types";
import type { HandoffSource } from "@/lib/handoffs/types";
import { enoughData } from "@/lib/analytics/min-sample";
import { kaplanMeier, medianSurvivalTime } from "@/lib/analytics/survival";
import { isExampleId } from "@/lib/utils/example-id";
import { isIsoDate, isoDayNumber } from "@/lib/sprints/calendar";
import { DEFAULT_CADENCE } from "@/lib/sprints/cadence";

export type RiskLevel = "low" | "medium" | "high" | "critical";

/** Least to most severe. */
export const RISK_LEVELS: readonly RiskLevel[] = ["low", "medium", "high", "critical"];

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

/** The lifecycle, in order: what the register's status select offers. */
export const RISK_STATUSES = ["open", "mitigating", "accepted", "closed"] as const;

export const RISK_STATUS_LABEL: Record<Risk["status"], string> = {
  open: "Open",
  mitigating: "Mitigating",
  accepted: "Accepted",
  closed: "Closed",
};

/** Later in the lifecycle ranks higher; the move keeps the later of two copies. */
export const RISK_STATUS_RANK: Readonly<Record<Risk["status"], number>> = {
  open: 0,
  mitigating: 1,
  accepted: 2,
  closed: 3,
};

/** A risk raised as an impediment keeps its level as the impediment's severity. */
export const RISK_LEVEL_SEVERITY: Readonly<Record<RiskLevel, ImpedimentSeverity>> = {
  low: "low",
  medium: "medium",
  high: "high",
  critical: "critical",
};

/** The longest title the register's form, the hand-off and the agent verbs save. */
export const RISK_TITLE_MAX = 240;
/** The longest description or mitigation plan. */
export const RISK_TEXT_MAX = 4000;
/** The longest owner name (the roster's own cap). */
export const RISK_OWNER_MAX = 120;

const isStatus = (v: unknown): v is Risk["status"] =>
  typeof v === "string" && (RISK_STATUSES as readonly string[]).includes(v);

/* ── Ratings and score ─────────────────────────────────────────────────── */

/**
 * A 1–5 rating: a number (or numeric text) rounded and clamped into the
 * scale, or null when it isn't a finite number (absent, blank, NaN).
 */
export function toScale(v: unknown): RiskScale | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(5, Math.round(n))) as RiskScale;
}

/** A stored rating as the register scores it: on the scale, and 1 when it isn't a number (as the old page read it). */
const scaleOf = (v: unknown): RiskScale => toScale(v) ?? 1;

/**
 * A rating pair as scored: a stored risk's, or a hypothetical one (the
 * agent's compute_risk_score), any number read on the scale.
 */
export type RatedRisk = { probability: number; impact: number };

/** Probability × impact, 1–25, each rating read on the 1–5 scale. */
export function riskScore(r: RatedRisk): number {
  return scaleOf(r.probability) * scaleOf(r.impact);
}

/** The register's bands: 16 and up critical, 10 high, 5 medium, else low. */
export function riskLevel(score: number): RiskLevel {
  if (score >= 16) return "critical";
  if (score >= 10) return "high";
  if (score >= 5) return "medium";
  return "low";
}

/** A risk's level from its current rating. */
export const riskLevelOf = (r: RatedRisk): RiskLevel => riskLevel(riskScore(r));

/**
 * The one meaning of a "high" risk across the toolkit (the register's KPI,
 * the health dashboard, the risk-stacking anti-pattern): high or critical.
 */
export const isHighLevel = (level: RiskLevel): boolean => level === "high" || level === "critical";

/** Whether the risk's current rating is high or critical (its status aside). */
export const isHighRisk = (r: RatedRisk): boolean => isHighLevel(riskLevelOf(r));

/**
 * The rating once the mitigation has worked, residual probability ×
 * residual impact, or null while it hasn't been assessed (both are needed:
 * one alone is never read as a rating).
 */
export function residualScore(
  r: Pick<Risk, "residualProbability" | "residualImpact">
): number | null {
  const p = toScale(r.residualProbability);
  const i = toScale(r.residualImpact);
  return p === null || i === null ? null : p * i;
}

/**
 * Whether the rating after mitigation is worse than the current one: the
 * page and the agent warn (never refuse), since a plan can make a risk
 * likelier for a while (a migration done in two steps).
 */
export function residualAboveCurrent(r: Risk): boolean {
  const after = residualScore(r);
  return after !== null && after > riskScore(r);
}

/* ── Lifecycle and dates ───────────────────────────────────────────────── */

/** Open or mitigating: on the matrix, counted as active, can be overdue. */
export const isActiveRisk = (r: Pick<Risk, "status">): boolean =>
  r.status === "open" || r.status === "mitigating";

/** The "YYYY-MM-DD" a stored date starts with when it is a real day, else undefined. */
function dayOf(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const day = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && isIsoDate(day) ? day : undefined;
}

/**
 * The day it was closed: resolvedAt only while the status is closed. A
 * reopened risk keeps the date it was first closed (the page shows it) but
 * reads as open in trends and the time-to-mitigate survival curve.
 */
export function closedOn(r: Pick<Risk, "status" | "resolvedAt">): string | undefined {
  return r.status === "closed" ? dayOf(r.resolvedAt) : undefined;
}

/**
 * Days its mitigation is past due: 0 unless the risk is active and has a
 * valid mitigationDueAt before `today`. Due today is not overdue.
 */
export function riskDaysOverdue(
  r: Pick<Risk, "status" | "mitigationDueAt">,
  today: string
): number {
  if (!isActiveRisk(r)) return 0;
  const due = isoDayNumber(dayOf(r.mitigationDueAt));
  const now = isoDayNumber(dayOf(today));
  if (due === null || now === null) return 0;
  return Math.max(0, now - due);
}

export const isRiskOverdue = (r: Pick<Risk, "status" | "mitigationDueAt">, today: string) =>
  riskDaysOverdue(r, today) > 0;

/** A sprint length the maths can divide by: a whole number of days from 1, else the cadence default (14). */
export function sprintLengthOr(len: unknown): number {
  return typeof len === "number" && Number.isInteger(len) && len >= 1
    ? len
    : DEFAULT_CADENCE.sprintLengthDays;
}

/**
 * Calendar days from the day it was raised to the day it closed (today
 * while it isn't closed); null when raisedAt isn't a day; never negative
 * (a raised day after today reads as 0).
 */
export function riskAgeDays(r: Pick<Risk, "raisedAt" | "status" | "resolvedAt">, today: string) {
  const from = isoDayNumber(dayOf(r.raisedAt));
  const to = isoDayNumber(closedOn(r) ?? dayOf(today));
  if (from === null || to === null) return null;
  return Math.max(0, to - from);
}

/**
 * Its age in whole sprints of the team's cadence (`sprintLengthDays`,
 * default 14): ⌊days ÷ length⌋, the page's "≈ N sprints (14-day sprints)";
 * null when raisedAt isn't a day.
 */
export function riskAgeSprints(
  r: Pick<Risk, "raisedAt" | "status" | "resolvedAt">,
  sprintLengthDays: number,
  today: string
): number | null {
  const days = riskAgeDays(r, today);
  return days === null ? null : Math.floor(days / sprintLengthOr(sprintLengthDays));
}

/**
 * The register's order: active risks (open, mitigating) before accepted
 * and closed ones, then the highest score, then the most days overdue,
 * then by title. Pure on the rows, so a stable-order hook can re-sort on
 * request without moving a row mid-edit.
 */
export function compareRisks(a: Risk, b: Risk, today: string): number {
  const active = Number(isActiveRisk(b)) - Number(isActiveRisk(a));
  if (active) return active;
  const score = riskScore(b) - riskScore(a);
  if (score) return score;
  const overdue = riskDaysOverdue(b, today) - riskDaysOverdue(a, today);
  if (overdue) return overdue;
  return (a.title ?? "").localeCompare(b.title ?? "");
}

/* ── Summary and verdict ───────────────────────────────────────────────── */

/**
 * Whether example rows count. Left out by default (the agent, the next
 * steps and the dashboards count the team's own); a page holding only its
 * example passes true to show the example's own numbers.
 */
export interface RiskCountOptions {
  includeExamples?: boolean;
}

export interface RiskSummary {
  /** Real risks (example rows are left out of every count here, unless included). */
  total: number;
  byStatus: Record<Risk["status"], number>;
  /** Active risks per level of their current rating (the matrix's set). */
  byLevel: Record<RiskLevel, number>;
  /** Open or mitigating. */
  active: number;
  /** Active and high or critical. */
  high: number;
  /** Active with a mitigation past due. */
  overdue: number;
  /** Active with no owner. */
  unowned: number;
  /** Σ score of the active risks. */
  exposure: number;
  /** Σ of each active risk's residual score, or its current score while not assessed. */
  residualExposure: number;
  /** Active risks with a residual rating. */
  residualAssessed: number;
}

const emptyByStatus = (): Record<Risk["status"], number> => ({
  open: 0,
  mitigating: 0,
  accepted: 0,
  closed: 0,
});

/** The register's numbers, examples left out unless included. A status outside the lifecycle (a hand-crafted row) counts in `total` only. */
export function riskSummary(
  risks: readonly Risk[],
  today: string,
  { includeExamples = false }: RiskCountOptions = {}
): RiskSummary {
  const s: RiskSummary = {
    total: 0,
    byStatus: emptyByStatus(),
    byLevel: { low: 0, medium: 0, high: 0, critical: 0 },
    active: 0,
    high: 0,
    overdue: 0,
    unowned: 0,
    exposure: 0,
    residualExposure: 0,
    residualAssessed: 0,
  };
  for (const r of risks) {
    if (!includeExamples && isExampleId(r.id)) continue;
    s.total += 1;
    if (isStatus(r.status)) s.byStatus[r.status] += 1;
    if (!isActiveRisk(r)) continue;
    const score = riskScore(r);
    const level = riskLevel(score);
    const after = residualScore(r);
    s.active += 1;
    s.byLevel[level] += 1;
    if (isHighLevel(level)) s.high += 1;
    if (isRiskOverdue(r, today)) s.overdue += 1;
    if (!r.owner?.trim()) s.unowned += 1;
    s.exposure += score;
    s.residualExposure += after ?? score;
    if (after !== null) s.residualAssessed += 1;
  }
  return s;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A title for a sentence: trimmed, one line, cut at 60. */
function quote(title: string): string {
  const t = (title ?? "").replace(/\s+/g, " ").trim() || "Untitled risk";
  return `“${t.length > 60 ? `${t.slice(0, 59).trimEnd()}…` : t}”`;
}

/**
 * Closed, but with no close day the register can read (closedOn is
 * undefined): when it stopped being open isn't known, so the weekly
 * series and the time to mitigate leave it out instead of counting it
 * open (or still waiting) up to today. Its row's "Closed on" takes one.
 */
export const isClosedUndated = (r: Pick<Risk, "status" | "resolvedAt">): boolean =>
  r.status === "closed" && closedOn(r) === undefined;

/**
 * One sentence on the register, examples left out unless included: overdue
 * mitigations lead (the longest overdue named), else the top active risk;
 * high or critical risks with no owner are called out.
 */
export function riskVerdict(
  risks: readonly Risk[],
  today: string,
  { includeExamples = false }: RiskCountOptions = {}
): string {
  const real = includeExamples ? risks : risks.filter((r) => !isExampleId(r.id));
  if (real.length === 0) return "No risks logged yet.";
  const s = riskSummary(real, today, { includeExamples });
  if (s.active === 0) {
    const parts = [
      s.byStatus.closed > 0 ? `${s.byStatus.closed} closed` : "",
      s.byStatus.accepted > 0 ? `${s.byStatus.accepted} accepted` : "",
    ].filter(Boolean);
    return `No active risks${parts.length > 0 ? `: ${parts.join(", ")}` : ""}.`;
  }
  const active = real.filter(isActiveRisk).sort((a, b) => compareRisks(a, b, today));
  const counts = `${plural(s.active, "active risk")}, ${s.high} high or critical`;
  const unownedHigh = active.filter((r) => isHighRisk(r) && !r.owner?.trim()).length;
  const owners =
    unownedHigh > 0
      ? `; ${plural(unownedHigh, "high or critical risk has", "high or critical risks have")} no owner`
      : "";
  if (s.overdue > 0) {
    const worst = active.reduce((w, r) =>
      riskDaysOverdue(r, today) > riskDaysOverdue(w, today) ? r : w
    );
    const days = riskDaysOverdue(worst, today);
    return `${plural(s.overdue, "mitigation is", "mitigations are")} overdue, ${quote(
      worst.title
    )} by ${plural(days, "day")}; ${counts}${owners}.`;
  }
  const top = active[0];
  const score = riskScore(top);
  return `${counts}; the top one, ${quote(top.title)}, scores ${score} (${riskLevel(
    score
  )})${owners}.`;
}

/* ── Time to close ─────────────────────────────────────────────────────── */

export interface RiskTimeToClose {
  /** Risks closed on a day the register can read (closedOn), raised on one too. */
  closed: number;
  /**
   * The Kaplan-Meier median days from raised to closed, open risks counted
   * as still waiting; null below MIN_SAMPLE.average closed risks, or while
   * fewer than half have closed.
   */
  medianDays: number | null;
}

/**
 * How long risks take to close, the register's "Median time to mitigate"
 * and tool.risk_register.list_state's timeToClose: days raised → closed
 * (riskAgeDays, closedOn), open and mitigating risks censored at today.
 * Accepted risks are left out: the team chose not to mitigate them; so is
 * a closed risk with no close day (isClosedUndated: closed through the
 * old generic CRUD, or an agent's write before Phase 8), whose duration isn't known:
 * counted as still waiting at today, it would stretch the median. Every
 * risk passed counts, so the caller leaves the examples out.
 */
export function riskTimeToClose(risks: readonly Risk[], today: string): RiskTimeToClose {
  const observations = risks.flatMap((r) => {
    if (r.status === "accepted" || isClosedUndated(r)) return [];
    const duration = riskAgeDays(r, today);
    return duration === null ? [] : [{ duration, event: closedOn(r) !== undefined }];
  });
  const closed = observations.filter((o) => o.event).length;
  return {
    closed,
    medianDays: enoughData(closed, "average")
      ? medianSurvivalTime(kaplanMeier(observations))
      : null,
  };
}

/* ── Hand-off ──────────────────────────────────────────────────────────── */

/** The newest link the risk was raised as an impediment through, if any. */
export function impedimentLinkOf(r: Pick<Risk, "sentTo">): HandoffLink | undefined {
  const links = (r.sentTo ?? []).filter((l) => l.route === "impediment");
  return links[links.length - 1];
}

/**
 * What "Raise as impediment" hands over: the title, the description with
 * the mitigation plan under it, the owner, the level as the impediment's
 * severity and the link back. The risk itself is left as it is (its
 * status doesn't change; the page offers to close it once the impediment
 * is resolved).
 */
export function riskImpedimentSource(r: Risk): HandoffSource {
  const description = (r.description ?? "").trim();
  const mitigation = (r.mitigation ?? "").trim();
  const text = [description, mitigation ? `Mitigation plan: ${mitigation}` : ""]
    .filter(Boolean)
    .join("\n\n");
  const owner = (r.owner ?? "").trim();
  return {
    title: r.title,
    ...(text ? { description: text } : {}),
    ...(owner ? { owner } : {}),
    severity: RISK_LEVEL_SEVERITY[riskLevelOf(r)],
    sourceRef: { tool: "risk-register", id: r.id },
  };
}

/* ── Reading a stored row ──────────────────────────────────────────────── */

function textOf(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function refOf(v: unknown): HandoffRef | undefined {
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r.tool !== "string" || !r.tool || typeof r.id !== "string" || !r.id) return undefined;
  return { tool: r.tool, id: r.id, ...(typeof r.doc === "string" && r.doc ? { doc: r.doc } : {}) };
}

/** The usable hand-off links in a stored list (known route, a target, a time), or undefined when there are none. */
export function linksOf(v: unknown): HandoffLink[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const links = v.flatMap((l): HandoffLink[] => {
    if (!l || typeof l !== "object") return [];
    const { route, targetId, at } = l as Record<string, unknown>;
    if (
      typeof route !== "string" ||
      !(HANDOFF_ROUTE_IDS as readonly string[]).includes(route) ||
      typeof targetId !== "string" ||
      !targetId ||
      typeof at !== "string"
    )
      return [];
    return [{ route: route as HandoffLink["route"], targetId, at }];
  });
  return links.length > 0 ? links : undefined;
}

/**
 * A stored risk in today's shape, or null when it can't be one (no id).
 * For the old register blob's rows: ratings on the 1–5 scale (one that
 * isn't a number reads as 1, as the old page scored it), a status outside
 * the lifecycle as open, dates read as their day (raisedAt "" when it
 * isn't one: unknown; a due or closed date that isn't one is dropped),
 * blank text dropped, and a residual rating kept only as a pair. Every
 * Phase 8 field carries over when present.
 */
export function normalizeRisk(raw: unknown): Risk | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id.trim() ? r.id : null;
  if (!id) return null;
  const mitigation = textOf(r.mitigation);
  const mitigationDueAt = dayOf(r.mitigationDueAt);
  const resolvedAt = dayOf(r.resolvedAt);
  const sourceRef = refOf(r.sourceRef);
  const owner = textOf(r.owner);
  const description = textOf(r.description);
  const rp = toScale(r.residualProbability);
  const ri = toScale(r.residualImpact);
  const sentTo = linksOf(r.sentTo);
  const updatedAt = textOf(r.updatedAt);
  return {
    id,
    title: typeof r.title === "string" ? r.title.trim() : "",
    probability: scaleOf(r.probability),
    impact: scaleOf(r.impact),
    ...(mitigation ? { mitigation } : {}),
    ...(mitigationDueAt ? { mitigationDueAt } : {}),
    status: isStatus(r.status) ? r.status : "open",
    raisedAt: dayOf(r.raisedAt) ?? "",
    ...(resolvedAt ? { resolvedAt } : {}),
    ...(sourceRef ? { sourceRef } : {}),
    ...(owner ? { owner } : {}),
    ...(description ? { description } : {}),
    ...(rp !== null && ri !== null ? { residualProbability: rp, residualImpact: ri } : {}),
    ...(sentTo ? { sentTo } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}
