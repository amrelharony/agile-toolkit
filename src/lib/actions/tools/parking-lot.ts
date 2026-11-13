/**
 * Parking Lot — tool-local actions.
 *
 * Category: Ceremonies
 *
 * Agent surface: tool.parking_lot.*
 *   1. list_state     — the points as the page lists them (oldest first), each
 *                       with where it was sent and whether that item still
 *                       exists or is done; the counts, the meetings and the
 *                       meeting the next point is remembered in.
 *   2. park           — park a point, as the page's quick capture does.
 *   3. set_status     — mark a point discussed, dropped or open again.
 *   4. send           — send a point to the backlog, the Impediment Tracker
 *                       or Retro Actions, as the page's "Send to…" does.
 *   5. suggest_routes — where each open point could go, by the page's
 *                       keyword rules (the AI task's fallback). Pure.
 * Backing CRUD: workspace.parking_lot_item.* (defineCrudActions in
 * workspace/index.ts: create, list, update, delete, each write stamped).
 *
 * One store: workspace.parkingLotItems (kind "workspace:parkingLotItem").
 * A send records a HandoffLink on the point (`sentTo`) and the item there
 * links back (sourceRef parking-lot), exactly as the page's sends do. Over
 * MCP the targets are written to the user's rows on the server. Example
 * points (ids "example-…") are never sent.
 *
 * Only the three routes a point goes by are imported, never the whole
 * hand-off registry: its other targets reach browser-only ("use client")
 * modules, which the MCP route must not load.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { serverListEntities, serverUpsertEntity } from "../server-store";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  PARKING_LOT_ITEM_KIND,
  TOOL_TEXT_MAX,
  type HandoffLink,
  type Impediment,
  type ParkingLotItem,
  type RetroBoard,
  type Story,
} from "@/lib/stores/workspace-types";
import { withLink } from "@/lib/handoffs/links";
import type { HandoffRoute, HandoffSource } from "@/lib/handoffs/types";
import { backlogStoryRoute, buildBacklogStory } from "@/lib/handoffs/targets/backlog-story";
import { buildImpediment, impedimentRoute } from "@/lib/handoffs/targets/impediment";
import { retroActionRoute } from "@/lib/handoffs/targets/retro-action";
import { buildRetroCard } from "@/lib/handoffs/targets/retro-board";
import { isResolved } from "@/lib/impediments/model";
import { stampStoryWrite } from "@/lib/sprints/story-status";
import { cleanStoryFields } from "@/lib/stories/fields";
import { retroFormats } from "@/lib/constants/retro-formats";
import { RETRO_CURRENT_ID, blankRetroBoard, newestArchivedRetro } from "@/lib/retro/board";
import { isExampleId } from "@/lib/utils/example-id";
import {
  PARKING_ROUTES,
  ageDays,
  countedItems,
  isParkingRoute,
  matchesMeeting,
  meetingKey,
  meetingsOf,
  newParkingItem,
  oneLine,
  parkingItems,
  parkingSource,
  parkingSummary,
  rememberedMeeting,
  type ParkingRoute,
} from "@/lib/parking-lot/model";
import { routeByRules } from "@/lib/parking-lot/route-rules";

const KIND_STORY = "workspace:story";
const KIND_IMPEDIMENT = "workspace:impediment";
const KIND_RETRO = "workspace:retroBoard";

const ws = () => useWorkspaceStore.getState();

type Out = Record<string, unknown>;

/** The routes a point goes by, as the hand-off registry holds them. */
const ROUTES: Readonly<Record<ParkingRoute, HandoffRoute>> = {
  "backlog-story": backlogStoryRoute,
  impediment: impedimentRoute,
  "retro-action": retroActionRoute,
};

/* ── The store adapter ───────────────────────────────────────────────── */

/** What a send's target looks like now: gone, there, or there and finished. */
type TargetState = "gone" | "live" | "done";

/** Where the points (and the items they were sent to) live: the browser's workspace, or the server. */
interface ParkingStore {
  items(): Promise<ParkingLotItem[]>;
  put(item: ParkingLotItem): Promise<void>;
  /** A link's target as it is now. */
  target(link: HandoffLink): Promise<TargetState>;
  /** Create the item a route makes for `src`; returns its id. */
  send(route: ParkingRoute, src: HandoffSource): Promise<string>;
}

const browserStore: ParkingStore = {
  items: async () => ws().parkingLotItems ?? [],
  put: async (item) => ws().upsertParkingLotItem(item),
  // A link on any other route is one the page doesn't show either (as on the server).
  target: async (link) => {
    if (!isParkingRoute(link.route)) return "gone";
    const route = ROUTES[link.route];
    if (!route.exists(link.targetId)) return "gone";
    return route.isDone?.(link.targetId) ? "done" : "live";
  },
  // The route itself, as the page's sendHandoff calls it (no toast: an agent has no Undo).
  send: async (route, src) => ROUTES[route].send(src),
};

function serverStore(userId: string): ParkingStore {
  let stories: Promise<Story[]> | undefined;
  let impediments: Promise<Impediment[]> | undefined;
  let boards: Promise<RetroBoard[]> | undefined;
  const loadStories = () => (stories ??= serverListEntities<Story>(userId, KIND_STORY));
  const loadImpediments = () =>
    (impediments ??= serverListEntities<Impediment>(userId, KIND_IMPEDIMENT));
  const loadBoards = () => (boards ??= serverListEntities<RetroBoard>(userId, KIND_RETRO));
  return {
    items: () => serverListEntities<ParkingLotItem>(userId, PARKING_LOT_ITEM_KIND),
    put: async (item) => {
      await serverUpsertEntity<ParkingLotItem>(userId, PARKING_LOT_ITEM_KIND, item);
    },
    target: async (link) => {
      if (link.route === "backlog-story") {
        const s = (await loadStories()).find((x) => x.id === link.targetId);
        return !s ? "gone" : s.status === "done" ? "done" : "live";
      }
      if (link.route === "impediment") {
        const i = (await loadImpediments()).find((x) => x.id === link.targetId);
        return !i ? "gone" : isResolved(i) ? "done" : "live";
      }
      if (link.route === "retro-action") {
        for (const b of await loadBoards()) {
          const card = b.cards.find((c) => c.id === link.targetId);
          if (card) return card.done ? "done" : "live";
        }
        return "gone";
      }
      return "gone";
    },
    send: async (route, src) => {
      if (route === "backlog-story") {
        // Stamped as the browser's store stamps a new story (createdAt), so
        // Backlog Health can date it and flag it once it goes stale.
        const story = stampStoryWrite(cleanStoryFields(buildBacklogStory(src)), undefined);
        await serverUpsertEntity<Story>(userId, KIND_STORY, story);
        stories = undefined;
        return story.id;
      }
      if (route === "impediment") {
        const impediment = buildImpediment(src);
        await serverUpsertEntity<Impediment>(userId, KIND_IMPEDIMENT, impediment);
        impediments = undefined;
        return impediment.id;
      }
      // A retro action on the current retro, starting one (in the first
      // format, after the newest archive) as the page's send does.
      const all = await loadBoards();
      const current = all.find((b) => b.id === RETRO_CURRENT_ID);
      const previous = newestArchivedRetro(all);
      const board =
        current ??
        blankRetroBoard(retroFormats[0], previous ? { previousRetroId: previous.id } : {});
      const card = buildRetroCard(src, board.format, true);
      await serverUpsertEntity<RetroBoard>(userId, KIND_RETRO, {
        ...board,
        cards: [...board.cards, card],
      });
      boards = undefined;
      return card.id;
    },
  };
}

const stamped = (item: ParkingLotItem): ParkingLotItem => ({
  ...item,
  updatedAt: new Date().toISOString(),
});

/* ── tool.parking_lot.list_state ─────────────────────────────────────── */

const STATUS_FILTER = ["open", "discussed", "sent", "dropped", "all"] as const;

const ListParams = z.object({
  meeting: z
    .string()
    .max(TOOL_TEXT_MAX.short)
    .optional()
    .describe(
      'Only the points from this meeting (any case), such as "Daily Scrum"; "" for points with no meeting.'
    ),
  status: z.enum(STATUS_FILTER).optional().describe("Default all."),
});

async function listState(store: ParkingStore, params: z.infer<typeof ListParams>): Promise<Out> {
  const items = parkingItems(await store.items());
  const filter = params.meeting === undefined ? null : meetingKey(params.meeting);
  const status = params.status ?? "all";
  const now = new Date();
  const shown = items.filter(
    (i) => matchesMeeting(i, filter) && (status === "all" || i.status === status)
  );
  // Counted as the page counts them: the team's own points, the example's
  // only while there are none.
  const counted = countedItems(items);
  return {
    counts: parkingSummary(counted),
    meetings: meetingsOf(counted).map((m) => ({
      name: m.name || null,
      total: m.total,
      open: m.open,
    })),
    rememberedMeeting: rememberedMeeting(items) || null,
    examples: items.filter((i) => isExampleId(i.id)).length,
    items: await Promise.all(
      shown.map(async (i) => ({
        id: i.id,
        text: i.text,
        meeting: i.meeting ?? null,
        raisedBy: i.raisedBy ?? null,
        status: i.status,
        ageDays: ageDays(i, now),
        example: isExampleId(i.id),
        createdAt: i.createdAt,
        sentTo: await Promise.all(
          (i.sentTo ?? []).map(async (l) => ({
            route: l.route,
            targetId: l.targetId,
            at: l.at,
            target: await store.target(l),
          }))
        ),
      }))
    ),
  };
}

registry.register({
  id: "tool.parking_lot.list_state",
  toolId: "tool.parking_lot",
  name: "list_state",
  category: "read",
  description:
    "List the Parking Lot as the page shows it: the points parked during meetings, oldest first. Params: meeting? (only that meeting, any case; '' for none), status? (open | discussed | sent | dropped | all; default all). Returns {counts: {total, open, discussed, sent, dropped}, meetings: {name | null, total, open}[] (most recent first; counts and meetings are the team's own points, the example's only while there are none, as the page counts them), rememberedMeeting (the meeting the next point goes in) | null, examples (example points loaded), items: {id, text, meeting, raisedBy, status, ageDays, example, createdAt, sentTo: {route: 'backlog-story' | 'impediment' | 'retro-action', targetId, at, target: 'live' | 'done' | 'gone'}[]}[]}.",
  paramsSchema: ListParams,
  handler: async (params) => listState(browserStore, params),
  mcpHandler: async (params, ctx) => listState(serverStore(ctx.userId), params),
});

/* ── tool.parking_lot.park ───────────────────────────────────────────── */

const ParkParams = z.object({
  text: z
    .string()
    .max(TOOL_TEXT_MAX.text)
    .refine((v) => oneLine(v) !== "", { message: "can't be blank" })
    .describe("The point, as raised: one line."),
  meeting: z
    .string()
    .max(TOOL_TEXT_MAX.short)
    .optional()
    .describe("The meeting it came up in. Left out: the meeting the last point was parked in."),
  raisedBy: z.string().max(TOOL_TEXT_MAX.short).optional().describe("Who raised it."),
});

async function park(store: ParkingStore, params: z.infer<typeof ParkParams>): Promise<Out> {
  const items = parkingItems(await store.items());
  const meeting = oneLine(params.meeting ?? rememberedMeeting(items));
  const raisedBy = oneLine(params.raisedBy ?? "");
  const item = newParkingItem(
    {
      text: oneLine(params.text),
      ...(meeting ? { meeting } : {}),
      ...(raisedBy ? { raisedBy } : {}),
    },
    `parking_${nanoid(8)}`,
    new Date().toISOString()
  );
  await store.put(item);
  return { parked: true, id: item.id, meeting: item.meeting ?? null };
}

registry.register({
  id: "tool.parking_lot.park",
  toolId: "tool.parking_lot",
  name: "park",
  category: "write",
  requiresConfirmation: false,
  description:
    "Park a point in the Parking Lot, as the page's quick capture does: open, in the meeting given (left out: the meeting the last point was parked in, as the page remembers it). Params: text (one line), meeting?, raisedBy?. Returns {parked: true, id, meeting | null}.",
  paramsSchema: ParkParams,
  handler: async (params) => park(browserStore, params),
  mcpHandler: async (params, ctx) => park(serverStore(ctx.userId), params),
});

/* ── tool.parking_lot.set_status ─────────────────────────────────────── */

const StatusParams = z.object({
  id: z.string().min(1).describe("The point's id (see list_state)."),
  status: z
    .enum(["open", "discussed", "dropped"])
    .describe(
      "discussed: settled in the meeting; dropped: no longer needed; open: back on the list."
    ),
});

async function setStatus(store: ParkingStore, params: z.infer<typeof StatusParams>): Promise<Out> {
  const raw = (await store.items()).find((i) => i.id === params.id);
  const item = parkingItems(raw ? [raw] : [])[0];
  if (!raw || !item) return { updated: false, reason: "not_found" };
  if (item.status === "sent") {
    const states = await Promise.all((item.sentTo ?? []).map((l) => store.target(l)));
    if (states.some((s) => s !== "gone")) {
      return {
        updated: false,
        reason: "sent",
        message:
          "This point was sent on and the item it became still exists: change it there (see sentTo in list_state).",
      };
    }
  }
  if (item.status === params.status) return { updated: false, reason: "unchanged" };
  await store.put(stamped({ ...raw, status: params.status }));
  return { updated: true, id: item.id, status: params.status };
}

registry.register({
  id: "tool.parking_lot.set_status",
  toolId: "tool.parking_lot",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Mark a parked point discussed (settled in the meeting), dropped (no longer needed) or open again, as the page's buttons do. To send it on, use send. A point that was sent and whose item still exists is refused ('sent'). Params: id, status (open | discussed | dropped). Returns {updated: true, id, status} or {updated: false, reason: 'not_found' | 'sent' | 'unchanged', message?}.",
  paramsSchema: StatusParams,
  handler: async (params) => setStatus(browserStore, params),
  mcpHandler: async (params, ctx) => setStatus(serverStore(ctx.userId), params),
});

/* ── tool.parking_lot.send ───────────────────────────────────────────── */

const SendParams = z.object({
  id: z.string().min(1).describe("The point's id (see list_state)."),
  route: z
    .enum(PARKING_ROUTES)
    .describe(
      "backlog-story: a story on the backlog; impediment: an open impediment; retro-action: an action on the current retro (one is started if none is open)."
    ),
});

async function send(store: ParkingStore, params: z.infer<typeof SendParams>): Promise<Out> {
  const raw = (await store.items()).find((i) => i.id === params.id);
  const item = parkingItems(raw ? [raw] : [])[0];
  if (!raw || !item) return { sent: false, reason: "not_found" };
  if (isExampleId(item.id)) return { sent: false, reason: "example" };
  const existing = (item.sentTo ?? []).find((l) => l.route === params.route);
  if (existing && (await store.target(existing)) !== "gone") {
    return { sent: false, reason: "already_sent", targetId: existing.targetId };
  }
  const targetId = await store.send(params.route, parkingSource(item));
  const link: HandoffLink = { route: params.route, targetId, at: new Date().toISOString() };
  // A dead link on the route (its item deleted) is replaced.
  await store.put(stamped({ ...raw, status: "sent", sentTo: withLink(item.sentTo, link) }));
  return {
    sent: true,
    route: params.route,
    targetId,
    href: ROUTES[params.route].targetHref(targetId),
  };
}

registry.register({
  id: "tool.parking_lot.send",
  toolId: "tool.parking_lot",
  name: "send",
  category: "write",
  requiresConfirmation: false,
  description:
    "Send a parked point on, as the page's 'Send to…' does: to the backlog as a story (route backlog-story), to the Impediment Tracker as an open impediment of medium severity (impediment), or to Retro Actions as an action on the current retro (retro-action; a retro is started if none is open). The new item carries the point's words, where it came up and who raised it, and links back (sourceRef parking-lot); the point turns 'sent' and records the link (sentTo). Example points are never sent. Params: id, route. Returns {sent: true, route, targetId, href} or {sent: false, reason: 'not_found' | 'example' | 'already_sent', targetId?}.",
  paramsSchema: SendParams,
  handler: async (params) => send(browserStore, params),
  mcpHandler: async (params, ctx) => send(serverStore(ctx.userId), params),
});

/* ── tool.parking_lot.suggest_routes ─────────────────────────────────── */

async function suggestRoutes(store: ParkingStore): Promise<Out> {
  const open = parkingItems(await store.items()).filter(
    (i) => i.status === "open" && !isExampleId(i.id)
  );
  return {
    suggestions: open.map((i) => ({ id: i.id, text: i.text, ...routeByRules(i.text) })),
  };
}

registry.register({
  id: "tool.parking_lot.suggest_routes",
  toolId: "tool.parking_lot",
  name: "suggest_routes",
  category: "read",
  description:
    "Suggest where each open parked point could go, by the page's keyword rules (what the review offers without AI): drop (it sounds settled), impediment (something outside the team is in the way), action (it is about how the team works) or backlog (work on the product, and the default). Only suggests: confirm with the user, then use send (backlog → backlog-story, impediment → impediment, action → retro-action) or set_status dropped. Returns {suggestions: {id, text, destination, reason}[]}.",
  paramsSchema: z.object({}),
  handler: async () => suggestRoutes(browserStore),
  mcpHandler: async (_params, ctx) => suggestRoutes(serverStore(ctx.userId)),
});
