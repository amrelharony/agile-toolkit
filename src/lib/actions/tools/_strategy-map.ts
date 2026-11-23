/**
 * Shared plumbing for Impact Map's and Strategy Tree's verbs
 * (tool.impact_map.*, tool.strategy_tree.*): one StrategyMap entity
 * (workspace.strategyMaps, kind "workspace:strategyMap") read the way the
 * pages read it (readStrategyMap), every write checked by the rules the
 * CRUD keeps (strategyMapProblems) and the row's size, and the sends the
 * pages make: a backlog story, an epic on the roadmap, a hypothesis to
 * test, linked both ways and never twice while the target exists. Example
 * maps (ids "example-…") are never sent or added to.
 *
 * In the browser a send goes through its route (as the page's sendHandoff
 * calls it, without the toast: an agent has no Undo); over MCP the target
 * is written to the user's rows on the server, built by the very same
 * builders. Only the three routes are imported, never the hand-off
 * registry, whose other targets reach browser-only modules.
 *
 * The leading underscore keeps scripts/generate-action-registry.mjs from
 * importing it as an action module.
 */

import { nanoid } from "nanoid";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  PERSONA_KIND,
  PRODUCT_GOAL_KIND,
  STRATEGY_MAP_KIND,
  type EpicRoadmap,
  type HandoffLink,
  type Hypothesis,
  type HypothesisTracker,
  type Persona,
  type ProductGoal,
  type Story,
  type StrategyMap,
} from "@/lib/stores/workspace-types";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import { withLink } from "@/lib/handoffs/links";
import type { HandoffRoute, HandoffSource } from "@/lib/handoffs/types";
import { backlogStoryRoute, buildBacklogStory } from "@/lib/handoffs/targets/backlog-story";
import { epicRoute } from "@/lib/handoffs/targets/epic";
import { hypothesisRoute } from "@/lib/handoffs/targets/hypothesis";
import { EPIC_ROADMAP_ID, buildEpicFromSource } from "@/lib/roadmap/epic-source";
import { epicRollup, linkedStories } from "@/lib/roadmap/rollup";
import {
  HYPOTHESIS_TRACKER_ID,
  hypothesisFromSource,
  isResolved,
  withHypothesis,
} from "@/lib/hypotheses/model";
import { stampStoryWrite } from "@/lib/sprints/story-status";
import { cleanStoryFields } from "@/lib/stories/fields";
import { isExampleId } from "@/lib/utils/example-id";
import { todayLocalISO } from "@/lib/utils/formatters";
import { jsonBytes } from "@/lib/utils/json-bytes";
import { strategyMapProblems } from "@/lib/strategy-map/rules";
import { levelSends, type StrategySendRoute } from "@/lib/strategy-map/formats";
import { TOO_BIG, fitsRow, nodeTitle, readStrategyMaps } from "@/lib/strategy-map/model";
import { strategySource } from "@/lib/strategy-map/send";

const KIND_STORY = "workspace:story";
const KIND_ER = "workspace:epicRoadmap";
const KIND_HT = "workspace:hypothesisTracker";

const ws = () => useWorkspaceStore.getState();

/** What a send's target looks like now: gone, there, or there and finished. */
export type TargetState = "gone" | "live" | "done";

/** The routes a strategy map sends on, as the hand-off registry holds them. */
const ROUTES: Readonly<Record<StrategySendRoute, HandoffRoute>> = {
  "backlog-story": backlogStoryRoute,
  epic: epicRoute,
  hypothesis: hypothesisRoute,
};

const isSendRoute = (r: string): r is StrategySendRoute => r in ROUTES;

/** Where the maps (and what they were sent to) live: the browser's workspace, or the server. */
export interface StrategyStore {
  maps(): Promise<StrategyMap[]>;
  put(map: StrategyMap): Promise<void>;
  personas(): Promise<Persona[]>;
  goals(): Promise<ProductGoal[]>;
  hypotheses(): Promise<Hypothesis[]>;
  /** A link's target as it is now. */
  target(link: HandoffLink): Promise<TargetState>;
  /** Create the item a route makes for `src`; returns its id. */
  send(route: StrategySendRoute, src: HandoffSource): Promise<string>;
}

export const browserStrategyStore: StrategyStore = {
  maps: async () => readStrategyMaps(ws().strategyMaps),
  put: async (map) => ws().upsertStrategyMap(map),
  personas: async () => ws().personas ?? [],
  goals: async () => ws().productGoals ?? [],
  hypotheses: async () =>
    (ws().hypothesisTrackers ?? []).find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? [],
  target: async (link) => {
    if (!isSendRoute(link.route)) return "gone";
    const route = ROUTES[link.route];
    if (!route.exists(link.targetId)) return "gone";
    return route.isDone?.(link.targetId) ? "done" : "live";
  },
  send: async (route, src) => ROUTES[route].send(src),
};

export function serverStrategyStore(userId: string): StrategyStore {
  let stories: Promise<Story[]> | undefined;
  let roadmap: Promise<EpicRoadmap | null> | undefined;
  let tracker: Promise<HypothesisTracker | null> | undefined;
  const loadStories = () => (stories ??= serverListEntities<Story>(userId, KIND_STORY));
  const loadRoadmap = () =>
    (roadmap ??= serverGetEntity<EpicRoadmap>(userId, KIND_ER, EPIC_ROADMAP_ID).then(
      (d) => d ?? null
    ));
  const loadTracker = () =>
    (tracker ??= serverGetEntity<HypothesisTracker>(userId, KIND_HT, HYPOTHESIS_TRACKER_ID).then(
      (d) => d ?? null
    ));
  return {
    maps: async () => readStrategyMaps(await serverListEntities(userId, STRATEGY_MAP_KIND)),
    put: async (map) => {
      await serverUpsertEntity<StrategyMap>(userId, STRATEGY_MAP_KIND, map);
    },
    personas: () => serverListEntities<Persona>(userId, PERSONA_KIND),
    goals: () => serverListEntities<ProductGoal>(userId, PRODUCT_GOAL_KIND),
    hypotheses: async () => (await loadTracker())?.hypotheses ?? [],
    target: async (link) => {
      if (link.route === "backlog-story") {
        const s = (await loadStories()).find((x) => x.id === link.targetId);
        return !s ? "gone" : s.status === "done" ? "done" : "live";
      }
      if (link.route === "epic") {
        const epic = (await loadRoadmap())?.epics.find((e) => e.id === link.targetId);
        if (!epic) return "gone";
        return epicRollup(epic, linkedStories(epic.id, await loadStories())).done ? "done" : "live";
      }
      if (link.route === "hypothesis") {
        const h = (await loadTracker())?.hypotheses.find((x) => x.id === link.targetId);
        return !h ? "gone" : isResolved(h.status) ? "done" : "live";
      }
      return "gone";
    },
    send: async (route, src) => {
      if (route === "backlog-story") {
        // Stamped as the browser's store stamps a new story (createdAt).
        const story = stampStoryWrite(cleanStoryFields(buildBacklogStory(src)), undefined);
        await serverUpsertEntity<Story>(userId, KIND_STORY, story);
        stories = undefined;
        return story.id;
      }
      if (route === "epic") {
        const doc = (await loadRoadmap()) ?? { id: EPIC_ROADMAP_ID, epics: [] };
        const epic = buildEpicFromSource(src, doc.epics);
        await serverUpsertEntity<EpicRoadmap>(userId, KIND_ER, {
          ...doc,
          epics: [...doc.epics, epic],
        });
        roadmap = undefined;
        return epic.id;
      }
      const h = hypothesisFromSource(src, nanoid(8), todayLocalISO());
      await serverUpsertEntity<HypothesisTracker>(
        userId,
        KIND_HT,
        withHypothesis(await loadTracker(), h)
      );
      tracker = undefined;
      return h.id;
    },
  };
}

/* ── Writing a map ───────────────────────────────────────────────────── */

export type SaveResult =
  | { ok: true; map: StrategyMap }
  | { ok: false; reason: "rules" | "too_big"; message: string };

/**
 * Save `next` (the map after the change; `current` before it, undefined
 * for a new one), stamped, if it keeps the rules and still fits its row (a
 * change that doesn't grow a row too big to save is still saved).
 */
export async function saveMap(
  store: StrategyStore,
  next: StrategyMap,
  current: StrategyMap | undefined
): Promise<SaveResult> {
  const problems = strategyMapProblems(next, current);
  if (problems.length > 0) return { ok: false, reason: "rules", message: problems.join(" ") };
  const now = new Date().toISOString();
  const stamped: StrategyMap = {
    ...next,
    createdAt: current?.createdAt || next.createdAt || now,
    updatedAt: now,
  };
  if (!fitsRow(stamped) && (!current || jsonBytes(stamped) > jsonBytes(current))) {
    return { ok: false, reason: "too_big", message: TOO_BIG };
  }
  await store.put(stamped);
  return { ok: true, map: stamped };
}

/* ── Sending a node ──────────────────────────────────────────────────── */

export type SendOutcome =
  | { sent: true; route: StrategySendRoute; targetId: string; title: string }
  | {
      sent: false;
      reason: "not_found" | "example" | "level" | "already_sent" | "blank" | "too_big";
      message?: string;
      targetId?: string;
    };

/**
 * Send the node `nodeId` of the map `mapId` on `route`, as the page does:
 * only from a level that takes the route, never an example, once while
 * the target exists (a target that is gone can be sent again), with the
 * link written on the node. `want` names the map's tool: an impact map's
 * verb never sends a tree's node, and the other way round.
 */
export async function sendNode(
  store: StrategyStore,
  p: { mapId: string; nodeId: string; route: StrategySendRoute },
  want: (m: StrategyMap) => boolean
): Promise<SendOutcome> {
  const map = (await store.maps()).find((m) => m.id === p.mapId && want(m));
  const node = map?.nodes.find((n) => n.id === p.nodeId);
  if (!map || !node) return { sent: false, reason: "not_found" };
  if (isExampleId(map.id) || isExampleId(node.id)) return { sent: false, reason: "example" };
  if (!levelSends(map.format, node.level, p.route) || node.status === "dropped") {
    return {
      sent: false,
      reason: "level",
      message: `A ${node.status === "dropped" ? "dropped part" : "part at this level"} doesn't go to ${ROUTES[p.route].label.toLowerCase()}.`,
    };
  }
  const existing = (node.sentTo ?? []).find((l) => l.route === p.route);
  if (existing && (await store.target(existing)) !== "gone") {
    return { sent: false, reason: "already_sent", targetId: existing.targetId };
  }
  const src = strategySource(map, node, p.route);
  if (!src || !src.title.trim()) return { sent: false, reason: "blank" };
  const targetId = await store.send(p.route, src);
  const link: HandoffLink = { route: p.route, targetId, at: new Date().toISOString() };
  const next: StrategyMap = {
    ...map,
    nodes: map.nodes.map((n) =>
      n.id === node.id ? { ...n, sentTo: withLink(n.sentTo, link) } : n
    ),
  };
  const saved = await saveMap(store, next, map);
  if (!saved.ok) return { sent: false, reason: "too_big", message: saved.message, targetId };
  return { sent: true, route: p.route, targetId, title: nodeTitle(node, map.format) };
}

/** A node's links with where each target stands now. */
export async function linksOf(
  store: StrategyStore,
  links: readonly HandoffLink[] | undefined
): Promise<{ route: string; targetId: string; at: string; target: TargetState }[]> {
  return Promise.all(
    (links ?? []).map(async (l) => ({
      route: l.route,
      targetId: l.targetId,
      at: l.at,
      target: await store.target(l),
    }))
  );
}
