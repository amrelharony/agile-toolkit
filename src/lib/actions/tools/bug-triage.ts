/**
 * Bug Triage — tool-local actions.
 *
 * Category: Quality Engineering
 *
 * Agent surface: tool.bug_triage.*
 *   1. list_state — the grid's counts per cell with each cell's advice, and
 *                   the bugs with their place (queue, grid, closed), age,
 *                   fix-by target, where each went and whether that item is
 *                   still there or done.
 *   2. log_bug    — log a new bug, as the page's quick log does.
 *   3. triage     — place a bug on the grid: severity, priority, checks.
 *   4. suggest    — a severity, a priority and a likely duplicate for the
 *                   bugs waiting, by the page's rules (no AI). Read only.
 *   5. send       — fix now as an interrupt in the running sprint, or plan it
 *                   as a backlog story tagged bug.
 *   6. close      — close a bug with a reason (a duplicate names the bug).
 *   7. reopen     — open a closed bug again.
 * Backing CRUD: workspace.bug_report.* (defineCrudActions in
 * workspace/index.ts: create, list, update, delete, each write stamped).
 *
 * One store: workspace.bugReports (kind "workspace:bugReport"). Where a bug
 * went is read from the stories and interrupts (lib/bug-triage/model
 * `linkState`), never stored twice. Over MCP the targets are the user's rows
 * on the server, as Parking Lot writes them. Example bugs (ids "example-…")
 * are never sent. History is the page's to log, not these verbs'.
 *
 * Only the two routes a bug goes by are imported, never the whole hand-off
 * registry, whose other targets reach browser-only modules.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  BUG_CLOSE_REASONS,
  BUG_PRIORITIES,
  BUG_REACH,
  BUG_REPORT_KIND,
  BUG_SEVERITIES,
  INTERRUPT_ITEM_KIND,
  TOOL_TEXT_MAX,
  type BugReport,
  type HandoffLink,
  type InterruptItem,
  type Sprint,
  type Story,
} from "@/lib/stores/workspace-types";
import { withLink } from "@/lib/handoffs/links";
import { backlogStoryRoute, buildBacklogStory } from "@/lib/handoffs/targets/backlog-story";
import {
  activeSprintOf,
  buildInterruptItem,
  interruptRoute,
} from "@/lib/handoffs/targets/interrupt";
import { stampStoryWrite } from "@/lib/sprints/story-status";
import { cleanStoryFields } from "@/lib/stories/fields";
import { isExampleId } from "@/lib/utils/example-id";
import { todayIso } from "@/lib/sprints/series";
import {
  BUG_ROUTES,
  CELL_ADVICE,
  FIX_BY_DAYS,
  ageDays,
  bugCounts,
  bugLinks,
  bugSource,
  closeBug,
  countedBugs,
  duplicateProblem,
  fixByDay,
  gridCounts,
  keptLink,
  mismatched,
  newBug,
  oldestFirst,
  oneLine,
  overTarget,
  placeOf,
  readBugs,
  reopenBug,
  routeFor,
  triageBug,
  triageQueue,
  workDone,
  type BugLinkSlices,
  type BugRoute,
} from "@/lib/bug-triage/model";
import { fallbackSeverity, severityAsk } from "@/lib/ai/tasks/bug-triage.lite";

const KIND_STORY = "workspace:story";
const KIND_SPRINT = "workspace:sprint";

const ws = () => useWorkspaceStore.getState();

type Out = Record<string, unknown>;

/* ── The store adapter ───────────────────────────────────────────────── */

/** Where the bugs (and the items they were sent to) live: the browser's workspace, or the server. */
interface BugStore {
  bugs(): Promise<BugReport[]>;
  put(bug: BugReport): Promise<void>;
  /** The stories and interrupts a bug's links are read from. */
  slices(): Promise<BugLinkSlices>;
  /** Make the item a route makes for the bug: its id and where it opens, or null with no sprint running. */
  send(route: BugRoute, bug: BugReport): Promise<{ targetId: string; href: string } | null>;
}

const browserStore: BugStore = {
  bugs: async () => readBugs(ws().bugReports),
  put: async (bug) => ws().upsertBugReport(bug),
  slices: async () => ({ stories: ws().stories, interrupts: ws().interruptItems ?? [] }),
  // The routes themselves, as the page's sends call them (no toast: an agent has no Undo).
  send: async (route, bug) => {
    const src = bugSource(bug);
    if (route === "interrupt") {
      if (interruptRoute.problem?.(src)) return null;
      const targetId = interruptRoute.send(src);
      return { targetId, href: interruptRoute.targetHref(targetId) };
    }
    const targetId = backlogStoryRoute.send(src);
    return { targetId, href: backlogStoryRoute.targetHref(targetId) };
  },
};

function serverStore(userId: string): BugStore {
  let stories: Promise<Story[]> | undefined;
  let interrupts: Promise<InterruptItem[]> | undefined;
  const loadStories = () => (stories ??= serverListEntities<Story>(userId, KIND_STORY));
  const loadInterrupts = () =>
    (interrupts ??= serverListEntities<InterruptItem>(userId, INTERRUPT_ITEM_KIND));
  return {
    bugs: async () => readBugs(await serverListEntities<BugReport>(userId, BUG_REPORT_KIND)),
    put: async (bug) => {
      await serverUpsertEntity<BugReport>(userId, BUG_REPORT_KIND, bug);
    },
    slices: async () => ({ stories: await loadStories(), interrupts: await loadInterrupts() }),
    send: async (route, bug) => {
      const src = bugSource(bug);
      if (route === "interrupt") {
        const sprint = activeSprintOf(await serverListEntities<Sprint>(userId, KIND_SPRINT));
        if (!sprint) return null;
        const item = buildInterruptItem(src, sprint.id);
        await serverUpsertEntity<InterruptItem>(userId, INTERRUPT_ITEM_KIND, item);
        interrupts = undefined;
        return {
          targetId: item.id,
          href: `/interrupt-buffer?sprint=${encodeURIComponent(sprint.id)}`,
        };
      }
      // Stamped as the browser's store stamps a new story, so Backlog Health
      // can date it.
      const story = stampStoryWrite(cleanStoryFields(buildBacklogStory(src)), undefined);
      await serverUpsertEntity<Story>(userId, KIND_STORY, story);
      stories = undefined;
      return { targetId: story.id, href: backlogStoryRoute.targetHref(story.id) };
    },
  };
}

const nowIso = () => new Date().toISOString();

const BugId = z.string().min(1).describe("The bug's id (see list_state).");

/* ── tool.bug_triage.list_state ──────────────────────────────────────── */

const STATUS_FILTER = ["new", "triaged", "closed", "open", "all"] as const;

const ListParams = z.object({
  status: z.enum(STATUS_FILTER).optional().describe("open: new and triaged; default all."),
  severity: z.enum(BUG_SEVERITIES).optional(),
  priority: z.enum(BUG_PRIORITIES).optional(),
});

async function listState(store: BugStore, params: z.infer<typeof ListParams>): Promise<Out> {
  const all = oldestFirst(await store.bugs());
  const slices = await store.slices();
  const today = todayIso();
  const status = params.status ?? "all";
  const shown = all.filter(
    (b) =>
      (status === "all" || (status === "open" ? b.status !== "closed" : b.status === status)) &&
      (!params.severity || b.severity === params.severity) &&
      (!params.priority || b.priority === params.priority)
  );
  const counted = countedBugs(all);
  const grid = gridCounts(counted);
  return {
    counts: bugCounts(counted, today),
    examples: all.filter((b) => isExampleId(b.id)).length,
    cells: BUG_SEVERITIES.flatMap((severity) =>
      BUG_PRIORITIES.map((priority) => ({
        severity,
        priority,
        open: grid[severity][priority],
        advice: CELL_ADVICE[severity][priority],
        check: mismatched(severity, priority),
      }))
    ),
    bugs: shown.map((b) => ({
      id: b.id,
      title: b.title,
      steps: b.steps ?? null,
      expected: b.expected ?? null,
      actual: b.actual ?? null,
      environment: b.environment ?? null,
      area: b.area ?? null,
      reportedBy: b.reportedBy ?? null,
      status: b.status,
      place: placeOf(b),
      severity: b.severity ?? null,
      priority: b.priority ?? null,
      checks: b.checks ?? null,
      ageDays: ageDays(b, today),
      fixBy: fixByDay(b),
      overTarget: overTarget(b, today),
      workDone: workDone(b, slices),
      closeReason: b.closeReason ?? null,
      duplicateOf: b.duplicateOf ?? null,
      from: b.sourceRef ?? null,
      example: isExampleId(b.id),
      createdAt: b.createdAt,
      triagedAt: b.triagedAt ?? null,
      closedAt: b.closedAt ?? null,
      sentTo: bugLinks(b, slices).map(({ link, state }) => ({
        route: link.route,
        targetId: link.targetId,
        at: link.at,
        target: state,
      })),
    })),
  };
}

registry.register({
  id: "tool.bug_triage.list_state",
  toolId: "tool.bug_triage",
  name: "list_state",
  category: "read",
  description: `List Bug Triage as the page shows it, oldest first. Params: status? (new | triaged | closed | open | all; default all), severity?, priority?. Returns {counts: {open, toTriage, onGrid, closed, overTarget} (the team's own bugs, the example's only while there are none), examples (example bugs loaded), cells: {severity, priority, open, advice, check}[] (the 4 × 4 grid; check is true where the two don't sit well together), bugs: {id, title, steps, expected, actual, environment, area, reportedBy, status, place: 'queue' | 'grid' | 'closed', severity, priority, checks, ageDays, fixBy (YYYY-MM-DD, from the fix-by targets: critical ${FIX_BY_DAYS.critical} days, major ${FIX_BY_DAYS.major}, minor ${FIX_BY_DAYS.minor}, cosmetic none), overTarget, workDone (the story or interrupt it went to is done: offer to close it as fixed), closeReason, duplicateOf, from (the item it was sent from) | null, example, createdAt, triagedAt, closedAt, sentTo: {route: 'interrupt' | 'backlog-story', targetId, at, target: 'live' | 'done' | 'gone'}[]}[]}.`,
  paramsSchema: ListParams,
  handler: async (params) => listState(browserStore, params),
  mcpHandler: async (params, ctx) => listState(serverStore(ctx.userId), params),
});

/* ── tool.bug_triage.log_bug ─────────────────────────────────────────── */

const Short = z.string().max(TOOL_TEXT_MAX.short);
const Text = z.string().max(TOOL_TEXT_MAX.text);

const LogParams = z.object({
  title: Short.refine((v) => oneLine(v) !== "", { message: "can't be blank" }).describe(
    "The bug in one line."
  ),
  steps: Text.optional().describe("How to make it happen."),
  expected: Text.optional().describe("What should have happened."),
  actual: Text.optional().describe("What happened instead."),
  environment: Short.optional().describe("Where: the device, browser or environment."),
  area: Short.optional().describe("The product area."),
  reportedBy: Short.optional().describe("Who found it."),
});

async function logBug(store: BugStore, p: z.infer<typeof LogParams>): Promise<Out> {
  const text = (v: string | undefined) => (v ?? "").trim();
  const values = {
    title: oneLine(p.title),
    ...(text(p.steps) ? { steps: text(p.steps) } : {}),
    ...(text(p.expected) ? { expected: text(p.expected) } : {}),
    ...(text(p.actual) ? { actual: text(p.actual) } : {}),
    ...(oneLine(p.environment ?? "") ? { environment: oneLine(p.environment ?? "") } : {}),
    ...(oneLine(p.area ?? "") ? { area: oneLine(p.area ?? "") } : {}),
    ...(oneLine(p.reportedBy ?? "") ? { reportedBy: oneLine(p.reportedBy ?? "") } : {}),
  };
  const bug = newBug(values, `bug_${nanoid(8)}`, nowIso());
  await store.put(bug);
  return { logged: true, id: bug.id, status: bug.status };
}

registry.register({
  id: "tool.bug_triage.log_bug",
  toolId: "tool.bug_triage",
  name: "log_bug",
  category: "write",
  requiresConfirmation: false,
  description:
    "Log a new bug in Bug Triage, as the page's quick log does: new and untriaged, waiting in the triage queue. Params: title (one line), steps?, expected?, actual?, environment?, area?, reportedBy?. Returns {logged: true, id, status: 'new'}. Then triage places it on the grid.",
  paramsSchema: LogParams,
  handler: async (p) => logBug(browserStore, p),
  mcpHandler: async (p, ctx) => logBug(serverStore(ctx.userId), p),
});

/* ── tool.bug_triage.triage ──────────────────────────────────────────── */

const ChecksParam = z
  .object({
    dataLoss: z.boolean().optional().describe("It loses, damages or leaks data."),
    security: z.boolean().optional().describe("It is a security or privacy hole."),
    workaround: z.boolean().optional().describe("People can get round it."),
    blocksRelease: z.boolean().optional().describe("It blocks a release or a demo."),
    reach: z.enum(BUG_REACH).optional().describe("How many people hit it."),
  })
  .describe("The quick checks.");

const TriageParams = z.object({
  id: BugId,
  severity: z.enum(BUG_SEVERITIES).describe("How bad it is."),
  priority: z.enum(BUG_PRIORITIES).describe("How soon it needs fixing."),
  checks: ChecksParam.optional(),
});

async function triage(store: BugStore, p: z.infer<typeof TriageParams>): Promise<Out> {
  const bug = (await store.bugs()).find((b) => b.id === p.id);
  if (!bug) return { triaged: false, reason: "not_found" };
  if (bug.status === "closed") {
    return { triaged: false, reason: "closed", message: "Reopen it first (reopen)." };
  }
  const next = triageBug(bug, p, nowIso());
  await store.put(next);
  return {
    triaged: true,
    id: next.id,
    severity: p.severity,
    priority: p.priority,
    advice: CELL_ADVICE[p.severity][p.priority],
    check: mismatched(p.severity, p.priority),
    route: routeFor(p.priority),
  };
}

registry.register({
  id: "tool.bug_triage.triage",
  toolId: "tool.bug_triage",
  name: "triage",
  category: "write",
  requiresConfirmation: false,
  description:
    "Place a bug on the triage grid, as the page's Save does: its severity (critical | major | minor | cosmetic: how bad), priority (now | next | later | someday: how soon) and the quick checks, and mark it triaged. A closed bug is refused ('closed'). Params: id, severity, priority, checks? {dataLoss?, security?, workaround?, blocksRelease?, reach?: one | some | many | all}. Returns {triaged: true, id, severity, priority, advice (the cell's), check (the two don't sit well together: say so), route ('interrupt' for now, 'backlog-story' for next or later, null for some day: then suggest close)} or {triaged: false, reason: 'not_found' | 'closed'}.",
  paramsSchema: TriageParams,
  handler: async (p) => triage(browserStore, p),
  mcpHandler: async (p, ctx) => triage(serverStore(ctx.userId), p),
});

/* ── tool.bug_triage.suggest ─────────────────────────────────────────── */

const SuggestParams = z.object({
  ids: z
    .array(z.string().min(1))
    .max(20)
    .optional()
    .describe("The bugs to suggest for; default the triage queue, oldest first."),
});

async function suggest(store: BugStore, p: z.infer<typeof SuggestParams>): Promise<Out> {
  const all = await store.bugs();
  const own = all.filter((b) => !isExampleId(b.id));
  const queue = p.ids
    ? oldestFirst(own.filter((b) => p.ids!.includes(b.id) && b.status !== "closed"))
    : triageQueue(own);
  const ask = severityAsk(queue, own);
  if (!ask) return { suggestions: [] };
  const titles = new Map(own.map((b) => [b.id, b.title]));
  return {
    suggestions: fallbackSeverity(ask).suggestions.map((s) => ({
      ...s,
      title: titles.get(s.id) ?? null,
      duplicateOfTitle: s.duplicateOf ? (titles.get(s.duplicateOf) ?? null) : null,
    })),
  };
}

registry.register({
  id: "tool.bug_triage.suggest",
  toolId: "tool.bug_triage",
  name: "suggest",
  category: "read",
  description:
    "Suggest a severity, a priority and a likely duplicate for bugs waiting to be triaged, by the page's rules (what Suggest without AI gives): the quick checks first (data loss or a security hole is critical; blocking a release is at least major), then the bug's words, then the priority that goes with the severity; a title that reads like an older open bug's names it. Only suggests: confirm with the user, then use triage, or close with reason duplicate. Example bugs are left out. Params: ids? (default the triage queue). Returns {suggestions: {id, title, severity, priority, reason, duplicateOf?, duplicateOfTitle}[]}.",
  paramsSchema: SuggestParams,
  handler: async (p) => suggest(browserStore, p),
  mcpHandler: async (p, ctx) => suggest(serverStore(ctx.userId), p),
});

/* ── tool.bug_triage.send ────────────────────────────────────────────── */

const SendParams = z.object({
  id: BugId,
  route: z
    .enum(BUG_ROUTES)
    .describe(
      "interrupt: fix it now, logged as an interrupt in the running sprint (priority now); backlog-story: plan it, a backlog story tagged bug (priority next or later)."
    ),
});

async function send(store: BugStore, p: z.infer<typeof SendParams>): Promise<Out> {
  const bug = (await store.bugs()).find((b) => b.id === p.id);
  if (!bug) return { sent: false, reason: "not_found" };
  if (isExampleId(bug.id)) return { sent: false, reason: "example" };
  if (bug.status === "closed") return { sent: false, reason: "closed" };
  const kept = keptLink(bug, p.route, await store.slices());
  if (kept) return { sent: false, reason: "already_sent", targetId: kept.targetId };
  const made = await store.send(p.route, bug);
  if (!made) {
    return {
      sent: false,
      reason: "no_sprint",
      message: "No sprint is running: plan it on the backlog instead (route backlog-story).",
    };
  }
  const link: HandoffLink = { route: p.route, targetId: made.targetId, at: nowIso() };
  await store.put({ ...bug, sentTo: withLink(bug.sentTo, link), updatedAt: nowIso() });
  return { sent: true, route: p.route, targetId: made.targetId, href: made.href };
}

registry.register({
  id: "tool.bug_triage.send",
  toolId: "tool.bug_triage",
  name: "send",
  category: "write",
  requiresConfirmation: false,
  description:
    "Send a bug on, as the page does for its cell: fix now logs it as an interrupt in the running sprint (route interrupt; a critical bug counts as an emergency), next or later adds it to the backlog as a story tagged bug with its steps and what happened as notes (route backlog-story). The new item links back to the bug, and the bug records where it went (sentTo); its work done there shows in list_state as workDone. Example and closed bugs are never sent. Params: id, route. Returns {sent: true, route, targetId, href} or {sent: false, reason: 'not_found' | 'example' | 'closed' | 'already_sent' | 'no_sprint', targetId?, message?}.",
  paramsSchema: SendParams,
  handler: async (p) => send(browserStore, p),
  mcpHandler: async (p, ctx) => send(serverStore(ctx.userId), p),
});

/* ── tool.bug_triage.close ───────────────────────────────────────────── */

const CloseParams = z.object({
  id: BugId,
  reason: z.enum(BUG_CLOSE_REASONS).describe("Why it is closed."),
  duplicateOf: z
    .string()
    .min(1)
    .max(TOOL_TEXT_MAX.short)
    .optional()
    .describe("The bug it repeats (reason duplicate): another bug's id."),
});

async function close(store: BugStore, p: z.infer<typeof CloseParams>): Promise<Out> {
  const all = await store.bugs();
  const bug = all.find((b) => b.id === p.id);
  if (!bug) return { closed: false, reason: "not_found" };
  if (bug.status === "closed") return { closed: false, reason: "already_closed" };
  if (p.reason === "duplicate") {
    const problem = duplicateProblem(bug, p.duplicateOf, all);
    if (problem) return { closed: false, reason: "duplicate_of", message: problem };
  }
  await store.put(closeBug(bug, p.reason, nowIso(), p.duplicateOf));
  return { closed: true, id: bug.id, reason: p.reason };
}

registry.register({
  id: "tool.bug_triage.close",
  toolId: "tool.bug_triage",
  name: "close",
  category: "write",
  requiresConfirmation: false,
  description:
    "Close a bug with a reason, as the page does: fixed, duplicate (give duplicateOf, the id of the bug it repeats), cant-reproduce, wont-fix or not-a-bug. Params: id, reason, duplicateOf?. Returns {closed: true, id, reason} or {closed: false, reason: 'not_found' | 'already_closed' | 'duplicate_of', message?}.",
  paramsSchema: CloseParams,
  handler: async (p) => close(browserStore, p),
  mcpHandler: async (p, ctx) => close(serverStore(ctx.userId), p),
});

/* ── tool.bug_triage.reopen ──────────────────────────────────────────── */

async function reopen(store: BugStore, p: { id: string }): Promise<Out> {
  const bug = (await store.bugs()).find((b) => b.id === p.id);
  if (!bug) return { reopened: false, reason: "not_found" };
  if (bug.status !== "closed") return { reopened: false, reason: "open" };
  const next = reopenBug(bug, nowIso());
  await store.put(next);
  return { reopened: true, id: next.id, status: next.status };
}

registry.register({
  id: "tool.bug_triage.reopen",
  toolId: "tool.bug_triage",
  name: "reopen",
  category: "write",
  requiresConfirmation: false,
  description:
    "Open a closed bug again: back on the grid in its cell when it was triaged, otherwise in the triage queue. Its close reason goes. Params: id. Returns {reopened: true, id, status} or {reopened: false, reason: 'not_found' | 'open'}.",
  paramsSchema: z.object({ id: BugId }),
  handler: async (p) => reopen(browserStore, p),
  mcpHandler: async (p, ctx) => reopen(serverStore(ctx.userId), p),
});
