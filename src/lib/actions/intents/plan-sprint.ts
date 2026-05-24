import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import type { Sprint, Story } from "@/lib/stores/workspace-types";

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

    // Sort backlog by priority descending (highest first), nulls last.
    const candidates = state.stories
      .filter((s) => s.status === "backlog")
      .slice()
      .sort((a, b) => (b.priorityScore ?? -Infinity) - (a.priorityScore ?? -Infinity));

    const selected: typeof candidates = [];
    let remaining = params.capacityPoints;
    for (const story of candidates) {
      const pts = story.points ?? 0;
      if (pts <= 0) continue;
      if (pts > remaining) continue;
      selected.push(story);
      remaining -= pts;
    }

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
      totalPointsSelected: params.capacityPoints - remaining,
      committed: Boolean(params.commit),
    };
  },
  mcpHandler: async (params, ctx) => {
    // C1 follow-up: server-side variant against Supabase.
    const sprint = await serverGetEntity<Sprint>(ctx.userId, "workspace:sprint", params.sprintId);
    if (!sprint) throw new Error(`Sprint ${params.sprintId} not found.`);
    const stories = await serverListEntities<Story>(ctx.userId, "workspace:story");
    const candidates = stories
      .filter((s) => s.status === "backlog")
      .slice()
      .sort((a, b) => (b.priorityScore ?? -Infinity) - (a.priorityScore ?? -Infinity));
    const selected: Story[] = [];
    let remaining = params.capacityPoints;
    for (const story of candidates) {
      const pts = story.points ?? 0;
      if (pts <= 0) continue;
      if (pts > remaining) continue;
      selected.push(story);
      remaining -= pts;
    }
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
      totalPointsSelected: params.capacityPoints - remaining,
      committed: Boolean(params.commit),
    };
  },
});
