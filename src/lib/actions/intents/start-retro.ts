import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity, serverBulkUpsertEntities } from "../server-store";
import type { Sprint, Whiteboard, WhiteboardFrame } from "@/lib/stores/workspace-types";

/**
 * Compose-action: "start a retro for sprint X".
 *
 * Steps:
 *   1. Look up the sprint (verifies it exists).
 *   2. Create a new whiteboard for the retro.
 *   3. Seed the board with three Start/Stop/Continue columns as frames.
 *
 * Return value includes the new boardId so the caller can navigate
 * (the in-app agent UI handles the navigation; MCP returns the id).
 */

registry.register({
  id: "intent.start_retro_for_sprint",
  toolId: "intent",
  name: "start_retro_for_sprint",
  category: "intent",
  description:
    "Start a retro for the given sprint: create a new whiteboard, seed Start/Stop/Continue columns, and return the boardId.",
  longDescription:
    "Composes workspace.sprint.list + workspace.whiteboard.create + canvas object creation. The agent UI should navigate the user to /canvas after this returns.",
  paramsSchema: z.object({
    sprintId: z.string(),
    title: z.string().optional(),
  }),
  handler: async (params: { sprintId: string; title?: string }) => {
    const state = useWorkspaceStore.getState();
    const sprint = state.sprints.find((s) => s.id === params.sprintId);
    if (!sprint) {
      throw new Error(`Sprint ${params.sprintId} not found.`);
    }

    const boardId = `wb_${nanoid()}`;
    const now = new Date().toISOString();
    const board: Whiteboard = {
      id: boardId,
      name: params.title ?? `Retro — ${sprint.name}`,
      template: "start-stop-continue",
      createdAt: now,
      updatedAt: now,
    };

    // Seed three frames as columns. World coords: 0,0 origin; 600px wide
    // columns with 40px gutter.
    const frames: WhiteboardFrame[] = [
      { label: "Start", fill: "#0ea5e9" },
      { label: "Stop", fill: "#ef4444" },
      { label: "Continue", fill: "#22c55e" },
    ].map((col, i) => ({
      id: `obj_${nanoid(10)}`,
      boardId,
      type: "frame" as const,
      x: i * 640,
      y: 0,
      w: 600,
      h: 800,
      z: i + 1,
      version: 1,
      updatedAt: now,
      createdAt: now,
      label: col.label,
      fill: col.fill,
    }));

    useWorkspaceStore.setState({
      whiteboards: [...(state.whiteboards ?? []), board],
      whiteboardObjects: [...(state.whiteboardObjects ?? []), ...frames],
    });

    return { boardId, sprintName: sprint.name, framesAdded: frames.length };
  },
  mcpHandler: async (params, ctx) => {
    // Server-side: validate sprint via user_entities, then upsert the
    // new whiteboard + frame entities directly.
    const sprint = await serverGetEntity<Sprint>(ctx.userId, "workspace:sprint", params.sprintId);
    if (!sprint) {
      throw new Error(`Sprint ${params.sprintId} not found.`);
    }
    const boardId = `wb_${nanoid()}`;
    const now = new Date().toISOString();
    const board: Whiteboard = {
      id: boardId,
      name: params.title ?? `Retro — ${sprint.name}`,
      template: "start-stop-continue",
      createdAt: now,
      updatedAt: now,
    };
    const frames: WhiteboardFrame[] = [
      { label: "Start", fill: "#0ea5e9" },
      { label: "Stop", fill: "#ef4444" },
      { label: "Continue", fill: "#22c55e" },
    ].map((col, i) => ({
      id: `obj_${nanoid(10)}`,
      boardId,
      type: "frame" as const,
      x: i * 640,
      y: 0,
      w: 600,
      h: 800,
      z: i + 1,
      version: 1,
      updatedAt: now,
      createdAt: now,
      label: col.label,
      fill: col.fill,
    }));
    await serverUpsertEntity(ctx.userId, "workspace:whiteboard", board);
    await serverBulkUpsertEntities(ctx.userId, "workspace:whiteboardObject", frames);
    return { boardId, sprintName: sprint.name, framesAdded: frames.length };
  },
});
