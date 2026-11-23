/**
 * Blockers: where the blocked time goes. Every blocked spell on a story or a
 * Flow-board card (lib/flow/blocks reads them) and every impediment raised
 * in a window becomes a row with a cluster ("Waiting for a review", "Another
 * team" …) and a side (inside the team or outside it), so the Impediments
 * page and its agent actions can rank the clusters on a Pareto chart, split
 * them inside against outside, and say how much blocked time costs the work
 * that finished.
 *
 * Rules:
 *   - one row per spell, with its blocked days inside the window (elapsed
 *     time, rounded to 0.1 when summed);
 *   - one row per impediment raised in the window. An impediment a spell
 *     was sent to (`spell.sentTo`, route `impediment`) is counted once,
 *     under its own cluster, else the spell's; the spell, in turn, takes the
 *     impediment's cluster when it has none of its own;
 *   - a row's side is its own (`spell.side`, `Impediment.blockSide`), else
 *     its default cluster's, else, for an impediment, `category: "external"`
 *     is outside; otherwise inside;
 *   - clusters rank by item-blocked days; with no blocked days in the window
 *     yet they rank by impediments raised, so the chart works on day one.
 *     Days an impediment stayed open are never ranked beside item days: one
 *     left open for 60 days would outrank dozens of item-days.
 *
 * Example rows are left out. Pure and server-safe (the agent actions call it).
 */

import { BLOCKER_CLUSTER_MAX } from "@/lib/stores/workspace-types";
import type { BlockSide, Impediment, KanbanCard, Story } from "@/lib/stores/workspace-types";
import { PARETO_CUTOFF, paretoRows } from "@/lib/root-cause/model";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { percentile } from "@/lib/sprints/metrics";
import { localDay } from "@/lib/sprints/series";
import { BLOCK_TRACKING_SINCE } from "@/lib/flow/block-stamps";
import {
  DAY_MS,
  blockedInCycle,
  dayStartMs,
  readSpells,
  untrackedBlock,
  type BlockRow,
} from "@/lib/flow/blocks";
import { isExampleId } from "@/lib/utils/example-id";
import { defaultClusterSide } from "./clusters";
import { dayOf, impedimentAgeDays, isResolved } from "./model";

/** The windows the page offers, in days. */
export const BLOCKER_WINDOWS = [30, 90, 180] as const;
/** Amr may also read a year. */
export const BLOCKER_DAYS = [30, 90, 180, 365] as const;
export type BlockerDays = (typeof BLOCKER_DAYS)[number];

/** A window of local days, both included, and the moment it is read at. */
export interface BlockerWindow {
  /** "YYYY-MM-DD". */
  from: string;
  /** "YYYY-MM-DD". */
  to: string;
  /** Now in ms (for spells still open). */
  now: number;
}

/** The last `days` local days up to `today`. */
export function lastDays(days: number, today: string, now: number): BlockerWindow {
  const [y, m, d] = today.split("-").map(Number);
  const from = new Date(y, m - 1, d - (days - 1));
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    from: `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`,
    to: today,
    now,
  };
}

/** One blocker: a blocked spell on a story or a card, or an impediment. */
export interface BlockerRow {
  /** Unique: "story:<id>:<from>", "card:<id>:<from>" or "impediment:<id>". */
  key: string;
  kind: "story" | "card" | "impediment";
  /** The story's, card's or impediment's id. */
  id: string;
  /** A spell's start, which identifies it on its row. */
  spellFrom?: string;
  /** The item's or impediment's title. */
  title: string;
  /** A spell's cause, or the start of an impediment's description. */
  cause?: string;
  /** Null: not clustered yet. */
  cluster: string | null;
  side: BlockSide;
  /** Blocked days inside the window (spells; 0 for impediments). */
  blockedDays: number;
  /** An impediment row: days from raised to resolved, or to today. */
  daysOpen: number | null;
  /** The impediment a spell was sent to, or the impediment itself. */
  impedimentId?: string;
  /** Still blocked (a spell running now), or an unresolved impediment. */
  open: boolean;
  /** "YYYY-MM": when the spell began or the impediment was raised. */
  month: string;
}

const real = (id: unknown) => typeof id === "string" && id !== "" && !isExampleId(id);

const IMPEDIMENT_ROUTE = "impediment";

function impedimentSide(i: Impediment, cluster: string | null): BlockSide {
  if (i.blockSide === "internal" || i.blockSide === "external") return i.blockSide;
  return defaultClusterSide(cluster) ?? (i.category === "external" ? "external" : "internal");
}

/** The impediment a spell was sent to, by its link. */
function linkedId(links: unknown): string | undefined {
  if (!Array.isArray(links)) return undefined;
  const link = links.find(
    (l) => l && typeof l === "object" && (l as { route?: unknown }).route === IMPEDIMENT_ROUTE
  ) as { targetId?: unknown } | undefined;
  return typeof link?.targetId === "string" ? link.targetId : undefined;
}

const textOf = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Every blocker in the window: one row per spell that was blocked inside it
 * (or began inside it), and one per impediment raised inside it.
 */
export function blockerRows(
  stories: readonly Story[],
  cards: readonly KanbanCard[],
  impediments: readonly Impediment[],
  window: BlockerWindow
): BlockerRow[] {
  const start = dayStartMs(window.from) ?? 0;
  const end = Math.min(window.now, (dayStartMs(window.to) ?? window.now) + DAY_MS);
  const range = { start, end };
  const impById = new Map<string, Impediment>();
  for (const i of impediments) if (i && real(i.id)) impById.set(i.id, i);
  const inWindow = (day: string | null) => day !== null && day >= window.from && day <= window.to;

  const out: BlockerRow[] = [];
  /** The spell cluster an impediment inherits, by impediment id (the first spell's). */
  const inherited = new Map<string, string>();
  const spellRows = (kind: "story" | "card", row: BlockRow & { title?: string }) => {
    for (const s of readSpells(row, window.now)) {
      const overlap = Math.max(0, Math.min(s.to, range.end) - Math.max(s.from, range.start));
      const begun = s.from >= range.start && s.from < range.end;
      if (overlap <= 0 && !begun) continue;
      const impedimentId = linkedId(s.spell.sentTo);
      const linked = impedimentId ? impById.get(impedimentId) : undefined;
      const cluster = s.spell.cluster ?? textOf(linked?.cluster) ?? null;
      const clusterOrNull = cluster ? cluster : null;
      if (linked && s.spell.cluster && !inherited.has(linked.id)) {
        inherited.set(linked.id, s.spell.cluster);
      }
      const side: BlockSide =
        s.spell.side ??
        (linked?.blockSide === "internal" || linked?.blockSide === "external"
          ? linked.blockSide
          : (defaultClusterSide(clusterOrNull) ?? "internal"));
      out.push({
        key: `${kind}:${row.id}:${s.spell.from}`,
        kind,
        id: row.id,
        spellFrom: s.spell.from,
        title: textOf(row.title) || "Untitled",
        ...(s.spell.cause ? { cause: s.spell.cause } : {}),
        cluster: clusterOrNull,
        side,
        blockedDays: overlap / DAY_MS,
        daysOpen: null,
        ...(impedimentId && linked ? { impedimentId } : {}),
        open: s.open,
        month: (localDay(new Date(s.from).toISOString()) ?? window.from).slice(0, 7),
      });
    }
  };
  for (const s of stories) if (s && real(s.id)) spellRows("story", s);
  for (const c of cards) if (c && real(c.id)) spellRows("card", c);

  const today = window.to;
  for (const i of impById.values()) {
    const raised = dayOf(i.raisedAt);
    if (!inWindow(raised)) continue;
    const own = textOf(i.cluster);
    const cluster = own || inherited.get(i.id) || null;
    const description = textOf(i.description);
    out.push({
      key: `impediment:${i.id}`,
      kind: "impediment",
      id: i.id,
      title: textOf(i.title) || "Untitled impediment",
      ...(description ? { cause: description.slice(0, 200) } : {}),
      cluster,
      side: impedimentSide(i, cluster),
      blockedDays: 0,
      daysOpen: impedimentAgeDays(i, today),
      impedimentId: i.id,
      open: !isResolved(i),
      month: (raised as string).slice(0, 7),
    });
  }
  return out;
}

/** What the clusters are ranked by. */
export type BlockerMeasure = "blocked_days" | "impediments";

/** One cluster on the Pareto chart. */
export interface ClusterRow {
  cluster: string;
  /** The side most of its rows carry (ties: inside). */
  side: BlockSide;
  /** Its rows: spells and impediments. */
  blockers: number;
  /** Stories and cards blocked under it. */
  items: number;
  /** Item-blocked days, to 0.1. */
  blockedDays: number;
  /** Impediments raised under it. */
  impediments: number;
  /** Those impediments' days open, summed. */
  daysOpen: number;
  /** Its share of the measure, 0–1. */
  share: number;
  /** The running share, 0–1. */
  cumulative: number;
  /** One of the few clusters behind PARETO_CUTOFF of the measure. */
  vital: boolean;
}

export interface ClusterPareto {
  measure: BlockerMeasure;
  clusters: ClusterRow[];
  /** "These 3 clusters hold 72% of blocked days." Null with nothing clustered. */
  sentence: string | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function aggregate(rows: readonly BlockerRow[]) {
  const byCluster = new Map<
    string,
    { rows: BlockerRow[]; items: Set<string>; days: number; imps: number; open: number }
  >();
  for (const r of rows) {
    if (!r.cluster) continue;
    const g = byCluster.get(r.cluster) ?? {
      rows: [],
      items: new Set<string>(),
      days: 0,
      imps: 0,
      open: 0,
    };
    g.rows.push(r);
    if (r.kind === "impediment") {
      g.imps++;
      g.open += r.daysOpen ?? 0;
    } else {
      g.items.add(`${r.kind}:${r.id}`);
      g.days += r.blockedDays;
    }
    byCluster.set(r.cluster, g);
  }
  return byCluster;
}

function majoritySide(rows: readonly BlockerRow[]): BlockSide {
  const outside = rows.filter((r) => r.side === "external").length;
  return outside > rows.length - outside ? "external" : "internal";
}

/**
 * The clusters most first, by item-blocked days (or, with none yet in the
 * window, by impediments raised), through Root Cause's `paretoRows`, with
 * the share each holds and the "vital few" behind PARETO_CUTOFF of it.
 */
export function clusterPareto(rows: readonly BlockerRow[]): ClusterPareto {
  const groups = aggregate(rows);
  const anyDays = Array.from(groups.values()).some((g) => round1(g.days) > 0);
  const measure: BlockerMeasure = anyDays ? "blocked_days" : "impediments";
  const order = Array.from(groups.keys());
  const pareto = paretoRows(
    order.map((cluster) => {
      const g = groups.get(cluster)!;
      return {
        id: cluster,
        text: cluster,
        category: majoritySide(g.rows),
        count: measure === "blocked_days" ? round1(g.days) : g.imps,
      };
    })
  );
  const clusters: ClusterRow[] = pareto.map((p) => {
    const g = groups.get(p.id)!;
    return {
      cluster: p.id,
      side: p.category as BlockSide,
      blockers: g.rows.length,
      items: g.items.size,
      blockedDays: round1(g.days),
      impediments: g.imps,
      daysOpen: g.open,
      share: p.share,
      cumulative: p.cumulative,
      vital: p.vital,
    };
  });
  return { measure, clusters, sentence: paretoSentence(clusters, measure) };
}

/** "These 3 clusters hold 72% of blocked days." */
export function paretoSentence(
  clusters: readonly ClusterRow[],
  measure: BlockerMeasure
): string | null {
  if (clusters.length === 0) return null;
  const vital = clusters.filter((c) => c.vital);
  const share = Math.round((vital[vital.length - 1]?.cumulative ?? 0) * 100);
  const what = measure === "blocked_days" ? "blocked days" : "impediments raised";
  if (vital.length === clusters.length && clusters.length === 1) {
    return `One cluster holds all the ${what}: ${clusters[0].cluster}.`;
  }
  return vital.length === 1
    ? `This cluster holds ${share}% of ${what}: ${vital[0].cluster}.`
    : `These ${vital.length} clusters hold ${share}% of ${what}.`;
}

/** The PARETO_CUTOFF the vital few are drawn against, as a percent. */
export const PARETO_LINE_PCT = Math.round(PARETO_CUTOFF * 100);

/** The top clusters of one month. */
export interface MonthBlockers {
  /** "YYYY-MM". */
  month: string;
  top: { cluster: string; value: number }[];
}

/**
 * The top 3 clusters per month, oldest month first, by the same measure as
 * the whole window (`measure`), from when each spell began or impediment
 * was raised.
 */
export function blockersByMonth(
  rows: readonly BlockerRow[],
  measure: BlockerMeasure
): MonthBlockers[] {
  const months = Array.from(new Set(rows.map((r) => r.month))).sort();
  return months
    .map((month) => {
      const groups = aggregate(rows.filter((r) => r.month === month));
      const top = Array.from(groups, ([cluster, g]) => ({
        cluster,
        value: measure === "blocked_days" ? round1(g.days) : g.imps,
      }))
        .filter((t) => t.value > 0)
        .sort((a, b) => b.value - a.value || a.cluster.localeCompare(b.cluster))
        .slice(0, 3);
      return { month, top };
    })
    .filter((m) => m.top.length > 0);
}

export interface SideTotals {
  blockedDays: number;
  impediments: number;
}

export interface SideSplit {
  internal: SideTotals;
  external: SideTotals;
  /** Outside's share of the measure, a whole-number percent; null with none. */
  externalPct: number | null;
}

/** Inside the team against outside it, on the measure (clustered or not). */
export function sideSplit(rows: readonly BlockerRow[], measure: BlockerMeasure): SideSplit {
  const zero = (): SideTotals => ({ blockedDays: 0, impediments: 0 });
  const out = { internal: zero(), external: zero() };
  for (const r of rows) {
    const t = out[r.side];
    if (r.kind === "impediment") t.impediments++;
    else t.blockedDays += r.blockedDays;
  }
  out.internal.blockedDays = round1(out.internal.blockedDays);
  out.external.blockedDays = round1(out.external.blockedDays);
  const pick = (t: SideTotals) => (measure === "blocked_days" ? t.blockedDays : t.impediments);
  const total = pick(out.internal) + pick(out.external);
  return { ...out, externalPct: total > 0 ? Math.round((pick(out.external) / total) * 100) : null };
}

/** How blocked time hit the work that finished in the window. */
export interface BlockedWork {
  /** Finished in the window, started on or after BLOCK_TRACKING_SINCE. */
  finished: number;
  /** Of those, blocked at some point in their cycle. */
  blocked: number;
  /** Blocked days of the blocked ones: median and 85th percentile. */
  median: number | null;
  p85: number | null;
  /** Blocked time as a whole-number percent of their elapsed start-to-done time. */
  sharePct: number;
}

/**
 * Items finished in the window (stories and cards) that started on or
 * after BLOCK_TRACKING_SINCE: how many were blocked, for how long, and
 * blocked time as a share of their start-to-done time. Null below
 * MIN_SAMPLE.distribution such items.
 */
export function blockedWork(
  stories: readonly Story[],
  cards: readonly KanbanCard[],
  window: BlockerWindow
): BlockedWork | null {
  const inWindow = (at: string | undefined) => {
    const day = localDay(at);
    return day !== null && day >= window.from && day <= window.to;
  };
  const reads: { blockedMs: number; cycleMs: number }[] = [];
  const rows: BlockRow[] = [
    ...stories.filter((s) => s && real(s.id) && s.status === "done" && inWindow(s.doneAt)),
    ...cards.filter((c) => c && real(c.id) && c.column === "done" && inWindow(c.completedAt)),
  ];
  for (const row of rows) {
    const read = blockedInCycle(row, window.now);
    if (read && read.cycleMs > 0) reads.push(read);
  }
  if (reads.length < MIN_SAMPLE.distribution) return null;
  const blocked = reads.filter((r) => r.blockedMs > 0);
  const days = blocked.map((r) => r.blockedMs / DAY_MS);
  const cycle = reads.reduce((n, r) => n + r.cycleMs, 0);
  const blockedMs = reads.reduce((n, r) => n + r.blockedMs, 0);
  const pct = (p: number) => {
    const v = percentile(days, p);
    return v === null ? null : round1(v);
  };
  return {
    finished: reads.length,
    blocked: blocked.length,
    median: pct(50),
    p85: pct(85),
    sharePct: cycle > 0 ? Math.round((blockedMs / cycle) * 100) : 0,
  };
}

/** "Of 12 items finished, 5 were blocked: a median of 1.2 days each (85% within 3 days), 9% of their time." */
export function blockedWorkSentence(w: BlockedWork): string {
  const days = (n: number | null) => (n === null ? "—" : `${n} ${n === 1 ? "day" : "days"}`);
  if (w.blocked === 0) {
    return `None of the ${w.finished} items finished in this window was blocked.`;
  }
  const spread =
    w.p85 !== null && w.blocked >= MIN_SAMPLE.distribution ? ` (85% within ${days(w.p85)})` : "";
  return `Of ${w.finished} items finished, ${w.blocked} ${w.blocked === 1 ? "was" : "were"} blocked: a median of ${days(w.median)} each${spread}, ${w.sharePct}% of their time from start to done.`;
}

/** Stories and cards blocked since before tracking began (their time can't be counted). */
export function untrackedCount(stories: readonly Story[], cards: readonly KanbanCard[]): number {
  return [...stories, ...cards].filter((r) => r && real(r.id) && untrackedBlock(r)).length;
}

/** The whole read behind the page's "Blockers" section and tool.impediments.list_blockers. */
export interface BlockersRead {
  window: BlockerWindow;
  rows: BlockerRow[];
  pareto: ClusterPareto;
  split: SideSplit;
  blockedWork: BlockedWork | null;
  untracked: number;
  /** Rows not clustered yet. */
  unclustered: BlockerRow[];
  /** BLOCK_TRACKING_SINCE, for "Blocked time counts from …". */
  trackingSince: string;
  verdict: string;
}

/** One sentence on where the blocked time goes. */
export function blockersVerdict(x: Omit<BlockersRead, "verdict">): string {
  if (x.rows.length === 0) return "Nothing was blocked in this window.";
  const parts: string[] = [];
  if (x.pareto.clusters.length > 0) {
    const top = x.pareto.clusters[0];
    parts.push(
      x.pareto.measure === "blocked_days"
        ? `${top.cluster} cost the most: ${top.blockedDays} blocked ${top.blockedDays === 1 ? "day" : "days"}`
        : `${top.cluster} comes up most: ${top.impediments} ${top.impediments === 1 ? "impediment" : "impediments"}`
    );
  }
  if (x.split.externalPct !== null) {
    parts.push(`${x.split.externalPct}% from outside the team`);
  }
  let out = parts.length ? `${parts.join("; ")}.` : "";
  if (x.unclustered.length > 0) {
    out += `${out ? " " : ""}${x.unclustered.length} not clustered yet.`;
  }
  return out || "Nothing was blocked in this window.";
}

/** Everything the Blockers section shows, for a window. */
export function readBlockers(
  stories: readonly Story[],
  cards: readonly KanbanCard[],
  impediments: readonly Impediment[],
  window: BlockerWindow
): BlockersRead {
  const rows = blockerRows(stories, cards, impediments, window);
  const pareto = clusterPareto(rows);
  const partial: Omit<BlockersRead, "verdict"> = {
    window,
    rows,
    pareto,
    split: sideSplit(rows, pareto.measure),
    blockedWork: blockedWork(stories, cards, window),
    untracked: untrackedCount(stories, cards),
    unclustered: rows.filter((r) => !r.cluster),
    trackingSince: BLOCK_TRACKING_SINCE,
  };
  return { ...partial, verdict: blockersVerdict(partial) };
}

/* ── Writing a cluster, and raising one as an impediment ───────────── */

/** A cluster's name compared without case or extra spaces. */
export function clusterKey(cluster: string | null | undefined): string {
  return typeof cluster === "string" ? cluster.trim().replace(/\s+/g, " ").toLowerCase() : "";
}

/** A cluster's name as stored: trimmed, single spaces, at most BLOCKER_CLUSTER_MAX characters. */
export function cleanClusterName(cluster: string): string {
  return cluster.trim().replace(/\s+/g, " ").slice(0, BLOCKER_CLUSTER_MAX).trim();
}

/**
 * The impediment with `cluster` (null clears it and its side) and, when
 * given, `side` as its blockSide. The same impediment when nothing changes.
 */
export function withImpedimentCluster(
  i: Impediment,
  cluster: string | null,
  side?: BlockSide
): Impediment {
  const next: Impediment = { ...i };
  if (cluster === null || !cleanClusterName(cluster)) {
    delete next.cluster;
    delete next.blockSide;
  } else {
    next.cluster = cleanClusterName(cluster);
    if (side) next.blockSide = side;
  }
  return next.cluster === i.cluster && next.blockSide === i.blockSide ? i : next;
}

/** The unresolved impediment already raised for `cluster` (by its cluster), if any. */
export function openImpedimentFor(
  impediments: readonly Impediment[],
  cluster: string
): Impediment | undefined {
  const key = clusterKey(cluster);
  if (!key) return undefined;
  return impediments.find((i) => i && !isResolved(i) && clusterKey(i.cluster) === key);
}

export const RAISED_TITLE = "Keeps blocking us: ";

/**
 * An impediment for a whole cluster ("Keeps blocking us: Another team"):
 * medium severity, outside the team as `external`, inside as `process`,
 * the cluster and its side set, and a description with its counts in the
 * window and up to 5 causes. `rows` is the window's blocker rows.
 */
export function clusterImpediment(
  rows: readonly BlockerRow[],
  cluster: string,
  { id, today, from }: { id: string; today: string; from: string }
): Impediment {
  const name = cleanClusterName(cluster);
  const key = clusterKey(name);
  const members = rows.filter((r) => clusterKey(r.cluster) === key);
  const side = members.length ? majoritySide(members) : (defaultClusterSide(name) ?? "internal");
  const items = new Set(
    members.filter((r) => r.kind !== "impediment").map((r) => `${r.kind}:${r.id}`)
  ).size;
  const days = round1(members.reduce((n, r) => n + r.blockedDays, 0));
  const imps = members.filter((r) => r.kind === "impediment").length;
  const causes = Array.from(
    new Set(members.map((r) => (r.cause ?? r.title).replace(/\s+/g, " ").trim()).filter(Boolean))
  )
    .slice(0, 5)
    .map((c) => (c.length > 160 ? `${c.slice(0, 159).trimEnd()}…` : c));
  const counts = [
    items
      ? `${items} ${items === 1 ? "item" : "items"} blocked for ${days} ${days === 1 ? "day" : "days"}`
      : "",
    imps ? `${imps} ${imps === 1 ? "impediment" : "impediments"} raised` : "",
  ].filter(Boolean);
  const description = [
    counts.length ? `Since ${from}: ${counts.join(", ")}.` : `Raised from the "${name}" cluster.`,
    ...(causes.length ? ["Causes:", ...causes.map((c) => `- ${c}`)] : []),
  ].join("\n");
  return {
    id,
    title: `${RAISED_TITLE}${name}`,
    severity: "medium",
    raisedAt: today,
    source: "manual",
    category: side === "external" ? "external" : "process",
    cluster: name,
    blockSide: side,
    description,
  };
}
