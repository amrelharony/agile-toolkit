"use client";

import { useHistoryStore } from "./history-store";
import type { HistoryEvent } from "./types";

export interface EventQuery {
  toolId?: string;
  toolIds?: string[];
  action?: string;
  actions?: string[];
  sinceDays?: number;
  until?: string;          // ISO timestamp upper bound
  isMilestone?: boolean;
  limit?: number;
}

export interface CorrelationSummary {
  pairs: number;
  meanLagDays: number;
  withinLagCount: number;
}

// Lightweight indexes rebuilt only when the events array reference changes.
// Zustand uses structural sharing so this is rare in practice.
let lastEventsRef: HistoryEvent[] | null = null;
let byTool: Map<string, HistoryEvent[]> = new Map();
let byAction: Map<string, HistoryEvent[]> = new Map();

function rebuildIndexes(events: HistoryEvent[]): void {
  if (events === lastEventsRef) return;
  lastEventsRef = events;
  byTool = new Map();
  byAction = new Map();
  for (const e of events) {
    let t = byTool.get(e.toolId);
    if (!t) { t = []; byTool.set(e.toolId, t); }
    t.push(e);

    const actionKey = `${e.toolId}:${e.action}`;
    let a = byAction.get(actionKey);
    if (!a) { a = []; byAction.set(actionKey, a); }
    a.push(e);
  }
}

function getEvents(): HistoryEvent[] {
  // Read from store at call time; selectors stay reactive when callers
  // wrap them in useMemo([events]).
  const state = useHistoryStore.getState();
  // The store may expose events under different field names depending on
  // its evolution. Try common shapes; fall back to empty array.
  const events: HistoryEvent[] =
    (state as unknown as { events?: HistoryEvent[]; entries?: HistoryEvent[] }).events
    ?? (state as unknown as { events?: HistoryEvent[]; entries?: HistoryEvent[] }).entries
    ?? [];
  rebuildIndexes(events);
  return events;
}

/**
 * Filter events by tool, action, time window, severity. Returns most-recent
 * first. Limit defaults to 1000 to avoid pathological iterations.
 */
export function selectEvents(opts: EventQuery): HistoryEvent[] {
  const all = getEvents();
  const limit = opts.limit ?? 1000;
  const toolSet = opts.toolIds ? new Set(opts.toolIds) : opts.toolId ? new Set([opts.toolId]) : null;
  const actionSet = opts.actions ? new Set(opts.actions) : opts.action ? new Set([opts.action]) : null;
  const sinceMs = opts.sinceDays ? Date.now() - opts.sinceDays * 86_400_000 : -Infinity;
  const untilMs = opts.until ? new Date(opts.until).getTime() : Infinity;

  const out: HistoryEvent[] = [];
  // Walk from end (most recent) backwards.
  for (let i = all.length - 1; i >= 0 && out.length < limit; i--) {
    const e = all[i];
    if (toolSet && !toolSet.has(e.toolId)) continue;
    if (actionSet && !actionSet.has(e.action)) continue;
    if (opts.isMilestone !== undefined && Boolean(e.isMilestone) !== opts.isMilestone) continue;
    const ts = new Date(e.occurredAt).getTime();
    if (!Number.isFinite(ts) || ts < sinceMs || ts > untilMs) continue;
    out.push(e);
  }
  return out;
}

/**
 * Daily counts of an action over the last `days`. Returns dense series
 * (zero-filled) ordered ascending by date.
 */
export function eventCountByDay(toolId: string, action: string, days: number): { date: string; count: number }[] {
  const events = selectEvents({ toolId, action, sinceDays: days });
  const counts = new Map<string, number>();
  for (const e of events) {
    const day = e.occurredAt.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  // Build dense series.
  const out: { date: string; count: number }[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return out;
}

/** Most-recent occurrence of a specific action. */
export function lastEventOf(toolId: string, action: string): HistoryEvent | undefined {
  return selectEvents({ toolId, action, limit: 1 })[0];
}

/**
 * Count overlapping events between two streams within a fixed lag window.
 * Used by causal annotation logic — for each event in A, check if any
 * event in B occurred within ±lagDays.
 */
export function correlateEventStreams(a: EventQuery, b: EventQuery, lagDays: number): CorrelationSummary {
  const aEvents = selectEvents(a);
  const bEvents = selectEvents(b);
  if (aEvents.length === 0 || bEvents.length === 0) {
    return { pairs: 0, meanLagDays: 0, withinLagCount: 0 };
  }
  const bTimes = bEvents.map((e) => new Date(e.occurredAt).getTime());
  const lagMs = lagDays * 86_400_000;
  let pairs = 0;
  let lagSum = 0;
  let withinLag = 0;
  for (const e of aEvents) {
    const t = new Date(e.occurredAt).getTime();
    let bestLag = Infinity;
    for (const bt of bTimes) {
      const diff = Math.abs(t - bt);
      if (diff < bestLag) bestLag = diff;
    }
    if (bestLag !== Infinity) {
      pairs++;
      lagSum += bestLag;
      if (bestLag <= lagMs) withinLag++;
    }
  }
  return {
    pairs,
    meanLagDays: pairs === 0 ? 0 : lagSum / pairs / 86_400_000,
    withinLagCount: withinLag,
  };
}
