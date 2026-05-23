import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Workspace scalar fields (teamName, maturityLevel) — not entities, so
 * they don't fit the CRUD generator. Two read + two write actions.
 */

registry.register({
  id: "workspace.scalars.get",
  toolId: "workspace.scalars",
  name: "get",
  category: "read",
  description: "Read the workspace-level scalar fields (team name, maturity level).",
  paramsSchema: z.object({}),
  handler: async () => {
    const s = useWorkspaceStore.getState();
    return { teamName: s.teamName ?? null, maturityLevel: s.maturityLevel ?? null };
  },
});

registry.register({
  id: "workspace.scalars.set_team_name",
  toolId: "workspace.scalars",
  name: "set_team_name",
  category: "write",
  description: "Set the workspace's team name.",
  paramsSchema: z.object({ name: z.string() }),
  handler: async (params: { name: string }) => {
    useWorkspaceStore.getState().setTeamName(params.name);
    return { ok: true };
  },
});

registry.register({
  id: "workspace.scalars.set_maturity_level",
  toolId: "workspace.scalars",
  name: "set_maturity_level",
  category: "write",
  description: "Set the team's agile maturity level (1-5).",
  paramsSchema: z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]) }),
  handler: async (params: { level: 1 | 2 | 3 | 4 | 5 }) => {
    useWorkspaceStore.getState().setMaturityLevel(params.level);
    return { ok: true };
  },
});
