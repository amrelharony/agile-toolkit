/**
 * What the release still has to deliver, from one of three places:
 *
 *   "backlog"  the open stories (not done) outside closed sprints: the
 *              backlog plus whatever the running and planned sprints still
 *              hold. A story left behind in a completed or cancelled sprint
 *              is history, not release scope.
 *   "slice"    one release slice of the Story Mapper's map, adding up its
 *              cards' numeric estimates. The Story Mapper's "Plan release"
 *              opens this page on it with ?slice=<id>.
 *   "typed"    a number the user types: the fallback.
 *
 * Each source also counts its items without a numeric estimate. Their
 * points are missing from the total, so the forecast is optimistic by
 * however big they turn out to be, and the page says so.
 */

import type { Sprint, Story, StoryMap, StoryMapCard } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/components/tool-frame/example-data";

export type ScopeSource = "backlog" | "slice" | "typed";

export const SCOPE_SOURCE_LABEL: Record<ScopeSource, string> = {
  backlog: "Backlog",
  slice: "Story-map slice",
  typed: "Type it",
};

/** The query parameter the Story Mapper links with. */
export const SLICE_PARAM = "slice";

/** `?slice=<id>` from a query string, or null. */
export function readSliceParam(search: string): string | null {
  const v = new URLSearchParams(search).get(SLICE_PARAM);
  return v && v.length <= 128 ? v : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ── Backlog ─────────────────────────────────────────────────────────── */

export interface BacklogScope {
  /** Points of the open stories that have them. */
  points: number;
  /** Open stories counted. */
  stories: number;
  /** Of those, how many have no points. */
  unestimated: number;
  /** Of those, how many sit in a sprint that is still running or planned. */
  inOpenSprints: number;
}

const isEstimated = (s: Pick<Story, "points">) =>
  typeof s.points === "number" && Number.isFinite(s.points) && s.points >= 0;

/**
 * The open stories outside closed sprints. Example stories are left out:
 * a fake story mustn't move a real release date.
 */
export function backlogScope(stories: readonly Story[], sprints: readonly Sprint[]): BacklogScope {
  const status = new Map(sprints.map((s) => [s.id, s.status]));
  let points = 0;
  let count = 0;
  let unestimated = 0;
  let inOpenSprints = 0;
  for (const story of stories) {
    if (story.status === "done" || isExampleId(story.id)) continue;
    const sprintStatus = story.sprintId ? status.get(story.sprintId) : undefined;
    if (sprintStatus === "completed" || sprintStatus === "cancelled") continue;
    count++;
    if (sprintStatus === "active" || sprintStatus === "planned") inOpenSprints++;
    if (isEstimated(story)) points += story.points as number;
    else unestimated++;
  }
  return { points: round1(points), stories: count, unestimated, inOpenSprints };
}

/* ── Story-map slices ────────────────────────────────────────────────── */

/**
 * A card's estimate as points: "5", "3.5", "0,5", "½", "8 pts". Null for
 * anything else ("?", "XL", a coffee cup): those are unestimated here, since
 * a T-shirt size has no point value to add up.
 */
export function estimatePoints(estimate: string | undefined): number | null {
  const raw = (estimate ?? "").trim();
  if (raw === "") return null;
  if (raw === "½") return 0.5;
  const m = /^(\d+(?:[.,]\d+)?)\s*(?:pts?|points?|sp)?$/i.exec(raw);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export interface SliceScope {
  id: string;
  name: string;
  points: number;
  cards: number;
  unestimated: number;
}

/** The cards of a slice under the map's steps, in step order (a card of a removed step isn't shown, so it isn't counted). */
function sliceCards(map: StoryMap, cards: Record<string, StoryMapCard[]>): StoryMapCard[] {
  return map.steps.flatMap((step) => cards?.[step.id] ?? []);
}

/** Every slice of the map with its point total, in map order. */
export function storyMapSlices(map: StoryMap | undefined): SliceScope[] {
  if (!map) return [];
  return (map.slices ?? []).map((slice) => {
    const cards = sliceCards(map, slice.cards);
    let points = 0;
    let unestimated = 0;
    for (const card of cards) {
      const p = estimatePoints(card.estimate);
      if (p === null) unestimated++;
      else points += p;
    }
    return {
      id: slice.id,
      name: slice.name.trim() || "Untitled slice",
      points: round1(points),
      cards: cards.length,
      unestimated,
    };
  });
}

/* ── Choosing ─────────────────────────────────────────────────────────── */

/**
 * The source in use: the user's choice; else a typed number (an old config
 * typed one, so its forecast stays the same); else the backlog when it holds
 * open stories; else typing.
 */
export function resolveScopeSource(
  config: { scopeSource?: ScopeSource; backlogSize: number | null },
  backlog: Pick<BacklogScope, "stories">
): ScopeSource {
  if (config.scopeSource) return config.scopeSource;
  if (config.backlogSize !== null && config.backlogSize > 0) return "typed";
  return backlog.stories > 0 ? "backlog" : "typed";
}

export interface ResolvedScope {
  source: ScopeSource;
  /** Points to deliver before any expected change; null when there's nothing to count yet. */
  points: number | null;
  /** Items behind the number (stories or cards); 0 when typed. */
  items: number;
  unestimated: number;
  /** The slice planned, when the source is a slice and it exists. */
  slice?: SliceScope;
  /** True when the config names a slice the map no longer has. */
  sliceMissing?: boolean;
}

/** The scope the forecast runs on, for the chosen source. */
export function resolveScope(
  source: ScopeSource,
  config: { backlogSize: number | null; sliceId?: string },
  backlog: BacklogScope,
  slices: readonly SliceScope[]
): ResolvedScope {
  if (source === "backlog") {
    return {
      source,
      points: backlog.stories > 0 ? backlog.points : null,
      items: backlog.stories,
      unestimated: backlog.unestimated,
    };
  }
  if (source === "slice") {
    const slice = config.sliceId ? slices.find((s) => s.id === config.sliceId) : undefined;
    if (!slice) {
      return {
        source,
        points: null,
        items: 0,
        unestimated: 0,
        sliceMissing: Boolean(config.sliceId),
      };
    }
    return {
      source,
      points: slice.cards > 0 ? slice.points : null,
      items: slice.cards,
      unestimated: slice.unestimated,
      slice,
    };
  }
  return {
    source,
    points: config.backlogSize !== null && config.backlogSize > 0 ? config.backlogSize : null,
    items: 0,
    unestimated: 0,
  };
}

/** The scope after the expected change, rounded to a whole point; null without a scope. */
export function effectiveScope(points: number | null, changePct: number | null): number | null {
  if (points === null || !Number.isFinite(points) || points <= 0) return null;
  const pct = changePct !== null && Number.isFinite(changePct) ? changePct : 0;
  return Math.max(1, Math.round(points * (1 + pct / 100)));
}
