/**
 * Hill Chart — tool-local actions.
 *
 * Category: Flow & Delivery
 *
 * Agent surface: tool.hill_chart.*
 *   1. list_state  — the charts (newest first), each scope with its side,
 *                    days since it moved, the stuck flag, its linked story's
 *                    status and whether they disagree, and the last check-in.
 *   2. add_scope   — add a piece of work to a chart.
 *   3. move_scope  — move a scope on the hill, as dragging its dot does.
 *   4. check_in    — save today's positions with a note (one per day).
 *   5. raise_stuck — raise a stuck scope as an impediment, as the page's
 *                    "Raise as an impediment" does.
 * Backing CRUD: workspace.hill_chart.* (create, archive and delete charts).
 *
 * Every rule comes from lib/hill-chart/model, the module the page and the
 * next step read, so an agent reports what the page shows. Over MCP the
 * charts and the impediment are the user's rows on the server. Only the
 * impediment route is imported, never the hand-off registry (its other
 * targets reach browser-only modules the MCP route must not load).
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  HILL_CHART_KIND,
  TOOL_TEXT_MAX,
  type HandoffLink,
  type HillChart,
  type Impediment,
  type Story,
} from "@/lib/stores/workspace-types";
import { withLink } from "@/lib/handoffs/links";
import type { HandoffSource } from "@/lib/handoffs/types";
import { buildImpediment, impedimentRoute } from "@/lib/handoffs/targets/impediment";
import { isResolved } from "@/lib/impediments/model";
import { isExampleId } from "@/lib/utils/example-id";
import {
  HILL_CHECK_IN_ID_PREFIX,
  HILL_SCOPE_ID_PREFIX,
  checkIn,
  clampPosition,
  daysSinceMove,
  hasRoomForScope,
  isStuck,
  lastCheckIn,
  moveScope,
  newScope,
  readHillChart,
  readHillCharts,
  reachedDone,
  scopeMismatch,
  scopeSource,
  sideOf,
} from "@/lib/hill-chart/model";

/** MUST match registerCollection("story", …) and ("impediment", …) in workspace-store.ts. */
const KIND_STORY = "workspace:story";
const KIND_IMPEDIMENT = "workspace:impediment";

const ws = () => useWorkspaceStore.getState();

type Out = Record<string, unknown>;
type TargetState = "gone" | "live" | "done";

/** Where the charts (and the stories and impediments they link) live: the browser, or the server. */
interface HillStore {
  charts(): Promise<HillChart[]>;
  put(chart: HillChart): Promise<void>;
  stories(): Promise<Story[]>;
  /** An impediment link's target as it is now. */
  target(link: HandoffLink): Promise<TargetState>;
  /** Raise the impediment for `src`; returns its id. */
  raise(src: HandoffSource): Promise<string>;
}

const browserStore: HillStore = {
  charts: async () => ws().hillCharts ?? [],
  put: async (chart) => ws().upsertHillChart(chart),
  stories: async () => ws().stories ?? [],
  target: async (link) => {
    if (link.route !== "impediment" || !impedimentRoute.exists(link.targetId)) return "gone";
    return impedimentRoute.isDone?.(link.targetId) ? "done" : "live";
  },
  // The route itself, as the page's send calls it (no toast: an agent has no Undo).
  raise: async (src) => impedimentRoute.send(src),
};

function serverStore(userId: string): HillStore {
  let impediments: Promise<Impediment[]> | undefined;
  const loadImpediments = () =>
    (impediments ??= serverListEntities<Impediment>(userId, KIND_IMPEDIMENT));
  return {
    charts: () => serverListEntities<HillChart>(userId, HILL_CHART_KIND),
    put: async (chart) => {
      await serverUpsertEntity<HillChart>(userId, HILL_CHART_KIND, chart);
    },
    stories: () => serverListEntities<Story>(userId, KIND_STORY),
    target: async (link) => {
      if (link.route !== "impediment") return "gone";
      const i = (await loadImpediments()).find((x) => x.id === link.targetId);
      return !i ? "gone" : isResolved(i) ? "done" : "live";
    },
    raise: async (src) => {
      const impediment = buildImpediment(src);
      await serverUpsertEntity<Impediment>(userId, KIND_IMPEDIMENT, impediment);
      impediments = undefined;
      return impediment.id;
    },
  };
}

/** The chart by id as the page reads it (written back as read: unreadable parts dropped). */
async function findChart(store: HillStore, chartId: string): Promise<{ chart: HillChart } | null> {
  const raw = (await store.charts()).find((c) => c.id === chartId);
  const chart = raw ? readHillChart(raw) : null;
  return chart ? { chart } : null;
}

const stamped = (chart: HillChart, at = new Date().toISOString()): HillChart => ({
  ...chart,
  updatedAt: at,
});

const NOT_FOUND = { reason: "not_found", message: "No hill chart with that id (see list_state)." };

/* ── tool.hill_chart.list_state ──────────────────────────────────────── */

const ListParams = z.object({
  chartId: z.string().max(200).optional().describe("Only this chart. Left out: every chart."),
});

async function listState(store: HillStore, params: z.infer<typeof ListParams>): Promise<Out> {
  const now = new Date();
  const all = readHillCharts(await store.charts());
  const shown = params.chartId ? all.filter((c) => c.id === params.chartId) : all;
  const stories = new Map((await store.stories()).map((s) => [s.id, s]));
  return {
    charts: await Promise.all(
      shown.map(async (c) => {
        const last = lastCheckIn(c);
        return {
          id: c.id,
          title: c.title,
          about: c.about ?? null,
          sprintId: c.sprintId ?? null,
          epicId: c.epicId ?? null,
          archived: c.archived === true,
          example: isExampleId(c.id),
          checkIns: c.checkIns.length,
          lastCheckIn: last ? { at: last.at, note: last.note ?? null } : null,
          scopes: await Promise.all(
            c.scopes.map(async (s) => {
              const story = s.storyId ? stories.get(s.storyId) : undefined;
              return {
                id: s.id,
                title: s.title,
                position: s.position,
                side: sideOf(s.position),
                daysSinceMove: daysSinceMove(s, now),
                stuck: isStuck(s, now),
                note: s.note ?? null,
                storyId: s.storyId ?? null,
                storyStatus: story?.status ?? null,
                epicId: s.epicId ?? null,
                mismatch: scopeMismatch(s, story),
                sentTo: await Promise.all(
                  (s.sentTo ?? []).map(async (l) => ({
                    route: l.route,
                    targetId: l.targetId,
                    at: l.at,
                    target: await store.target(l),
                  }))
                ),
              };
            })
          ),
        };
      })
    ),
  };
}

registry.register({
  id: "tool.hill_chart.list_state",
  toolId: "tool.hill_chart",
  name: "list_state",
  category: "read",
  description:
    "List the hill charts as the page shows them, newest first. A scope's position is a whole number 0–100: below 50 'uphill' (still working it out), 50–99 'downhill' (getting it done), 100 'done'. A scope is stuck when it is uphill and hasn't moved for 7 days or more; mismatch says its linked story disagrees ('story-done-uphill' or 'scope-done-story-open'). Params: chartId? (only that chart). Returns {charts: {id, title, about, sprintId, epicId, archived, example, checkIns (how many), lastCheckIn: {at, note} | null, scopes: {id, title, position, side, daysSinceMove, stuck, note, storyId, storyStatus, epicId, mismatch, sentTo: {route, targetId, at, target: 'live' | 'done' | 'gone'}[]}[]}[]}. Create, rename, archive or delete a chart with workspace.hill_chart.*.",
  paramsSchema: ListParams,
  handler: async (params) => listState(browserStore, params),
  mcpHandler: async (params, ctx) => listState(serverStore(ctx.userId), params),
});

/* ── tool.hill_chart.add_scope ───────────────────────────────────────── */

const Position = z.number().int().min(0).max(100);

const AddParams = z.object({
  chartId: z.string().min(1).max(200),
  title: z
    .string()
    .max(TOOL_TEXT_MAX.short)
    .refine((v) => v.trim() !== "", { message: "can't be blank" })
    .describe("The piece of work, in a few words."),
  position: Position.optional().describe("Where it starts, 0–100; default 0 (just started)."),
  storyId: z.string().max(TOOL_TEXT_MAX.short).optional().describe("A story it follows."),
  epicId: z.string().max(TOOL_TEXT_MAX.short).optional().describe("An epic it follows."),
});

async function addScope(store: HillStore, params: z.infer<typeof AddParams>): Promise<Out> {
  const found = await findChart(store, params.chartId);
  if (!found) return { added: false, ...NOT_FOUND };
  const { chart } = found;
  if (!hasRoomForScope(chart)) {
    return {
      added: false,
      reason: "full",
      message: "A chart holds 30 scopes. Remove one, or start a chart for the rest.",
    };
  }
  const at = new Date().toISOString();
  const scope = newScope(
    {
      title: params.title,
      position: params.position ?? 0,
      ...(params.storyId ? { storyId: params.storyId } : {}),
      ...(params.epicId ? { epicId: params.epicId } : {}),
    },
    `${HILL_SCOPE_ID_PREFIX}${nanoid(8)}`,
    at
  );
  await store.put(stamped({ ...chart, scopes: [...chart.scopes, scope] }, at));
  return { added: true, scopeId: scope.id, position: scope.position, side: sideOf(scope.position) };
}

registry.register({
  id: "tool.hill_chart.add_scope",
  toolId: "tool.hill_chart",
  name: "add_scope",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a scope (a piece of work) to a hill chart, as the page's Add scope does. Params: chartId, title, position? (0–100, default 0), storyId?, epicId? (what it follows). A chart holds at most 30 scopes. Returns {added: true, scopeId, position, side} or {added: false, reason: 'not_found' | 'full', message}.",
  paramsSchema: AddParams,
  handler: async (params) => addScope(browserStore, params),
  mcpHandler: async (params, ctx) => addScope(serverStore(ctx.userId), params),
});

/* ── tool.hill_chart.move_scope ──────────────────────────────────────── */

const MoveParams = z.object({
  chartId: z.string().min(1).max(200),
  scopeId: z.string().min(1).max(64),
  position: Position.describe("The new position, 0–100: 50 is the top of the hill, 100 is done."),
});

async function move(store: HillStore, params: z.infer<typeof MoveParams>): Promise<Out> {
  const found = await findChart(store, params.chartId);
  if (!found) return { moved: false, ...NOT_FOUND };
  const scope = found.chart.scopes.find((s) => s.id === params.scopeId);
  if (!scope) return { moved: false, reason: "scope_not_found" };
  const to = clampPosition(params.position);
  if (scope.position === to) return { moved: false, reason: "unchanged", position: to };
  const at = new Date().toISOString();
  await store.put(stamped(moveScope(found.chart, scope.id, to, at), at));
  return {
    moved: true,
    from: scope.position,
    to,
    side: sideOf(to),
    done: reachedDone(scope.position, to),
  };
}

registry.register({
  id: "tool.hill_chart.move_scope",
  toolId: "tool.hill_chart",
  name: "move_scope",
  category: "write",
  requiresConfirmation: false,
  description:
    "Move a scope on the hill, as dragging its dot does: stamps when it moved, and marks it done at 100. Params: chartId, scopeId, position (0–100). Returns {moved: true, from, to, side, done (it just reached 100)} or {moved: false, reason: 'not_found' | 'scope_not_found' | 'unchanged'}.",
  paramsSchema: MoveParams,
  handler: async (params) => move(browserStore, params),
  mcpHandler: async (params, ctx) => move(serverStore(ctx.userId), params),
});

/* ── tool.hill_chart.check_in ────────────────────────────────────────── */

const CheckInParams = z.object({
  chartId: z.string().min(1).max(200),
  note: z
    .string()
    .max(TOOL_TEXT_MAX.capture)
    .optional()
    .describe("The week's note, such as what moved and what is stuck."),
});

async function doCheckIn(store: HillStore, params: z.infer<typeof CheckInParams>): Promise<Out> {
  const found = await findChart(store, params.chartId);
  if (!found) return { checkedIn: false, ...NOT_FOUND };
  if (found.chart.scopes.length === 0) {
    return { checkedIn: false, reason: "empty", message: "Add a scope before checking in." };
  }
  const now = new Date();
  const next = checkIn(found.chart, now, params.note, `${HILL_CHECK_IN_ID_PREFIX}${nanoid(8)}`);
  await store.put(stamped(next, now.toISOString()));
  const entry = lastCheckIn(next);
  return {
    checkedIn: true,
    checkInId: entry?.id ?? null,
    at: entry?.at ?? now.toISOString(),
    scopes: entry?.positions.length ?? 0,
    replacedToday: next.checkIns.length === found.chart.checkIns.length,
  };
}

registry.register({
  id: "tool.hill_chart.check_in",
  toolId: "tool.hill_chart",
  name: "check_in",
  category: "write",
  requiresConfirmation: false,
  description:
    "Check in on a hill chart, as the page's Check in does: saves every scope's position now, with an optional note. One check-in per day: a second the same day replaces the first. The oldest is dropped past 52. Params: chartId, note?. Returns {checkedIn: true, checkInId, at, scopes, replacedToday} or {checkedIn: false, reason: 'not_found' | 'empty', message}.",
  paramsSchema: CheckInParams,
  handler: async (params) => doCheckIn(browserStore, params),
  mcpHandler: async (params, ctx) => doCheckIn(serverStore(ctx.userId), params),
});

/* ── tool.hill_chart.raise_stuck ─────────────────────────────────────── */

const RaiseParams = z.object({
  chartId: z.string().min(1).max(200),
  scopeId: z.string().min(1).max(64),
});

async function raiseStuck(store: HillStore, params: z.infer<typeof RaiseParams>): Promise<Out> {
  const found = await findChart(store, params.chartId);
  if (!found) return { raised: false, ...NOT_FOUND };
  const { chart } = found;
  const scope = chart.scopes.find((s) => s.id === params.scopeId);
  if (!scope) return { raised: false, reason: "scope_not_found" };
  if (isExampleId(chart.id)) return { raised: false, reason: "example" };
  const now = new Date();
  if (!isStuck(scope, now)) {
    return {
      raised: false,
      reason: "not_stuck",
      message: "Only a scope that has sat uphill for 7 days or more is raised.",
    };
  }
  const existing = (scope.sentTo ?? []).find((l) => l.route === "impediment");
  if (existing && (await store.target(existing)) !== "gone") {
    return { raised: false, reason: "already_raised", impedimentId: existing.targetId };
  }
  const impedimentId = await store.raise(scopeSource(chart, scope, now));
  const link: HandoffLink = { route: "impediment", targetId: impedimentId, at: now.toISOString() };
  await store.put(
    stamped(
      {
        ...chart,
        scopes: chart.scopes.map((s) =>
          s.id === scope.id ? { ...s, sentTo: withLink(s.sentTo, link) } : s
        ),
      },
      now.toISOString()
    )
  );
  return { raised: true, impedimentId, href: impedimentRoute.targetHref(impedimentId) };
}

registry.register({
  id: "tool.hill_chart.raise_stuck",
  toolId: "tool.hill_chart",
  name: "raise_stuck",
  category: "write",
  requiresConfirmation: false,
  description:
    "Raise a stuck scope as an open impediment of medium severity, as the page's 'Raise as an impediment' does: the impediment says how long it has sat uphill on which chart and links back (sourceRef hill-chart), and the scope records the link (sentTo). Only a stuck scope (uphill, not moved for 7 days or more); never an example chart's. Params: chartId, scopeId. Returns {raised: true, impedimentId, href} or {raised: false, reason: 'not_found' | 'scope_not_found' | 'example' | 'not_stuck' | 'already_raised', impedimentId?, message?}.",
  paramsSchema: RaiseParams,
  handler: async (params) => raiseStuck(browserStore, params),
  mcpHandler: async (params, ctx) => raiseStuck(serverStore(ctx.userId), params),
});
