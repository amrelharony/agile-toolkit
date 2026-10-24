/**
 * Impediments: status, age, due dates and order, shared by the Impediments
 * page, the cockpit, hand-offs and the tool.impediments.* agent actions so
 * they all read an impediment the same way.
 *
 * `workspace.impediments` is the one store. Status is derived, never
 * stored: resolved when `resolvedAt` is set, escalated when `escalatedAt`
 * is, open otherwise. Dates are "YYYY-MM-DD"; a full ISO timestamp (an
 * agent's write) is read by its date.
 */

import type {
  Impediment,
  ImpedimentCategory,
  ImpedimentSeverity,
} from "@/lib/stores/workspace-types";

export type ImpedimentStatus = "open" | "escalated" | "resolved";

export const IMPEDIMENT_STATUSES: readonly ImpedimentStatus[] = ["open", "escalated", "resolved"];

export const IMPEDIMENT_STATUS_LABEL: Record<ImpedimentStatus, string> = {
  open: "Open",
  escalated: "Escalated",
  resolved: "Resolved",
};

/** Least to most severe. */
export const IMPEDIMENT_SEVERITIES: readonly ImpedimentSeverity[] = [
  "low",
  "medium",
  "high",
  "critical",
];

export const IMPEDIMENT_SEVERITY_LABEL: Record<ImpedimentSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const IMPEDIMENT_CATEGORIES: readonly ImpedimentCategory[] = [
  "technical",
  "organizational",
  "external",
  "process",
];

export const IMPEDIMENT_CATEGORY_LABEL: Record<ImpedimentCategory, string> = {
  technical: "Technical",
  organizational: "Organizational",
  external: "External",
  process: "Process",
};

const DAY_MS = 86_400_000;

/** The "YYYY-MM-DD" a date string starts with, or null. */
export function dayOf(value: string | undefined | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? m[0] : null;
}

function dayMs(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
}

/** `day` plus `n` calendar days. */
export function addDays(day: string, n: number): string {
  return new Date(dayMs(day) + n * DAY_MS).toISOString().slice(0, 10);
}

export function impedimentStatus(
  i: Pick<Impediment, "resolvedAt" | "escalatedAt">
): ImpedimentStatus {
  if (i.resolvedAt) return "resolved";
  if (i.escalatedAt) return "escalated";
  return "open";
}

export const isResolved = (i: Pick<Impediment, "resolvedAt">) => Boolean(i.resolvedAt);

/**
 * The impediment moved to `status` on `day`. Escalating and resolving keep
 * an earlier stamp; resolving keeps `escalatedAt`, so the history shows it
 * was escalated. Reopening clears both. Unchanged: the same object.
 */
export function withImpedimentStatus(
  i: Impediment,
  status: ImpedimentStatus,
  day: string
): Impediment {
  if (impedimentStatus(i) === status) return i;
  const { resolvedAt, escalatedAt, ...rest } = i;
  void resolvedAt;
  if (status === "open") return rest;
  if (status === "escalated") return { ...rest, escalatedAt: escalatedAt ?? day };
  return { ...rest, ...(escalatedAt ? { escalatedAt } : {}), resolvedAt: day };
}

/** The day it is due: `dueDate`, else raised plus the expected days, else null. */
export function impedimentDueDate(
  i: Pick<Impediment, "dueDate" | "raisedAt" | "expectedResolutionDays">
): string | null {
  const due = dayOf(i.dueDate);
  if (due) return due;
  const raised = dayOf(i.raisedAt);
  const days = i.expectedResolutionDays;
  if (!raised || typeof days !== "number" || !Number.isFinite(days) || days < 0) return null;
  return addDays(raised, Math.round(days));
}

/** Days from raised to resolved, or to `today` while unresolved. Null on a bad date. */
export function impedimentAgeDays(
  i: Pick<Impediment, "raisedAt" | "resolvedAt">,
  today: string
): number | null {
  const raised = dayOf(i.raisedAt);
  const end = dayOf(i.resolvedAt) ?? dayOf(today);
  if (!raised || !end) return null;
  return Math.max(0, daysBetween(raised, end));
}

/** Days past its due date while unresolved (0 when not overdue or no due date). */
export function daysOverdue(i: Impediment, today: string): number {
  if (isResolved(i)) return 0;
  const due = impedimentDueDate(i);
  const now = dayOf(today);
  if (!due || !now) return 0;
  return Math.max(0, daysBetween(due, now));
}

export const isImpedimentOverdue = (i: Impediment, today: string) => daysOverdue(i, today) > 0;

const STATUS_RANK: Record<ImpedimentStatus, number> = { escalated: 0, open: 1, resolved: 2 };

/**
 * Escalated first, then open, then resolved. Unresolved ones: overdue
 * first, then most severe, then oldest. Resolved ones: latest first.
 */
export function compareImpediments(a: Impediment, b: Impediment, today: string): number {
  const sa = impedimentStatus(a);
  const sb = impedimentStatus(b);
  if (sa !== sb) return STATUS_RANK[sa] - STATUS_RANK[sb];
  if (sa === "resolved")
    return (dayOf(b.resolvedAt) ?? "").localeCompare(dayOf(a.resolvedAt) ?? "");
  const overdue = Number(isImpedimentOverdue(b, today)) - Number(isImpedimentOverdue(a, today));
  if (overdue) return overdue;
  const severity =
    IMPEDIMENT_SEVERITIES.indexOf(b.severity) - IMPEDIMENT_SEVERITIES.indexOf(a.severity);
  if (severity) return severity;
  return (dayOf(a.raisedAt) ?? "").localeCompare(dayOf(b.raisedAt) ?? "");
}

export function sortImpediments(list: readonly Impediment[], today: string): Impediment[] {
  return [...list].sort((a, b) => compareImpediments(a, b, today));
}

/** Whether it was in the way at some point from `start` to `end` (both days, inclusive). */
export function openDuring(
  i: Pick<Impediment, "raisedAt" | "resolvedAt">,
  start: string,
  end: string
): boolean {
  const raised = dayOf(i.raisedAt);
  if (!raised || raised > end) return false;
  const resolved = dayOf(i.resolvedAt);
  return !resolved || resolved >= start;
}

export interface ImpedimentSummary {
  total: number;
  open: number;
  escalated: number;
  resolved: number;
  /** Unresolved and past due. */
  overdue: number;
  /** Unresolved critical ones. */
  critical: number;
  /** Mean days from raised to resolved; null with nothing resolved. */
  avgResolutionDays: number | null;
  /** Age of the oldest unresolved one; null with none. */
  oldestOpenDays: number | null;
}

export function impedimentSummary(list: readonly Impediment[], today: string): ImpedimentSummary {
  const s: ImpedimentSummary = {
    total: list.length,
    open: 0,
    escalated: 0,
    resolved: 0,
    overdue: 0,
    critical: 0,
    avgResolutionDays: null,
    oldestOpenDays: null,
  };
  let resolvedDays = 0;
  let resolvedCount = 0;
  for (const i of list) {
    const status = impedimentStatus(i);
    s[status]++;
    const age = impedimentAgeDays(i, today);
    if (status === "resolved") {
      if (age !== null) {
        resolvedDays += age;
        resolvedCount++;
      }
      continue;
    }
    if (i.severity === "critical") s.critical++;
    if (isImpedimentOverdue(i, today)) s.overdue++;
    if (age !== null && (s.oldestOpenDays === null || age > s.oldestOpenDays))
      s.oldestOpenDays = age;
  }
  if (resolvedCount > 0) s.avgResolutionDays = Math.round((resolvedDays / resolvedCount) * 10) / 10;
  return s;
}

/* ── The Impediments tool's old local rows ─────────────────────────────── */

const LEGACY_SEVERITY: Record<string, ImpedimentSeverity> = {
  Low: "low",
  Medium: "medium",
  High: "high",
  Critical: "critical",
};

const LEGACY_CATEGORY: Record<string, ImpedimentCategory> = {
  Technical: "technical",
  Organizational: "organizational",
  External: "external",
  Process: "process",
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * A row of the tool's old local store (`agile-toolkit:impediments`) as a
 * workspace impediment, or null when it can't be read. The old store kept
 * no escalation date, so an escalated row counts as escalated from the day
 * it was raised.
 */
export function fromLegacyImpediment(raw: unknown): Impediment | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const title = str(r.title);
  const raisedAt = dayOf(str(r.raisedDate));
  if (!id || !title || !raisedAt) return null;
  const status = str(r.status);
  const resolvedAt = status === "Resolved" ? (dayOf(str(r.resolvedDate)) ?? raisedAt) : null;
  const description = str(r.description);
  const raisedBy = str(r.raisedBy);
  const owner = str(r.assignedTo);
  const category = LEGACY_CATEGORY[str(r.category)];
  const days = r.expectedResolutionDays;
  const source = r.source === "standup" || r.source === "retro" ? r.source : "manual";
  const sourceRef =
    r.sourceRef && typeof r.sourceRef === "object"
      ? (r.sourceRef as Impediment["sourceRef"])
      : undefined;
  return {
    id,
    title,
    severity: LEGACY_SEVERITY[str(r.severity)] ?? "medium",
    raisedAt,
    ...(resolvedAt ? { resolvedAt } : {}),
    ...(status === "Escalated" ? { escalatedAt: raisedAt } : {}),
    ...(owner ? { owner } : {}),
    source,
    ...(sourceRef ? { sourceRef } : {}),
    ...(description ? { description } : {}),
    ...(category ? { category } : {}),
    ...(raisedBy ? { raisedBy } : {}),
    ...(typeof days === "number" && Number.isFinite(days) && days >= 0
      ? { expectedResolutionDays: Math.round(days) }
      : {}),
  };
}

/**
 * `current` with the gaps filled from `legacy`: the fields it doesn't have.
 * What the workspace holds wins (the tool's bridge copied most of it there
 * already, and agents may have changed it since). An escalation only
 * fills in on an unresolved row.
 */
export function fillFromLegacy(current: Impediment, legacy: Impediment): Impediment {
  const out: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(legacy)) {
    if (out[key] !== undefined) continue;
    if (key === "escalatedAt" && current.resolvedAt) continue;
    out[key] = value;
  }
  return out as unknown as Impediment;
}
