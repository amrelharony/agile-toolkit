/**
 * Impact Map's and Strategy Tree's data-aware next steps (lib/tools/
 * next-steps.ts calls these two, with the slices its rules select). Each
 * reads the team's own maps (example maps left out), newest first, and
 * links back to the map it is about. Pure: no store, no React, no
 * "use client" module.
 */

import type {
  EpicRoadmap,
  Hypothesis,
  HypothesisTracker,
  Story,
  StrategyMap,
  StrategyMapNode,
} from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";
import { isExampleId } from "@/lib/utils/example-id";
import { HYPOTHESIS_TRACKER_ID, linkedTest } from "@/lib/hypotheses/model";
import { betLevel, isTreeFormat } from "./formats";
import { childrenOf, focusOf, newestFirst, nodeTitle, readStrategyMaps, rootOf } from "./model";

/** What Impact Map's rule reads from the workspace. */
export interface ImpactMapStepsInput {
  maps: readonly StrategyMap[] | undefined;
  stories: readonly Story[];
  roadmaps: readonly EpicRoadmap[] | undefined;
}

/** What Strategy Tree's rule reads from the workspace. */
export interface StrategyTreeStepsInput {
  maps: readonly StrategyMap[] | undefined;
  trackers: readonly HypothesisTracker[] | undefined;
}

/** How long a test's result counts as news. */
const FRESH_RESULT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The team's own maps of one tool, newest first, read as the pages read them. */
function ownMaps(maps: readonly StrategyMap[] | undefined, tree: boolean): StrategyMap[] {
  return newestFirst(
    readStrategyMaps(maps).filter(
      (m) => !isExampleId(m.id) && (tree ? isTreeFormat(m.format) : m.format === "impact-map")
    )
  );
}

const mapHref = (tool: "impact-map" | "strategy-tree", id: string) =>
  `/${tool}?${tool === "impact-map" ? "map" : "tree"}=${encodeURIComponent(id)}`;

/** A short quote of a node for a step's label. */
const quoted = (n: StrategyMapNode, map: StrategyMap, max = 60) => {
  const t = nodeTitle(n, map.format);
  return `“${t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t}”`;
};

/**
 * Impact Map's next steps, at most one of each:
 *   1. the focus impact has a deliverable on neither the backlog nor the
 *      roadmap: put it on the backlog;
 *   2. a goal has no measure: give it one;
 *   3. two or more impacts and no focus: pick the one to work on first.
 */
export function impactMapSteps(s: ImpactMapStepsInput): NextStep[] {
  const maps = ownMaps(s.maps, false);
  if (maps.length === 0) return [];
  const storyIds = new Set(s.stories.map((x) => x.id));
  const epicIds = new Set((s.roadmaps ?? []).flatMap((d) => d.epics.map((e) => e.id)));
  const placed = (n: StrategyMapNode) =>
    (n.sentTo ?? []).some(
      (l) =>
        (l.route === "backlog-story" && storyIds.has(l.targetId)) ||
        (l.route === "epic" && epicIds.has(l.targetId))
    );
  const steps: NextStep[] = [];

  for (const map of maps) {
    const focus = focusOf(map);
    const waiting = focus ? childrenOf(map, focus.id).find((d) => !placed(d)) : undefined;
    if (focus && waiting) {
      steps.push({
        id: "impact-map-deliverable",
        label: `Put ${quoted(waiting, map)} on the backlog`,
        detail: `It serves the impact you work on first, ${quoted(focus, map)}.`,
        href: mapHref("impact-map", map.id),
      });
      break;
    }
  }

  for (const map of maps) {
    const goal = rootOf(map);
    if (goal && !(goal.measure ?? "").trim()) {
      steps.push({
        id: "impact-map-measure",
        label: `Give ${quoted(goal, map)} a measure`,
        detail: "A goal with a number shows whether the deliverables move it.",
        href: mapHref("impact-map", map.id),
      });
      break;
    }
  }

  for (const map of maps) {
    const impacts = map.nodes.filter((n) => n.level === 2);
    if (impacts.length >= 2 && !focusOf(map)) {
      steps.push({
        id: "impact-map-focus",
        label: "Pick the impact to work on first",
        detail: `${impacts.length} impacts on ${quoted(rootOf(map) ?? impacts[0], map)}, none picked yet.`,
        href: mapHref("impact-map", map.id),
      });
      break;
    }
  }
  return steps;
}

/**
 * Strategy Tree's next steps, at most one of each:
 *   1. a bet not tested yet: test it;
 *   2. a bet's test came back in the last 30 days: see what it found;
 *   3. Hoshin parts with questions: answer them in the catchball.
 */
export function strategyTreeSteps(s: StrategyTreeStepsInput, now: Date): NextStep[] {
  const maps = ownMaps(s.maps, true);
  if (maps.length === 0) return [];
  const hypotheses: readonly Hypothesis[] =
    (s.trackers ?? []).find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? [];
  const betsOf = (map: StrategyMap) => {
    const level = betLevel(map.format);
    return level === null
      ? []
      : map.nodes.filter((n) => n.level === level && n.status !== "dropped");
  };
  const steps: NextStep[] = [];

  for (const map of maps) {
    const bet = betsOf(map).find((n) => linkedTest(n.sentTo, hypotheses).state === "none");
    if (bet) {
      steps.push({
        id: "strategy-tree-test",
        label: `Test the bet ${quoted(bet, map)}`,
        detail: "A bet with a test tells you whether to keep going.",
        href: mapHref("strategy-tree", map.id),
      });
      break;
    }
  }

  const since = now.getTime() - FRESH_RESULT_DAYS * DAY_MS;
  for (const map of maps) {
    const fresh = betsOf(map).find((n) => {
      const t = linkedTest(n.sentTo, hypotheses);
      if (t.state !== "tested") return false;
      const h = hypotheses.find((x) => x.id === t.hypothesisId);
      const at = h?.resolvedAt ? Date.parse(h.resolvedAt) : NaN;
      return Number.isFinite(at) && at >= since && at <= now.getTime() + DAY_MS;
    });
    if (fresh) {
      steps.push({
        id: "strategy-tree-result",
        label: `See what the test of ${quoted(fresh, map)} found`,
        detail: "Its result is in the Hypothesis Tracker.",
        href: "/hypothesis-tracker",
      });
      break;
    }
  }

  const hoshin = maps.filter((m) => m.format === "hoshin");
  const questions = hoshin.reduce(
    (n, m) => n + m.nodes.filter((x) => x.status === "questioned").length,
    0
  );
  const first = hoshin.find((m) => m.nodes.some((x) => x.status === "questioned"));
  if (first && questions > 0) {
    steps.push({
      id: "strategy-tree-catchball",
      label: `Answer ${questions} ${questions === 1 ? "question" : "questions"} in the catchball`,
      detail: "Parts marked “Has questions” wait for an answer before they're agreed.",
      href: mapHref("strategy-tree", first.id),
    });
  }
  return steps;
}
