/**
 * Bug Triage's pure model, server-safe: the bug id prefix the hand-off
 * route and the CRUD share, the labels and quick checks, the rules that
 * suggest a severity and a priority without AI, each cell's advice, ages
 * and fix-by targets, where a bug went (read from the slices it is given,
 * never stored twice), and the next steps. The page, the next-step rule,
 * Amr's verbs and the AI task's fallback all use it, so they agree.
 *
 * Pure: no store, no React, no zod and no "use client" module. Every date
 * function takes `today` (YYYY-MM-DD, the local day) or `now`.
 */

import type {
  BugChecks,
  BugCloseReason,
  BugPriority,
  BugReach,
  BugReport,
  BugSeverity,
  BugStatus,
  HandoffLink,
  InterruptItem,
  Story,
} from "@/lib/stores/workspace-types";
import {
  BUG_CLOSE_REASONS,
  BUG_PRIORITIES,
  BUG_REACH,
  BUG_SEVERITIES,
  BUG_STATUSES,
  TOOL_TEXT_MAX,
} from "@/lib/stores/workspace-types";
import type { HandoffSource } from "@/lib/handoffs/types";
import type { NextStep } from "@/lib/tools/next-steps";
import { duplicateGroups } from "@/lib/audience-wall/words";
import { addDays, dayNumber } from "@/lib/flow/days";
import { localDay } from "@/lib/sprints/series";
import { BUG_TAG } from "@/lib/stories/kind";
import { isExampleId } from "@/lib/utils/example-id";
import type { Validation } from "@/lib/utils/form";

/** Every bug's id starts with this (the CRUD's and the "bug" route's). */
export const BUG_ID_PREFIX = "bug_";

/* ── Labels ──────────────────────────────────────────────────────────── */

export const SEVERITY_LABEL: Readonly<Record<BugSeverity, string>> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
  cosmetic: "Cosmetic",
};

/** What each severity means, in a line. */
export const SEVERITY_MEANING: Readonly<Record<BugSeverity, string>> = {
  critical: "Loses data, opens a hole, or stops people working",
  major: "A main path is broken or gives a wrong result",
  minor: "Annoying, but people can carry on",
  cosmetic: "How it looks or reads, nothing more",
};

export const PRIORITY_LABEL: Readonly<Record<BugPriority, string>> = {
  now: "Now",
  next: "Next",
  later: "Later",
  someday: "Some day",
};

/** What each priority means, in a line. */
export const PRIORITY_MEANING: Readonly<Record<BugPriority, string>> = {
  now: "Fix it in this sprint",
  next: "Plan it for the next sprint",
  later: "Plan it when there is room",
  someday: "Only if nothing else needs doing",
};

export const STATUS_LABEL: Readonly<Record<BugStatus, string>> = {
  new: "New",
  triaged: "Triaged",
  closed: "Closed",
};

export const CLOSE_REASON_LABEL: Readonly<Record<BugCloseReason, string>> = {
  fixed: "Fixed",
  duplicate: "Duplicate",
  "cant-reproduce": "Can't reproduce",
  "wont-fix": "Won't fix",
  "not-a-bug": "Not a bug",
};

export const REACH_LABEL: Readonly<Record<BugReach, string>> = {
  one: "One person",
  some: "Some people",
  many: "Many people",
  all: "Everyone",
};

/** The quick checks, asked in this order before a bug is placed. */
export const CHECK_QUESTIONS = {
  dataLoss: "Does it lose, damage or leak data?",
  security: "Is it a security or privacy hole?",
  workaround: "Can people get round it?",
  reach: "How many people hit it?",
  blocksRelease: "Does it block a release or a demo?",
} as const;

/** The yes/no checks (reach is the fifth, a choice). */
export const YES_NO_CHECKS = ["dataLoss", "security", "workaround", "blocksRelease"] as const;
export type YesNoCheck = (typeof YES_NO_CHECKS)[number];

/* ── Reading stored rows ─────────────────────────────────────────────── */

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, max);
  return t === "" ? undefined : t;
};

/** Text on one line: runs of white space (line breaks too) become one space. */
export const oneLine = (v: string): string => v.replace(/\s+/g, " ").trim();

function readChecks(raw: unknown): BugChecks | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: BugChecks = {};
  for (const key of YES_NO_CHECKS) if (typeof r[key] === "boolean") out[key] = r[key] as boolean;
  if (isOneOf(BUG_REACH, r.reach)) out.reach = r.reach;
  return Object.keys(out).length > 0 ? out : undefined;
}

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

/**
 * A stored row as the page shows it, or null when it can't be one (no id or
 * title). Unknown enum values are dropped, an unknown status reads as new,
 * and text is cut to the caps the CRUD holds.
 */
export function normalizeBug(raw: unknown): BugReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "") return null;
  const title = typeof r.title === "string" ? oneLine(r.title).slice(0, TOOL_TEXT_MAX.short) : "";
  if (title === "") return null;
  const createdAt = typeof r.createdAt === "string" ? r.createdAt : "";
  const bug: BugReport = {
    id: r.id,
    title,
    status: isOneOf(BUG_STATUSES, r.status) ? r.status : "new",
    createdAt,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : createdAt,
  };
  const steps = text(r.steps, TOOL_TEXT_MAX.text);
  const expected = text(r.expected, TOOL_TEXT_MAX.text);
  const actual = text(r.actual, TOOL_TEXT_MAX.text);
  const environment = text(r.environment, TOOL_TEXT_MAX.short);
  const area = text(r.area, TOOL_TEXT_MAX.short);
  const reportedBy = text(r.reportedBy, TOOL_TEXT_MAX.short);
  if (steps) bug.steps = steps;
  if (expected) bug.expected = expected;
  if (actual) bug.actual = actual;
  if (environment) bug.environment = environment;
  if (area) bug.area = area;
  if (reportedBy) bug.reportedBy = reportedBy;
  if (isOneOf(BUG_SEVERITIES, r.severity)) bug.severity = r.severity;
  if (isOneOf(BUG_PRIORITIES, r.priority)) bug.priority = r.priority;
  const checks = readChecks(r.checks);
  if (checks) bug.checks = checks;
  if (isOneOf(BUG_CLOSE_REASONS, r.closeReason)) bug.closeReason = r.closeReason;
  if (typeof r.duplicateOf === "string" && r.duplicateOf !== "") bug.duplicateOf = r.duplicateOf;
  if (typeof r.triagedAt === "string") bug.triagedAt = r.triagedAt;
  if (typeof r.closedAt === "string") bug.closedAt = r.closedAt;
  if (r.sourceRef && typeof r.sourceRef === "object") {
    bug.sourceRef = r.sourceRef as BugReport["sourceRef"];
  }
  const sentTo = readLinks(r.sentTo);
  if (sentTo) bug.sentTo = sentTo;
  return bug;
}

/** The usable rows, in their stored order. */
export function readBugs(raw: readonly unknown[] | undefined): BugReport[] {
  return (raw ?? []).map(normalizeBug).filter((b): b is BugReport => b !== null);
}

/** The bugs oldest first (by when they were logged), stable. */
export function oldestFirst(bugs: readonly BugReport[]): BugReport[] {
  return bugs
    .map((b, i) => ({ b, i, t: Date.parse(b.createdAt) }))
    .sort((x, y) => {
      const a = Number.isFinite(x.t) ? x.t : Infinity;
      const b = Number.isFinite(y.t) ? y.t : Infinity;
      return a === b ? x.i - y.i : a - b;
    })
    .map((x) => x.b);
}

/* ── Where a bug sits ────────────────────────────────────────────────── */

export const isOpen = (bug: Pick<BugReport, "status">): boolean => bug.status !== "closed";

/**
 * Waiting to be triaged: open, and either new or missing its severity or
 * priority (a row an agent wrote half-filled comes back to the queue).
 */
export const needsTriage = (bug: BugReport): boolean =>
  isOpen(bug) && (bug.status === "new" || !bug.severity || !bug.priority);

/** On the grid: triaged, with both a severity and a priority. */
export const onGrid = (bug: BugReport): boolean =>
  bug.status === "triaged" && Boolean(bug.severity && bug.priority);

export type BugPlace = "queue" | "grid" | "closed";

/** Where the page shows a bug: every bug is in exactly one place. */
export function placeOf(bug: BugReport): BugPlace {
  if (!isOpen(bug)) return "closed";
  return needsTriage(bug) ? "queue" : "grid";
}

/** The grid cell of a bug on the grid, else null. */
export function cellOf(bug: BugReport): { severity: BugSeverity; priority: BugPriority } | null {
  return onGrid(bug) && bug.severity && bug.priority
    ? { severity: bug.severity, priority: bug.priority }
    : null;
}

/** The triage queue: oldest first. */
export const triageQueue = (bugs: readonly BugReport[]): BugReport[] =>
  oldestFirst(bugs.filter(needsTriage));

export type GridCounts = Record<BugSeverity, Record<BugPriority, number>>;

/** How many open bugs sit in each cell. */
export function gridCounts(bugs: readonly BugReport[]): GridCounts {
  const out = Object.fromEntries(
    BUG_SEVERITIES.map((s) => [s, Object.fromEntries(BUG_PRIORITIES.map((p) => [p, 0]))])
  ) as GridCounts;
  for (const b of bugs) {
    const cell = cellOf(b);
    if (cell) out[cell.severity][cell.priority] += 1;
  }
  return out;
}

/* ── Ages and fix-by targets ─────────────────────────────────────────── */

/**
 * How many days after it was logged each severity should be fixed. Fixed
 * in code, so the page and Amr agree (Decision D8 b); cosmetic has none.
 */
export const FIX_BY_DAYS: Readonly<Record<BugSeverity, number | null>> = {
  critical: 2,
  major: 14,
  minor: 60,
  cosmetic: null,
};

/** Whole days since the bug was logged (0 on the day, never negative). */
export function ageDays(bug: Pick<BugReport, "createdAt">, today: string): number {
  const from = dayNumber(bug.createdAt);
  const to = dayNumber(today);
  if (from === null || to === null) return 0;
  return Math.max(0, to - from);
}

/** The day it should be fixed by (YYYY-MM-DD), or null with no severity or no target. */
export function fixByDay(bug: Pick<BugReport, "createdAt" | "severity">): string | null {
  const days = bug.severity ? FIX_BY_DAYS[bug.severity] : null;
  if (days === null || days === undefined) return null;
  return addDays(localDay(bug.createdAt), days);
}

/** Open and older than its severity's fix-by target. */
export function overTarget(bug: BugReport, today: string): boolean {
  if (!isOpen(bug) || !bug.severity) return false;
  const days = FIX_BY_DAYS[bug.severity];
  return days !== null && ageDays(bug, today) > days;
}

/* ── Suggesting a severity and a priority without AI ─────────────────── */

/** Worse first: critical is 0. */
export const SEVERITY_RANK: Readonly<Record<BugSeverity, number>> = {
  critical: 0,
  major: 1,
  minor: 2,
  cosmetic: 3,
};

export interface SeverityGuess {
  severity: BugSeverity;
  /** Why, in a short sentence (at most 160 characters). */
  reason: string;
}

/** Words that usually mean each severity, checked worst first. */
const SEVERITY_WORDS: readonly [BugSeverity, RegExp][] = [
  [
    "critical",
    /\b(crash(?:es|ed|ing)?|data loss|lost (?:data|work|orders?)|security|leak(?:s|ed|ing)?|payments?|charged twice|can'?t (?:log|sign) in|cannot (?:log|sign) in)\b/i,
  ],
  [
    "major",
    /\b(errors?|broken|breaks|wrong (?:total|amount|price|currency)|fails?|failed|doesn'?t work|not working|missing)\b/i,
  ],
  ["minor", /\b(slow|confusing|unclear|awkward|hard to)\b/i],
  ["cosmetic", /\b(typos?|spelling|spelt|spacing|misaligned|alignment|colou?rs?|font|wording)\b/i],
];

/** The severity a bug's words suggest, with the word that says so, or null. */
export function keywordSeverity(words: string): SeverityGuess | null {
  for (const [severity, re] of SEVERITY_WORDS) {
    const m = re.exec(words);
    if (m) {
      return {
        severity,
        reason: `It mentions “${m[0].toLowerCase()}”, which usually means ${severity}.`,
      };
    }
  }
  return null;
}

/**
 * A severity from the quick checks first, then the bug's words: data loss
 * or a security hole is critical, and so is a bug everyone hits with no way
 * round it; one that blocks a release is at least major; then the words
 * (a crash, a payment, a failed sign-in is critical; an error or a wrong
 * total major; slow or confusing minor; a typo cosmetic). With nothing to
 * go on, many people hitting it makes it major, otherwise minor.
 */
export function severityByRules(words: string, checks: BugChecks = {}): SeverityGuess {
  if (checks.dataLoss) return { severity: "critical", reason: "It loses, damages or leaks data." };
  if (checks.security) return { severity: "critical", reason: "It is a security or privacy hole." };
  if (checks.reach === "all" && checks.workaround === false) {
    return { severity: "critical", reason: "Everyone hits it, and nobody can get round it." };
  }
  const word = keywordSeverity(words);
  if (checks.blocksRelease && (!word || SEVERITY_RANK[word.severity] > SEVERITY_RANK.major)) {
    return { severity: "major", reason: "It blocks a release or a demo." };
  }
  if (word) return word;
  if (checks.reach === "many" || checks.reach === "all") {
    return { severity: "major", reason: "Many people hit it." };
  }
  return {
    severity: "minor",
    reason: checks.workaround
      ? "People can get round it."
      : "Nothing in it says it is worse than minor.",
  };
}

/**
 * How soon, from how bad: critical now; major next (now when it blocks a
 * release); minor later (next when many people hit it); cosmetic some day
 * (later when many people see it).
 */
export function priorityFor(severity: BugSeverity, checks: BugChecks = {}): BugPriority {
  const many = checks.reach === "many" || checks.reach === "all";
  if (severity === "critical") return "now";
  if (severity === "major") return checks.blocksRelease ? "now" : "next";
  if (severity === "minor") return many ? "next" : "later";
  return many ? "later" : "someday";
}

/** A bug's words for the rules: its title and details together. */
export const bugWords = (
  bug: Pick<BugReport, "title" | "steps" | "expected" | "actual" | "environment">
): string =>
  [bug.title, bug.steps, bug.expected, bug.actual, bug.environment].filter(Boolean).join("\n");

/* ── The grid's advice ───────────────────────────────────────────────── */

/** One line of advice per cell, in our own words. */
export const CELL_ADVICE: Readonly<Record<BugSeverity, Readonly<Record<BugPriority, string>>>> = {
  critical: {
    now: "Stop and fix it: log it against the sprint's interrupt buffer",
    next: "Can a critical bug wait a sprint? Move it to now, or say why it can",
    later: "A critical bug left for later: check the severity or the priority",
    someday: "A critical bug for some day: check it, or close it with a reason",
  },
  major: {
    now: "Fix it in this sprint: log it as an interrupt",
    next: "Add it to the backlog for the next sprint",
    later: "Add it to the backlog, and keep an eye on its age",
    someday: "Close it if nobody will fix it, or plan it",
  },
  minor: {
    now: "Fixing it now pushes planned work back: is it that urgent?",
    next: "Add it to the backlog for the next sprint",
    later: "Add it to the backlog for when there is room",
    someday: "Close it if nobody will fix it",
  },
  cosmetic: {
    now: "A cosmetic bug before planned work: check it",
    next: "Add it to the backlog, or fix it with work nearby",
    later: "Fix it alongside work in the same place",
    someday: "Close it if nobody will fix it",
  },
};

/** Cells whose severity and priority don't sit well together: the grid says "Check". */
export function mismatched(severity: BugSeverity, priority: BugPriority): boolean {
  return (
    (severity === "critical" && (priority === "later" || priority === "someday")) ||
    (severity === "cosmetic" && priority === "now")
  );
}

/* ── Sending a bug on ────────────────────────────────────────────────── */

/** The routes a bug goes by: fix now as an interrupt, next or later as a backlog story. */
export const BUG_ROUTES = ["interrupt", "backlog-story"] as const;
export type BugRoute = (typeof BUG_ROUTES)[number];

export const isBugRoute = (route: string): route is BugRoute =>
  (BUG_ROUTES as readonly string[]).includes(route);

/** The route a priority sends by; some day sends nowhere (close it instead). */
export function routeFor(priority: BugPriority | undefined): BugRoute | null {
  if (priority === "now") return "interrupt";
  if (priority === "next" || priority === "later") return "backlog-story";
  return null;
}

/** Where each route puts a bug, in words. */
export const ROUTE_PLACE: Readonly<Record<BugRoute, string>> = {
  interrupt: "the sprint's interrupts",
  "backlog-story": "the backlog",
};

/** The steps, what was expected and what happened, as labelled lines ("" with none). */
export function bugDescription(
  bug: Pick<BugReport, "steps" | "expected" | "actual" | "environment" | "area">
): string {
  return [
    bug.steps ? `Steps: ${bug.steps}` : "",
    bug.expected ? `Expected: ${bug.expected}` : "",
    bug.actual ? `What happened: ${bug.actual}` : "",
    bug.environment ? `Where: ${bug.environment}` : "",
    bug.area ? `Area: ${bug.area}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * What a send hands over: the title, the details as labelled lines, the
 * "bug" tag a backlog story keeps, the area and who found it, and, for an
 * interrupt, its kind and whether it couldn't wait (a critical bug).
 */
export function bugSource(bug: BugReport): HandoffSource {
  const description = bugDescription(bug);
  return {
    title: bug.title,
    ...(description ? { description } : {}),
    ...(bug.reportedBy ? { raisedBy: bug.reportedBy } : {}),
    ...(bug.area ? { area: bug.area } : {}),
    tags: [BUG_TAG],
    interrupt: { kind: "bug", emergency: bug.severity === "critical" },
    sourceRef: { tool: "bug-triage", id: bug.id },
  };
}

/** What a link's target is now: there, there and finished, or gone. */
export type LinkState = "live" | "done" | "gone";

/** The slices a bug's links are read from. */
export interface BugLinkSlices {
  stories: readonly Pick<Story, "id" | "status">[];
  interrupts: readonly Pick<InterruptItem, "id" | "resolvedAt">[];
}

/**
 * Where a link went, read from the slices it is given: a backlog story is
 * done once its status is done, an interrupt once it is resolved. A link on
 * another route, or whose item is gone, reads as gone. The one reading the
 * page, the next step and Amr share.
 */
export function linkState(link: HandoffLink, slices: BugLinkSlices): LinkState {
  if (link.route === "backlog-story") {
    const s = slices.stories.find((x) => x.id === link.targetId);
    return !s ? "gone" : s.status === "done" ? "done" : "live";
  }
  if (link.route === "interrupt") {
    const i = slices.interrupts.find((x) => x.id === link.targetId);
    return !i ? "gone" : i.resolvedAt ? "done" : "live";
  }
  return "gone";
}

/** The bug's links with their state, gone ones included. */
export function bugLinks(
  bug: Pick<BugReport, "sentTo">,
  slices: BugLinkSlices
): { link: HandoffLink; state: LinkState }[] {
  return (bug.sentTo ?? []).map((link) => ({ link, state: linkState(link, slices) }));
}

/** The link on `route` whose item is still there (live or done). */
export function keptLink(
  bug: Pick<BugReport, "sentTo">,
  route: BugRoute,
  slices: BugLinkSlices
): HandoffLink | undefined {
  return (bug.sentTo ?? []).find((l) => l.route === route && linkState(l, slices) !== "gone");
}

/** Sent somewhere that still has it. */
export const wentSomewhere = (bug: Pick<BugReport, "sentTo">, slices: BugLinkSlices): boolean =>
  bugLinks(bug, slices).some((x) => x.state !== "gone");

/** Open, and the work it was sent as is done: "Fixed? Its work is done". */
export function workDone(bug: BugReport, slices: BugLinkSlices): boolean {
  return isOpen(bug) && bugLinks(bug, slices).some((x) => x.state === "done");
}

/* ── Duplicates ──────────────────────────────────────────────────────── */

/**
 * For each open bug that reads like an older one, the older one's id: the
 * near-duplicate finder (Audience Wall's, without AI) run on the titles,
 * oldest first, so the bug logged first is the one the others repeat.
 */
export function duplicateHints(bugs: readonly BugReport[]): Map<string, string> {
  const open = oldestFirst(bugs.filter(isOpen));
  const out = new Map<string, string>();
  for (const g of duplicateGroups(open.map((b) => ({ id: b.id, text: b.title })))) {
    for (const id of g.merge) out.set(id, g.keep);
  }
  return out;
}

/* ── Changes, as the page and Amr make them ──────────────────────────── */

/** Place a bug: triaged, with its severity, priority and checks, stamped now. */
export function triageBug(
  bug: BugReport,
  placed: { severity: BugSeverity; priority: BugPriority; checks?: BugChecks },
  now: string
): BugReport {
  const next: BugReport = {
    ...bug,
    severity: placed.severity,
    priority: placed.priority,
    status: "triaged",
    triagedAt: bug.status === "triaged" && bug.triagedAt ? bug.triagedAt : now,
    updatedAt: now,
  };
  const checks = readChecks(placed.checks ?? bug.checks);
  if (checks) next.checks = checks;
  else delete next.checks;
  return next;
}

/** Close a bug with a reason (a duplicate names the bug it repeats). */
export function closeBug(
  bug: BugReport,
  reason: BugCloseReason,
  now: string,
  duplicateOf?: string
): BugReport {
  const next: BugReport = { ...bug, status: "closed", closeReason: reason, closedAt: now };
  next.updatedAt = now;
  if (reason === "duplicate" && duplicateOf) next.duplicateOf = duplicateOf;
  else delete next.duplicateOf;
  return next;
}

/** Open a closed bug again: back on the grid when it was placed, else in the queue. */
export function reopenBug(bug: BugReport, now: string): BugReport {
  const { closeReason: _reason, duplicateOf: _dup, closedAt: _closed, ...rest } = bug;
  void _reason;
  void _dup;
  void _closed;
  return {
    ...rest,
    status: bug.severity && bug.priority && bug.triagedAt ? "triaged" : "new",
    updatedAt: now,
  };
}

/** Why a duplicate close can't go, or null: it needs another bug that exists. */
export function duplicateProblem(
  bug: Pick<BugReport, "id">,
  duplicateOf: string | undefined,
  bugs: readonly Pick<BugReport, "id">[]
): string | null {
  if (!duplicateOf) return "Pick the bug it repeats.";
  if (duplicateOf === bug.id) return "A bug can't repeat itself: pick another one.";
  if (!bugs.some((b) => b.id === duplicateOf)) return "That bug isn't here any more.";
  return null;
}

/* ── The log form ────────────────────────────────────────────────────── */

export interface BugDraft {
  title: string;
  steps: string;
  expected: string;
  actual: string;
  environment: string;
  area: string;
  reportedBy: string;
}

export const EMPTY_BUG_DRAFT: BugDraft = {
  title: "",
  steps: "",
  expected: "",
  actual: "",
  environment: "",
  area: "",
  reportedBy: "",
};

export type BugValues = Pick<BugReport, "title"> &
  Partial<Pick<BugReport, "steps" | "expected" | "actual" | "environment" | "area" | "reportedBy">>;

const TEXT_FIELDS = ["steps", "expected", "actual"] as const;
const SHORT_FIELDS = ["environment", "area", "reportedBy"] as const;

/** A bug to log: a title on one line, each field within the caps the CRUD holds. */
export function validateBugDraft(draft: BugDraft): Validation<BugValues, keyof BugDraft> {
  const errors: Partial<Record<keyof BugDraft, string>> = {};
  const title = oneLine(draft.title);
  if (title === "") errors.title = "Say what's wrong in a line.";
  else if (title.length > TOOL_TEXT_MAX.short) {
    errors.title = `Keep it to ${TOOL_TEXT_MAX.short} characters; the details go below.`;
  }
  for (const f of TEXT_FIELDS) {
    if (draft[f].trim().length > TOOL_TEXT_MAX.text) {
      errors[f] = `Keep it to ${TOOL_TEXT_MAX.text} characters.`;
    }
  }
  for (const f of SHORT_FIELDS) {
    if (oneLine(draft[f]).length > TOOL_TEXT_MAX.short) {
      errors[f] = `Keep it to ${TOOL_TEXT_MAX.short} characters.`;
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const values: BugValues = { title };
  for (const f of TEXT_FIELDS) {
    const v = draft[f].trim();
    if (v) values[f] = v;
  }
  for (const f of SHORT_FIELDS) {
    const v = oneLine(draft[f]);
    if (v) values[f] = v;
  }
  return { ok: true, values };
}

/** A new bug from the form's values: new and untriaged, stamped now. */
export function newBug(values: BugValues, id: string, now: string): BugReport {
  return { ...values, id, status: "new", createdAt: now, updatedAt: now };
}

/* ── Counts ──────────────────────────────────────────────────────────── */

export interface BugCounts {
  open: number;
  toTriage: number;
  onGrid: number;
  closed: number;
  overTarget: number;
}

export function bugCounts(bugs: readonly BugReport[], today: string): BugCounts {
  return {
    open: bugs.filter(isOpen).length,
    toTriage: bugs.filter(needsTriage).length,
    onGrid: bugs.filter(onGrid).length,
    closed: bugs.filter((b) => !isOpen(b)).length,
    overTarget: bugs.filter((b) => overTarget(b, today)).length,
  };
}

/** The bugs to count: the team's own, the example's only while there are none. */
export function countedBugs(bugs: readonly BugReport[]): BugReport[] {
  const own = bugs.filter((b) => !isExampleId(b.id));
  return own.length > 0 ? own : [...bugs];
}

/* ── Next steps ──────────────────────────────────────────────────────── */

/** What Bug Triage's next-step rule reads from the workspace. */
export interface BugTriageStepsInput {
  bugs: readonly BugReport[] | undefined;
  stories: readonly Story[];
  interrupts: readonly InterruptItem[] | undefined;
}

/** A new bug waiting more than this many days is a nudge to triage. */
export const TRIAGE_NUDGE_DAYS = 2;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const shortTitle = (t: string, max = 48) =>
  t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;

/**
 * Bug Triage's next steps, given today (YYYY-MM-DD), for the team's own bugs:
 *   1. new bugs waiting more than two days → triage them;
 *   2. an open critical bug that went nowhere → decide what happens to it;
 *   3. open bugs whose work is done → close them as fixed.
 */
export function bugTriageSteps(s: BugTriageStepsInput, today: string): NextStep[] {
  const bugs = readBugs(s.bugs).filter((b) => !isExampleId(b.id));
  const slices: BugLinkSlices = { stories: s.stories ?? [], interrupts: s.interrupts ?? [] };
  const steps: NextStep[] = [];

  const waiting = triageQueue(bugs).filter((b) => ageDays(b, today) > TRIAGE_NUDGE_DAYS);
  if (waiting.length > 0) {
    const oldest = ageDays(waiting[0], today);
    steps.push({
      id: "bug-triage-new",
      label: `Triage ${waiting.length} new ${plural(waiting.length, "bug", "bugs")}`,
      detail: `The oldest has waited ${oldest} days.`,
      href: "/bug-triage",
    });
  }

  const stranded = oldestFirst(
    bugs.filter((b) => isOpen(b) && b.severity === "critical" && !wentSomewhere(b, slices))
  )[0];
  if (stranded) {
    steps.push({
      id: "bug-triage-critical",
      label: `Decide what happens to “${shortTitle(stranded.title)}”`,
      detail: "A critical bug that hasn't gone to the sprint or the backlog.",
      href: `/bug-triage?bug=${encodeURIComponent(stranded.id)}`,
    });
  }

  const fixed = bugs.filter((b) => workDone(b, slices));
  if (fixed.length > 0) {
    steps.push({
      id: "bug-triage-fixed",
      label: `Close ${fixed.length} fixed ${plural(fixed.length, "bug", "bugs")}`,
      detail: "Their story is done or their interrupt is resolved.",
      href: "/bug-triage",
    });
  }
  return steps;
}
