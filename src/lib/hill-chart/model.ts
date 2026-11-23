/**
 * Hill Chart's pure model, server-safe: where a scope sits on the hill
 * (uphill while the team is still working it out, downhill once it only
 * needs doing, done at the bottom on the right), the weekly check-ins and
 * what moved since one, the stuck rule, a linked story that disagrees, and
 * the page's next steps. The page, Amr's verbs and the next-step rule all
 * read it, so they agree. Pure: no store, no React, no "use client" module.
 */

import {
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type HandoffLink,
  type HillChart,
  type HillCheckIn,
  type HillScope,
  type Story,
} from "@/lib/stores/workspace-types";
import type { HandoffSource } from "@/lib/handoffs/types";
import type { NextStep } from "@/lib/tools/next-steps";
import { isExampleId } from "@/lib/utils/example-id";

/** Every hill chart's id starts with this (the workspace.hill_chart CRUD's). */
export const HILL_CHART_ID_PREFIX = "hill_";
/** A scope's id, as the page and the verbs mint them. */
export const HILL_SCOPE_ID_PREFIX = "hscope_";
/** A check-in's id. */
export const HILL_CHECK_IN_ID_PREFIX = "hcheck_";

/** The top of the hill: below it a scope is still being worked out. */
export const HILL_TOP = 50;
/** The bottom on the right: done. */
export const HILL_DONE = 100;
/** An uphill scope that hasn't moved for this many days is stuck. */
export const STUCK_DAYS = 7;
/** A chart with no check-in for this many days asks for one. */
export const CHECK_IN_DAYS = 7;
/** The check-ins the Markdown lists, newest first. */
export const MARKDOWN_CHECK_INS = 12;

export type HillSide = "uphill" | "downhill" | "done";

/** The hill's two halves, in our own words, and the bottom on the right. */
export const SIDE_LABEL: Record<HillSide, string> = {
  uphill: "Still working it out",
  downhill: "Getting it done",
  done: "Done",
};

/** A side as one word, for a dot's spoken value ("30, uphill"). */
export const SIDE_WORD: Record<HillSide, string> = {
  uphill: "uphill",
  downhill: "downhill",
  done: "done",
};

/**
 * How high the hill is at `x` (0 to 1 across): 0 at both feet, 1 at the
 * top in the middle. A smooth bump, (1 − cos 2πx) / 2.
 */
export function hillY(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return (1 - Math.cos(2 * Math.PI * t)) / 2;
}

/** A position as stored: a whole number from 0 to 100 (anything else clamped, NaN 0). */
export function clampPosition(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(Math.min(HILL_DONE, Math.max(0, v)));
}

/** Under 50 uphill, 50 to 99 downhill, 100 done. */
export function sideOf(position: number): HillSide {
  if (position >= HILL_DONE) return "done";
  return position < HILL_TOP ? "uphill" : "downhill";
}

/** What a dot says: "Payment API: 30, uphill". */
export function positionText(title: string, position: number): string {
  return `${title}: ${position}, ${SIDE_WORD[sideOf(position)]}`;
}

/** A time's local day, YYYY-MM-DD. */
export function localDay(at: string | Date): string {
  const d = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return "";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Whole days from `fromIso` to `now`, counted by local day; 0 for a bad or future time. */
export function daysSince(fromIso: string | undefined, now: Date): number {
  if (!fromIso) return 0;
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return 0;
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Days since a scope last moved (capped at 3,650, what the AI input takes). */
export function daysSinceMove(scope: Pick<HillScope, "movedAt">, now: Date): number {
  return Math.min(3650, daysSince(scope.movedAt, now));
}

/** When a scope last moved, in words: "today", "1 day ago", "9 days ago". */
export const movedAgoText = (days: number): string =>
  days === 0 ? "today" : `${days} ${days === 1 ? "day" : "days"} ago`;

/** Uphill and not moved for STUCK_DAYS or more. */
export function isStuck(scope: Pick<HillScope, "position" | "movedAt">, now: Date): boolean {
  return sideOf(scope.position) === "uphill" && daysSinceMove(scope, now) >= STUCK_DAYS;
}

/** The chart's stuck scopes, longest unmoved first. */
export function stuckScopes(chart: Pick<HillChart, "scopes">, now: Date): HillScope[] {
  return chart.scopes
    .filter((s) => isStuck(s, now))
    .sort((a, b) => daysSinceMove(b, now) - daysSinceMove(a, now));
}

/** The newest check-in, or undefined with none. */
export function lastCheckIn(chart: Pick<HillChart, "checkIns">): HillCheckIn | undefined {
  return chart.checkIns.reduce<HillCheckIn | undefined>(
    (best, c) => (!best || c.at > best.at ? c : best),
    undefined
  );
}

/** The check-ins, newest first. */
export function checkInsNewestFirst(chart: Pick<HillChart, "checkIns">): HillCheckIn[] {
  return [...chart.checkIns].sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Save today's positions with a note: one check-in per local day (a second
 * the same day replaces the first, keeping its id), every scope on the
 * chart as it stands, the oldest dropped past TOOL_LIST_MAX.hillCheckIns.
 */
export function checkIn(
  chart: HillChart,
  now: Date,
  note?: string,
  id: string = `${HILL_CHECK_IN_ID_PREFIX}${now.getTime().toString(36)}`
): HillChart {
  const day = localDay(now);
  const same = chart.checkIns.find((c) => localDay(c.at) === day);
  const text = (note ?? "").trim().slice(0, TOOL_TEXT_MAX.capture);
  const entry: HillCheckIn = {
    id: same?.id ?? id,
    at: now.toISOString(),
    positions: chart.scopes
      .slice(0, TOOL_LIST_MAX.hillScopes)
      .map((s) => ({ scopeId: s.id, position: clampPosition(s.position) })),
    ...(text ? { note: text } : {}),
  };
  const rest = chart.checkIns.filter((c) => c !== same);
  const all = [...rest, entry].sort((a, b) => a.at.localeCompare(b.at));
  return { ...chart, checkIns: all.slice(-TOOL_LIST_MAX.hillCheckIns) };
}

export type MoveDirection = "forward" | "back" | "unmoved" | "new";

/** How one scope moved since a check-in. */
export interface ScopeMovement {
  scopeId: string;
  title: string;
  /** Its position at the check-in; null when it wasn't on the chart then. */
  from: number | null;
  to: number;
  direction: MoveDirection;
}

/**
 * Each scope now against a check-in: forward (further along), back, not
 * moved, or new since. Ids of scopes removed since are ignored. With no
 * check-in, every scope is new.
 */
export function movement(
  chart: Pick<HillChart, "scopes">,
  since: HillCheckIn | undefined
): ScopeMovement[] {
  const before = new Map((since?.positions ?? []).map((p) => [p.scopeId, p.position]));
  return chart.scopes.map((s) => {
    const from = before.has(s.id) ? (before.get(s.id) as number) : null;
    const direction: MoveDirection =
      from === null
        ? "new"
        : s.position > from
          ? "forward"
          : s.position < from
            ? "back"
            : "unmoved";
    return { scopeId: s.id, title: s.title, from, to: s.position, direction };
  });
}

/** The words for a movement: "forward 20", "back 10", "not moved", "new". */
export function movementText(m: ScopeMovement): string {
  if (m.direction === "new" || m.from === null) return "new since then";
  if (m.direction === "unmoved") return "not moved";
  const by = Math.abs(m.to - m.from);
  return `${m.direction === "forward" ? "forward" : "back"} ${by}`;
}

export type ScopeMismatch = "story-done-uphill" | "scope-done-story-open";

/**
 * A linked story that disagrees with its scope: done while the scope is
 * still uphill, or open while the scope is at the bottom (done).
 */
export function scopeMismatch(
  scope: Pick<HillScope, "position">,
  story: Pick<Story, "status"> | undefined
): ScopeMismatch | null {
  if (!story) return null;
  const side = sideOf(scope.position);
  if (story.status === "done" && side === "uphill") return "story-done-uphill";
  if (story.status !== "done" && side === "done") return "scope-done-story-open";
  return null;
}

/** What "Check" says about a mismatch. */
export const MISMATCH_TEXT: Record<ScopeMismatch, string> = {
  "story-done-uphill": "Its story is done, but the scope is still uphill.",
  "scope-done-story-open": "The scope is done, but its story is still open.",
};

/**
 * The chart with one scope moved to `position`: `movedAt` stamped when the
 * position changes, `doneAt` set on reaching 100 and cleared below it.
 * Unchanged (same reference) when the position is the same or the scope is
 * gone.
 */
export function moveScope(
  chart: HillChart,
  scopeId: string,
  position: number,
  at: string
): HillChart {
  const to = clampPosition(position);
  const scope = chart.scopes.find((s) => s.id === scopeId);
  if (!scope || scope.position === to) return chart;
  const next: HillScope = { ...scope, position: to, movedAt: at };
  if (to >= HILL_DONE) next.doneAt = scope.doneAt ?? at;
  else delete next.doneAt;
  return { ...chart, scopes: chart.scopes.map((s) => (s.id === scopeId ? next : s)) };
}

/** Whether a move took the scope to the bottom of the hill (done), from above it. */
export const reachedDone = (from: number, to: number) => from < HILL_DONE && to >= HILL_DONE;

/** What the page and the verbs ask for a new scope. */
export interface ScopeValues {
  title: string;
  position: number;
  storyId?: string;
  epicId?: string;
  note?: string;
}

/** A new scope at its starting position, moved now. */
export function newScope(values: ScopeValues, id: string, at: string): HillScope {
  const position = clampPosition(values.position);
  const note = (values.note ?? "").trim().slice(0, TOOL_TEXT_MAX.capture);
  return {
    id,
    title: values.title.trim().slice(0, TOOL_TEXT_MAX.short),
    position,
    movedAt: at,
    ...(values.storyId ? { storyId: values.storyId } : {}),
    ...(values.epicId ? { epicId: values.epicId } : {}),
    ...(note ? { note } : {}),
    ...(position >= HILL_DONE ? { doneAt: at } : {}),
  };
}

/** Whether a chart has room for another scope. */
export const hasRoomForScope = (chart: Pick<HillChart, "scopes">) =>
  chart.scopes.length < TOOL_LIST_MAX.hillScopes;

/* ── Reading stored rows ──────────────────────────────────────────────── */

const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t.slice(0, max);
};
const time = (v: unknown): string | undefined =>
  typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : undefined;

function readLinks(raw: unknown): HandoffLink[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const links = raw.filter(
    (l): l is HandoffLink =>
      !!l &&
      typeof l === "object" &&
      typeof (l as HandoffLink).route === "string" &&
      typeof (l as HandoffLink).targetId === "string" &&
      typeof (l as HandoffLink).at === "string"
  );
  return links.length > 0 ? links : undefined;
}

function readScope(raw: unknown, fallbackAt: string): HillScope | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 64);
  const title = str(r.title, TOOL_TEXT_MAX.short);
  if (!id || !title) return null;
  const position = clampPosition(r.position);
  const storyId = str(r.storyId, TOOL_TEXT_MAX.short);
  const epicId = str(r.epicId, TOOL_TEXT_MAX.short);
  const note = str(r.note, TOOL_TEXT_MAX.capture);
  const doneAt = time(r.doneAt);
  const sentTo = readLinks(r.sentTo);
  return {
    id,
    title,
    position,
    movedAt: time(r.movedAt) ?? fallbackAt,
    ...(storyId ? { storyId } : {}),
    ...(epicId ? { epicId } : {}),
    ...(note ? { note } : {}),
    ...(doneAt && position >= HILL_DONE ? { doneAt } : {}),
    ...(sentTo ? { sentTo } : {}),
  };
}

function readCheckIn(raw: unknown): HillCheckIn | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 64);
  const at = time(r.at);
  if (!id || !at) return null;
  const positions = (Array.isArray(r.positions) ? r.positions : [])
    .filter(
      (p): p is { scopeId: string; position: unknown } =>
        !!p && typeof p === "object" && typeof (p as { scopeId?: unknown }).scopeId === "string"
    )
    .slice(0, TOOL_LIST_MAX.hillScopes)
    .map((p) => ({ scopeId: p.scopeId, position: clampPosition(p.position) }));
  const note = str(r.note, TOOL_TEXT_MAX.capture);
  return { id, at, positions, ...(note ? { note } : {}) };
}

/**
 * One stored chart as the page reads it, or null when it can't be read (no
 * id or title): positions clamped to whole numbers, scopes and check-ins
 * capped (the oldest check-ins dropped), unreadable entries left out.
 */
export function readHillChart(raw: unknown): HillChart | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 200);
  const title = str(r.title, TOOL_TEXT_MAX.short);
  if (!id || !title) return null;
  const createdAt = time(r.createdAt) ?? new Date(0).toISOString();
  const scopes = (Array.isArray(r.scopes) ? r.scopes : [])
    .map((s) => readScope(s, createdAt))
    .filter((s): s is HillScope => s !== null)
    .slice(0, TOOL_LIST_MAX.hillScopes);
  const checkIns = (Array.isArray(r.checkIns) ? r.checkIns : [])
    .map(readCheckIn)
    .filter((c): c is HillCheckIn => c !== null)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-TOOL_LIST_MAX.hillCheckIns);
  const about = str(r.about, TOOL_TEXT_MAX.text);
  const sprintId = str(r.sprintId, TOOL_TEXT_MAX.short);
  const epicId = str(r.epicId, TOOL_TEXT_MAX.short);
  return {
    id,
    title,
    scopes,
    checkIns,
    createdAt,
    updatedAt: time(r.updatedAt) ?? createdAt,
    ...(about ? { about } : {}),
    ...(sprintId ? { sprintId } : {}),
    ...(epicId ? { epicId } : {}),
    ...(r.archived === true ? { archived: true } : {}),
  };
}

/** Every readable chart, newest first. */
export function readHillCharts(raw: readonly unknown[] | undefined): HillChart[] {
  return (raw ?? [])
    .map(readHillChart)
    .filter((c): c is HillChart => c !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The team's own charts still in use: not archived, not the example's. */
export const activeCharts = (charts: readonly HillChart[]) =>
  charts.filter((c) => !c.archived && !isExampleId(c.id));

/** How many scopes are past the top of the hill (downhill or done). */
export const overTheHill = (chart: Pick<HillChart, "scopes">) =>
  chart.scopes.filter((s) => sideOf(s.position) !== "uphill").length;

/** A chart's page link. */
export const chartHref = (id: string) => `/hill-chart?chart=${encodeURIComponent(id)}`;

/**
 * What "Raise as an impediment" hands over for a stuck scope: its title,
 * how long it has sat uphill on which chart, its note, and where it lives
 * (the scope, on its chart), so the impediment links back.
 */
export function scopeSource(
  chart: Pick<HillChart, "id" | "title">,
  scope: Pick<HillScope, "id" | "title" | "note" | "movedAt">,
  now: Date
): HandoffSource {
  const days = daysSinceMove(scope, now);
  const note = (scope.note ?? "").trim();
  return {
    title: scope.title,
    description: [
      `Stuck on the uphill side of the hill chart “${chart.title}”: it hasn't moved for ${days} ${
        days === 1 ? "day" : "days"
      }.`,
      note,
    ]
      .filter(Boolean)
      .join("\n"),
    sourceRef: { tool: "hill-chart", id: scope.id, doc: chart.id },
  };
}

/* ── Next steps ──────────────────────────────────────────────────────── */

/** What the rule reads from the workspace. */
export interface HillChartStepsInput {
  charts: readonly HillChart[] | undefined;
}

const quoted = (text: string, max = 60) => {
  const t = text.trim();
  return `“${t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t}”`;
};

/**
 * Hill Chart's next steps, given the time now: ask about the longest-stuck
 * scope, then check in on a chart that hasn't had one for a week. The
 * team's own charts only (examples and archived charts aside).
 */
export function hillChartSteps(s: HillChartStepsInput, now: Date): NextStep[] {
  const charts = activeCharts(readHillCharts(s.charts));
  const steps: NextStep[] = [];
  const stuck = charts
    .flatMap((c) => stuckScopes(c, now).map((scope) => ({ chart: c, scope })))
    .sort((a, b) => daysSinceMove(b.scope, now) - daysSinceMove(a.scope, now))[0];
  if (stuck) {
    const days = daysSinceMove(stuck.scope, now);
    steps.push({
      id: "hill-chart-stuck",
      label: `Ask what is holding ${quoted(stuck.scope.title)} on the uphill side`,
      detail: `It hasn't moved for ${days} days on ${quoted(stuck.chart.title)}.`,
      href: chartHref(stuck.chart.id),
    });
  }
  const due = charts
    .filter((c) => c.scopes.length > 0)
    .map((c) => ({ chart: c, days: daysSince(lastCheckIn(c)?.at ?? c.createdAt, now) }))
    .filter((x) => x.days >= CHECK_IN_DAYS)
    .sort((a, b) => b.days - a.days)[0];
  if (due) {
    const last = lastCheckIn(due.chart);
    steps.push({
      id: "hill-chart-check-in",
      label: `Check in on ${quoted(due.chart.title)}`,
      detail: last
        ? `The last check-in was ${due.days} days ago.`
        : `It has had no check-in in ${due.days} days.`,
      href: chartHref(due.chart.id),
    });
  }
  return steps;
}
