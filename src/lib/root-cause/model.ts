/**
 * Root Cause: the rules every reader shares (the page, the hand-off route,
 * Amr's verbs on the browser and the server). A root-cause analysis
 * (workspace.rootCauseAnalyses) takes a problem back to its causes by 5
 * Whys, a fishbone or both, then names the root cause and a countermeasure.
 *
 * Pure: no store, no browser globals. Every write goes through the caps the
 * workspace CRUD validates against (TOOL_TEXT_MAX, TOOL_LIST_MAX), so a
 * record the page saved is always one an agent can update, and the other
 * way round.
 */

import {
  HANDOFF_ROUTE_IDS,
  ROOT_CAUSE_METHODS,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type HandoffLink,
  type HandoffRef,
  type RootCauseAnalysis,
  type RootCauseCause,
  type RootCauseMethod,
  type RootCauseWhy,
} from "@/lib/stores/workspace-types";
import { hashSeed } from "@/lib/utils/random";

/** Every analysis id starts with this, as the workspace CRUD makes them. */
export const ROOT_CAUSE_ID_PREFIX = "rca_";

/** The tool id a sent item names in its sourceRef. */
export const ROOT_CAUSE_TOOL = "root-cause";

/**
 * The fishbone's starting categories, in the order the board shows them.
 * The team can rename them or add its own: a category is just the name on
 * its causes.
 */
export const DEFAULT_CATEGORIES = [
  "People",
  "Process",
  "Tools",
  "Environment",
  "Measurement",
  "Other",
] as const;

/** "About five" whys: the ladder says so once it has this many. */
export const WHYS_TYPICAL = 5;

/** The share of all counts the Pareto chart's "vital few" cover. */
export const PARETO_CUTOFF = 0.8;

/** A cause's count goes up to this (a whole number). */
export const CAUSE_COUNT_MAX = 9999;

/** A category's name, at most this long. */
export const CATEGORY_MAX = 60;

export const ROOT_CAUSE_METHOD_LABEL: Record<RootCauseMethod, string> = {
  "five-whys": "5 Whys",
  fishbone: "Fishbone",
};

/** One line, trimmed and capped (an ellipsis marks a cut). */
export function cleanLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const t = value.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Text that may hold line breaks, trimmed and capped. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const t = value.replace(/\r\n?/g, "\n").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** A count as the analysis keeps it: a whole number from 0 to CAUSE_COUNT_MAX. */
export function cleanCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(CAUSE_COUNT_MAX, Math.round(n)));
}

/** A category name: one line, at most CATEGORY_MAX; blank is "Other". */
export function cleanCategory(value: unknown): string {
  return cleanLine(value, CATEGORY_MAX) || "Other";
}

const isMethod = (v: unknown): v is RootCauseMethod =>
  typeof v === "string" && (ROOT_CAUSE_METHODS as readonly string[]).includes(v);

export interface NewAnalysis {
  title: string;
  problem?: string;
  method?: RootCauseMethod;
  sourceRef?: HandoffRef;
  postMortemId?: string;
  retroBoardId?: string;
}

/** A new, empty analysis, stamped `now`. */
export function blankAnalysis(input: NewAnalysis, id: string, now: string): RootCauseAnalysis {
  const title = cleanLine(input.title, TOOL_TEXT_MAX.short);
  const problem = cleanText(input.problem ?? "", TOOL_TEXT_MAX.text);
  return {
    id,
    title,
    problem,
    method: isMethod(input.method) ? input.method : "five-whys",
    whys: [],
    causes: [],
    ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
    ...(input.postMortemId ? { postMortemId: input.postMortemId } : {}),
    ...(input.retroBoardId ? { retroBoardId: input.retroBoardId } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/** Problems with a new analysis's draft, or none. */
export function analysisDraftErrors(draft: {
  title: string;
  problem: string;
}): Partial<Record<"title" | "problem", string>> {
  const errors: Partial<Record<"title" | "problem", string>> = {};
  const title = draft.title.trim();
  if (!title) errors.title = "Name the problem in a few words.";
  else if (title.length > TOOL_TEXT_MAX.short)
    errors.title = `Keep it to ${TOOL_TEXT_MAX.short} characters.`;
  if (draft.problem.trim().length > TOOL_TEXT_MAX.text)
    errors.problem = `Keep it to ${TOOL_TEXT_MAX.text} characters.`;
  return errors;
}

/* ── Changes (pure: each returns the next analysis, or null when it can't) ── */

/** The analysis with `patch` merged in and `updatedAt` = `now`. */
export function touched(
  a: RootCauseAnalysis,
  patch: Partial<RootCauseAnalysis>,
  now: string
): RootCauseAnalysis {
  return { ...a, ...patch, updatedAt: now };
}

/** A why appended to the chain; null when the text is blank or the chain is full. */
export function withWhy(
  a: RootCauseAnalysis,
  text: string,
  id: string,
  now: string
): RootCauseAnalysis | null {
  const clean = cleanText(text, TOOL_TEXT_MAX.text);
  if (!clean || a.whys.length >= TOOL_LIST_MAX.whys) return null;
  return touched(a, { whys: [...a.whys, { id, text: clean }] }, now);
}

/** A why's text changed in place; null when it's gone or the text is blank. */
export function withWhyText(
  a: RootCauseAnalysis,
  whyId: string,
  text: string,
  now: string
): RootCauseAnalysis | null {
  const clean = cleanText(text, TOOL_TEXT_MAX.text);
  if (!clean || !a.whys.some((w) => w.id === whyId)) return null;
  return touched(a, { whys: a.whys.map((w) => (w.id === whyId ? { ...w, text: clean } : w)) }, now);
}

export interface NewCause {
  category: string;
  text: string;
  count?: number;
}

/** A cause added to the fishbone; null when the text is blank or the list is full. */
export function withCause(
  a: RootCauseAnalysis,
  cause: NewCause,
  id: string,
  now: string
): RootCauseAnalysis | null {
  const text = cleanText(cause.text, TOOL_TEXT_MAX.text);
  if (!text || a.causes.length >= TOOL_LIST_MAX.causes) return null;
  const next: RootCauseCause = {
    id,
    category: cleanCategory(cause.category),
    text,
    count: cleanCount(cause.count ?? 1),
  };
  return touched(a, { causes: [...a.causes, next] }, now);
}

/** One cause changed in place; null when it's gone or its text would be blank. */
export function withCausePatch(
  a: RootCauseAnalysis,
  causeId: string,
  patch: Partial<Omit<RootCauseCause, "id">>,
  now: string
): RootCauseAnalysis | null {
  const cur = a.causes.find((c) => c.id === causeId);
  if (!cur) return null;
  const next: RootCauseCause = {
    ...cur,
    ...(patch.category !== undefined ? { category: cleanCategory(patch.category) } : {}),
    ...(patch.text !== undefined ? { text: cleanText(patch.text, TOOL_TEXT_MAX.text) } : {}),
    ...(patch.count !== undefined ? { count: cleanCount(patch.count) } : {}),
  };
  if (!next.text) return null;
  return touched(a, { causes: a.causes.map((c) => (c.id === causeId ? next : c)) }, now);
}

/** Every cause in `from` moved to `to` (renaming a category); null when none is in it. */
export function withCategoryRenamed(
  a: RootCauseAnalysis,
  from: string,
  to: string,
  now: string
): RootCauseAnalysis | null {
  const target = cleanCategory(to);
  const key = from.trim().toLowerCase();
  if (!a.causes.some((c) => c.category.trim().toLowerCase() === key)) return null;
  return touched(
    a,
    {
      causes: a.causes.map((c) =>
        c.category.trim().toLowerCase() === key ? { ...c, category: target } : c
      ),
    },
    now
  );
}

/**
 * The fishbone's categories in order: the six defaults, then the team's own
 * in the order they first appear. Names match whatever their case; a
 * default keeps its own spelling. A default in `hidden` (renamed or removed
 * by the team) is left out while no cause is filed under it.
 */
export function categoriesOf(
  causes: readonly Pick<RootCauseCause, "category">[],
  extra: readonly string[] = [],
  hidden: readonly string[] = []
): string[] {
  const off = new Set(hidden.map((h) => h.trim().toLowerCase()));
  const used = new Set(causes.map((c) => c.category.trim().toLowerCase()));
  const out: string[] = DEFAULT_CATEGORIES.filter(
    (c) => !off.has(c.toLowerCase()) || used.has(c.toLowerCase())
  );
  const seen = new Set(out.map((c) => c.toLowerCase()));
  for (const name of [...causes.map((c) => c.category), ...extra]) {
    const clean = cleanLine(name, CATEGORY_MAX);
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
  }
  return out;
}

/** The causes filed under `category` (any case). */
export function causesIn(causes: readonly RootCauseCause[], category: string): RootCauseCause[] {
  const key = category.trim().toLowerCase();
  return causes.filter((c) => c.category.trim().toLowerCase() === key);
}

/* ── Pareto ─────────────────────────────────────────────────────────── */

export interface ParetoRow {
  id: string;
  text: string;
  category: string;
  count: number;
  /** This cause's share of all counts, 0–1. */
  share: number;
  /** The running share up to and including this cause, 0–1. */
  cumulative: number;
  /** Among the few causes behind PARETO_CUTOFF of the counts. */
  vital: boolean;
}

/**
 * The causes with a count, most first (ties keep the fishbone's order),
 * each with its share and the running share. A cause is one of the "vital
 * few" while the share before it is under 80%, so the cause that crosses
 * the line is one of them too.
 */
export function paretoRows(causes: readonly RootCauseCause[]): ParetoRow[] {
  const counted = causes
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.count > 0)
    .sort((x, y) => y.c.count - x.c.count || x.i - y.i);
  const total = counted.reduce((sum, { c }) => sum + c.count, 0);
  if (total === 0) return [];
  let running = 0;
  return counted.map(({ c }) => {
    const before = running;
    running += c.count;
    return {
      id: c.id,
      text: c.text,
      category: c.category,
      count: c.count,
      share: c.count / total,
      cumulative: running / total,
      vital: before / total < PARETO_CUTOFF,
    };
  });
}

/** Counted causes before the Pareto chart says anything: two, or there's no order to show. */
export const PARETO_MIN_CAUSES = 2;

/* ── Where an analysis stands ──────────────────────────────────────── */

export type AnalysisStage = "started" | "root-cause" | "countermeasure" | "sent";

/**
 * Whether a stored link's target is still there. The caller that can see
 * the targets passes one (the page: the hand-off route's `exists`); without
 * one, every recorded link counts.
 */
export type LinkIsLive = (link: HandoffLink) => boolean;

const everyLink: LinkIsLive = () => true;

/**
 * Links read against the retro boards: a link to Retro Actions counts while
 * its action card is still on a board (what the retro-action route's
 * `exists` checks), any other link counts.
 */
export function liveOnBoards(
  boards: readonly { cards?: readonly { id: string }[] }[] | undefined
): LinkIsLive {
  // A synced board can hold anything: only real card ids count.
  const ids = new Set<string>();
  for (const b of Array.isArray(boards) ? boards : []) {
    const cards: unknown = (b as { cards?: unknown } | null)?.cards;
    if (!Array.isArray(cards)) continue;
    for (const c of cards) {
      const cardId = (c as { id?: unknown } | null)?.id;
      if (typeof cardId === "string") ids.add(cardId);
    }
  }
  return (link) => link.route !== "retro-action" || ids.has(link.targetId);
}

/** The analysis's live link to Retro Actions, if any (a deleted action doesn't count). */
export function sentLink(
  a: RootCauseAnalysis,
  isLive: LinkIsLive = everyLink
): HandoffLink | undefined {
  return (a.sentTo ?? []).find((l) => l.route === "retro-action" && isLive(l));
}

/**
 * How far an analysis got: a root cause named, a countermeasure agreed, sent
 * to Retro Actions (an action that was deleted there doesn't count, when
 * `isLive` can tell).
 */
export function analysisStage(a: RootCauseAnalysis, isLive: LinkIsLive = everyLink): AnalysisStage {
  if (sentLink(a, isLive)) return "sent";
  if (a.countermeasure?.trim()) return "countermeasure";
  if (a.rootCause?.trim()) return "root-cause";
  return "started";
}

export const STAGE_LABEL: Record<AnalysisStage, string> = {
  started: "Looking for the cause",
  "root-cause": "Root cause named",
  countermeasure: "Countermeasure agreed",
  sent: "In Retro Actions",
};

/** Newest change first. */
export function newestFirst(list: readonly RootCauseAnalysis[]): RootCauseAnalysis[] {
  return [...list].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

/** One sentence on the analyses: what to do next across them. */
export function rootCauseVerdict(
  list: readonly RootCauseAnalysis[],
  isLive: LinkIsLive = everyLink
): string {
  if (list.length === 0) return "No analysis yet.";
  const stages = list.map((a) => analysisStage(a, isLive));
  const started = stages.filter((s) => s === "started").length;
  const named = stages.filter((s) => s === "root-cause").length;
  const agreed = stages.filter((s) => s === "countermeasure").length;
  const sent = stages.filter((s) => s === "sent").length;
  if (named > 0) {
    return `${named} ${named === 1 ? "analysis has" : "analyses have"} a root cause but no countermeasure yet: agree what the team will change.`;
  }
  if (agreed > 0) {
    return `${agreed} ${agreed === 1 ? "countermeasure isn't" : "countermeasures aren't"} in Retro Actions yet: send ${agreed === 1 ? "it" : "them"} so someone owns ${agreed === 1 ? "it" : "them"}.`;
  }
  if (started > 0) {
    return `${started} ${started === 1 ? "analysis is" : "analyses are"} still looking for the root cause.`;
  }
  return `All ${sent} ${sent === 1 ? "countermeasure is" : "countermeasures are"} in Retro Actions.`;
}

/**
 * What a countermeasure sends to Retro Actions: the action itself (its
 * first line) and, as the description, the problem and root cause it
 * answers.
 */
export function countermeasureSource(a: RootCauseAnalysis): {
  title: string;
  description: string;
} {
  const first = (a.countermeasure ?? "").split("\n")[0] ?? "";
  return {
    title: cleanLine(first, 500),
    description: cleanText(
      [
        `Problem: ${a.title}`,
        a.rootCause?.trim() ? `Root cause: ${a.rootCause.trim()}` : "",
        a.countermeasure?.trim() ? `Countermeasure: ${a.countermeasure.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      4000
    ),
  };
}

/**
 * Where a post-mortem's contributing factor sits, as a hand-off ref: the
 * post-mortem is the document and the factor (plain text, no id of its own)
 * is named by a hash of its words, so the same factor finds the same
 * analysis again whatever its place in the list.
 */
export function postMortemFactorRef(postMortemId: string, factor: string): HandoffRef {
  return {
    tool: "post-mortem",
    id: `factor:${hashSeed(factor.replace(/\s+/g, " ").trim().toLowerCase()).toString(36)}`,
    doc: postMortemId,
  };
}

/** The why chain as plain lines, first why first. */
export function whyLines(whys: readonly RootCauseWhy[]): string[] {
  return whys.map((w) => w.text.trim()).filter(Boolean);
}

const isRouteId = (v: unknown): v is HandoffLink["route"] =>
  typeof v === "string" && (HANDOFF_ROUTE_IDS as readonly string[]).includes(v);

/** Stored hand-off links rebuilt from known fields: anything else is dropped. */
function readLinks(raw: unknown): HandoffLink[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: HandoffLink[] = [];
  for (const l of raw) {
    const o = l as Record<string, unknown> | null;
    if (!o || typeof o !== "object") continue;
    if (!isRouteId(o.route) || typeof o.targetId !== "string" || !o.targetId) continue;
    if (typeof o.at !== "string") continue;
    out.push({ route: o.route, targetId: o.targetId, at: o.at });
  }
  return out;
}

/** A stored hand-off ref rebuilt from known fields, or undefined. */
function readRef(raw: unknown): HandoffRef | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.tool !== "string" || !o.tool || typeof o.id !== "string" || !o.id) return undefined;
  return { tool: o.tool, id: o.id, ...(typeof o.doc === "string" && o.doc ? { doc: o.doc } : {}) };
}

/**
 * A stored analysis made safe to read: fields capped, lists cut to their
 * caps, counts whole numbers, unknown methods read as 5 Whys, links and the
 * source ref rebuilt from known fields. A synced row can hold anything;
 * this keeps the page from drawing what the CRUD would refuse, or crashing
 * on it. Null for something that isn't an analysis at all.
 */
export function readAnalysis(raw: unknown): RootCauseAnalysis | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  const whys: RootCauseWhy[] = [];
  for (const w of Array.isArray(r.whys) ? r.whys : []) {
    if (whys.length >= TOOL_LIST_MAX.whys) break;
    const o = w as Record<string, unknown> | null;
    if (!o || typeof o.id !== "string" || !o.id) continue;
    const text = cleanText(o.text, TOOL_TEXT_MAX.text);
    if (text) whys.push({ id: o.id, text });
  }
  const causes: RootCauseCause[] = [];
  for (const c of Array.isArray(r.causes) ? r.causes : []) {
    if (causes.length >= TOOL_LIST_MAX.causes) break;
    const o = c as Record<string, unknown> | null;
    if (!o || typeof o.id !== "string" || !o.id) continue;
    const text = cleanText(o.text, TOOL_TEXT_MAX.text);
    if (!text) continue;
    causes.push({
      id: o.id,
      category: cleanCategory(o.category),
      text,
      count: cleanCount(o.count),
    });
  }
  const now = typeof r.updatedAt === "string" ? r.updatedAt : "";
  const out: RootCauseAnalysis = {
    ...(r as unknown as RootCauseAnalysis),
    id: r.id,
    title: cleanLine(r.title, TOOL_TEXT_MAX.short) || "Untitled problem",
    problem: cleanText(r.problem, TOOL_TEXT_MAX.text),
    method: isMethod(r.method) ? r.method : "five-whys",
    whys,
    causes,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : now,
    updatedAt: now,
  };
  const rootCause = cleanText(r.rootCause, TOOL_TEXT_MAX.text);
  const countermeasure = cleanText(r.countermeasure, TOOL_TEXT_MAX.text);
  if (rootCause) out.rootCause = rootCause;
  else delete out.rootCause;
  if (countermeasure) out.countermeasure = countermeasure;
  else delete out.countermeasure;
  const sentTo = readLinks(r.sentTo);
  if (sentTo) out.sentTo = sentTo;
  else delete out.sentTo;
  const sourceRef = readRef(r.sourceRef);
  if (sourceRef) out.sourceRef = sourceRef;
  else delete out.sourceRef;
  for (const key of ["postMortemId", "retroBoardId"] as const) {
    if (typeof r[key] !== "string" || !r[key]) delete out[key];
  }
  return out;
}

/**
 * The stored analyses made safe to read (see readAnalysis), dropping what
 * isn't an analysis at all. Anything that reads workspace.rootCauseAnalyses
 * outside the page (a next step, Post-Mortem's links) goes through this.
 */
export function readAnalyses(raw: unknown): RootCauseAnalysis[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const a = readAnalysis(r);
    return a ? [a] : [];
  });
}
