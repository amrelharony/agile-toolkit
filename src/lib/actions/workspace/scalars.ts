import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetWorkspaceBlob, serverPatchWorkspaceBlob } from "../server-store";

/**
 * Workspace scalar fields (teamName, maturityLevel) — not entities, so
 * they don't fit the CRUD generator. Two read + two write actions.
 *
 * MCP-served reads/writes (C1) go through user_state directly because
 * the server-side Zustand store is empty.
 */

registry.register({
  id: "workspace.scalars.get",
  toolId: "workspace.scalars",
  name: "get",
  category: "read",
  description:
    "Read the workspace-level scalar fields: team name and maturity level (null when not set; a null level means the team is unassessed).",
  paramsSchema: z.object({}),
  handler: async () => {
    const s = useWorkspaceStore.getState();
    return { teamName: s.teamName ?? null, maturityLevel: s.maturityLevel ?? null };
  },
  mcpHandler: async (_params, ctx) => {
    const blob = await serverGetWorkspaceBlob(ctx.userId);
    return {
      teamName: (blob.teamName as string | undefined) ?? null,
      maturityLevel: (blob.maturityLevel as number | undefined) ?? null,
    };
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
  mcpHandler: async (params, ctx) => {
    await serverPatchWorkspaceBlob(ctx.userId, { teamName: params.name });
    return { ok: true };
  },
});

registry.register({
  id: "workspace.scalars.set_maturity_level",
  toolId: "workspace.scalars",
  name: "set_maturity_level",
  category: "write",
  description:
    "Set the team's agile maturity level (1-5). The Maturity tool's latest saved assessment owns this level: saving, removing or resetting an assessment there (or through tool.maturity.*) sets it again, and a team with no saved assessment is unassessed (null). Prefer tool.maturity.*; use this only for a team that doesn't use the Maturity tool.",
  paramsSchema: z.object({
    level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  }),
  handler: async (params: { level: 1 | 2 | 3 | 4 | 5 }) => {
    useWorkspaceStore.getState().setMaturityLevel(params.level);
    return { ok: true };
  },
  mcpHandler: async (params, ctx) => {
    await serverPatchWorkspaceBlob(ctx.userId, { maturityLevel: params.level });
    return { ok: true };
  },
});
