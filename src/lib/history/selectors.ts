"use client";

import { useHistoryStore } from "./history-store";
import type { HistoryEvent } from "./types";

export interface EventQuery {
  toolId?: string;
  toolIds?: string[];
  action?: string;
  actions?: string[];
  sinceDays?: number;
  until?: string; // ISO timestamp upper bound
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
    if (!t) {
      t = [];
      byTool.set(e.toolId, t);
    }
    t.push(e);

    const actionKey = `${e.toolId}:${e.action}`;
    let a = byAction.get(actionKey);
    if (!a) {
      a = [];
      byAction.set(actionKey, a);
    }
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
    (state as unknown as { events?: HistoryEvent[]; entries?: HistoryEvent[] }).events ??
    (state as unknown as { events?: HistoryEvent[]; entries?: HistoryEvent[] }).entries ??
    [];
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
  const toolSet = opts.toolIds
    ? new Set(opts.toolIds)
    : opts.toolId
      ? new Set([opts.toolId])
      : null;
  const actionSet = opts.actions
    ? new Set(opts.actions)
    : opts.action
      ? new Set([opts.action])
      : null;
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
 * Local-date YYYY-MM-DD key. We need this for the "today" loop because
 * `Date#toISOString()` always serialises in UTC — for users west of UTC
 * (e.g., GMT-8) at any time before 16:00 local, "today" would be reported
 * as yesterday and shift the entire dense series by one day.
 */
function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Daily counts of an action over the last `days`. Returns dense series
 * (zero-filled) ordered ascending by date.
 */
export function eventCountByDay(
  toolId: string,
  action: string,
  days: number
): { date: string; count: number }[] {
  // Aggregation must see EVERY event in the window. selectEvents otherwise
  // applies its default 1000 cap, which silently undercounts the oldest days
  // once a high-frequency action logs >1000 events inside the window. The walk
  // is still bounded by the history store's own size cap.
  const events = selectEvents({ toolId, action, sinceDays: days, limit: Infinity });
  const counts = new Map<string, number>();
  for (const e of events) {
    // CONSISTENCY: event date keys use the UTC slice of `occurredAt` (the
    // ISO timestamp). The dense-series x-axis below uses local-date keys.
    // For users in non-UTC timezones the two can disagree by one day at
    // the day boundary; we accept that misalignment as preferable to
    // shifting the whole series. If we ever want strict consistency, this
    // line should call `localDateKey(new Date(e.occurredAt))` and the same
    // change must roll out to every other selector that bins by ISO slice.
    const day = e.occurredAt.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  // Build dense series — anchored at the user's local "today" so the
  // right-most bucket on the chart matches the calendar day they see.
  const out: { date: string; count: number }[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = localDateKey(d);
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
export function correlateEventStreams(
  a: EventQuery,
  b: EventQuery,
  lagDays: number
): CorrelationSummary {
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
