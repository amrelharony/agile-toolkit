import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import type { Sprint, Story } from "@/lib/stores/workspace-types";
import { selectStoriesForCapacity } from "@/lib/sprints/plan";

/**
 * Compose-action: capacity-based sprint planner.
 *
 * Given a sprint id and a capacity (points), select the highest-priority
 * stories from the backlog whose total points fit and assign them to the
 * sprint. Read-only by default — set `commit: true` to apply.
 */

registry.register({
  id: "intent.plan_sprint",
  toolId: "intent",
  name: "plan_sprint",
  category: "intent",
  description:
    "Propose a sprint plan: select backlog stories by priority that fit within the sprint's capacity. Returns the proposed selection. Pass commit=true to assign them to the sprint.",
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
    const { selected, totalPoints } = selectStoriesForCapacity(
      state.stories,
      params.capacityPoints
    );

    if (params.commit) {
      for (const story of selected) {
        useWorkspaceStore.getState().upsertStory({
          ...story,
          sprintId: params.sprintId,
          status: "todo",
        });
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
    const stories = await serverListEntities<Story>(ctx.userId, "workspace:story");
    const { selected, totalPoints } = selectStoriesForCapacity(stories, params.capacityPoints);
    if (params.commit) {
      for (const story of selected) {
        await serverUpsertEntity<Story>(ctx.userId, "workspace:story", {
          ...story,
          sprintId: params.sprintId,
          status: "todo",
        });
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
