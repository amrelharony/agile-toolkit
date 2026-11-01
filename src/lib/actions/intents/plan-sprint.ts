import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import type { BacklogItem, Sprint, Story } from "@/lib/stores/workspace-types";
import { selectStoriesForCapacity, withLiveBacklogRank } from "@/lib/sprints/plan";
import { withStoryStatus, withStorySprint } from "@/lib/sprints/story-status";

/**
 * Compose-action: capacity-based sprint planner.
 *
 * Given a sprint id and a capacity (points), select the highest-priority
 * stories from the backlog whose total points fit and assign them to the
 * sprint. Read-only by default — set `commit: true` to apply.
 *
 * The order is the page's: each story reads its backlog item's decided rank
 * as it is now (withLiveBacklogRank), then the priority score. A committed
 * story is written as stored, with only its status and sprint changed.
 */

/** The entity kind the sync engine stores backlog items under. */
const KIND_BACKLOG_ITEM = "workspace:backlogItem";

/** The pick, ordered by the live decided rank, as the stored stories. */
function pick(
  stories: readonly Story[],
  items: readonly BacklogItem[] | undefined,
  points: number
) {
  const { selected, totalPoints } = selectStoriesForCapacity(
    withLiveBacklogRank(stories, items),
    points
  );
  const stored = new Map(stories.map((s) => [s.id, s]));
  return { selected: selected.map((s) => stored.get(s.id) ?? s), totalPoints };
}

registry.register({
  id: "intent.plan_sprint",
  toolId: "intent",
  name: "plan_sprint",
  category: "intent",
  description:
    "Propose a sprint plan: select backlog stories that fit within the sprint's capacity, in the Sprint Planning page's order (the decided rank each story's backlog item holds now, then the priority score). Returns the proposed selection. Pass commit=true to assign them to the sprint.",
  paramsSchema: z.object({
    sprintId: z.string(),
    capacityPoints: z.number(),
    commit: z.boolean().optional(),
  }),
  handler: async (params: { sprintId: string; capacityPoints: number; commit?: boolean }) => {
    const state = useWorkspaceStore.getState();
    const sprint = state.sprints.find((s) => s.id === params.sprintId);
    if (!sprint) throw new Error(`Sprint ${params.sprintId} not found.`);

    // The same greedy pick as the Sprint Planning page's "Fill to capacity".
    const { selected, totalPoints } = pick(
      state.stories,
      state.backlogItems,
      params.capacityPoints
    );

    if (params.commit) {
      for (const story of selected) {
        // Stamped like the app's setStoryStatus (backlog → to do is logged),
        // and the move into the sprint is recorded.
        useWorkspaceStore
          .getState()
          .upsertStory(withStorySprint(withStoryStatus(story, "todo"), params.sprintId));
      }
    }

    return {
      sprintId: params.sprintId,
      sprintName: sprint.name,
      capacityPoints: params.capacityPoints,
      selected: selected.map((s) => ({ id: s.id, title: s.title, points: s.points })),
      totalPointsSelected: totalPoints,
      committed: Boolean(params.commit),
    };
  },
  mcpHandler: async (params, ctx) => {
    // C1 follow-up: server-side variant against Supabase.
    const sprint = await serverGetEntity<Sprint>(ctx.userId, "workspace:sprint", params.sprintId);
    if (!sprint) throw new Error(`Sprint ${params.sprintId} not found.`);
    const [stories, items] = await Promise.all([
      serverListEntities<Story>(ctx.userId, "workspace:story"),
      serverListEntities<BacklogItem>(ctx.userId, KIND_BACKLOG_ITEM),
    ]);
    const { selected, totalPoints } = pick(stories, items, params.capacityPoints);
    if (params.commit) {
      for (const story of selected) {
        await serverUpsertEntity<Story>(
          ctx.userId,
          "workspace:story",
          withStorySprint(withStoryStatus(story, "todo"), params.sprintId)
        );
      }
    }
    return {
      sprintId: params.sprintId,
      sprintName: sprint.name,
      capacityPoints: params.capacityPoints,
      selected: selected.map((s) => ({ id: s.id, title: s.title, points: s.points })),
      totalPointsSelected: totalPoints,
      committed: Boolean(params.commit),
    };
  },
});
