import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverUpsertEntity } from "../server-store";
import type { Impediment, ImpedimentSeverity } from "@/lib/stores/workspace-types";

/**
 * Compose-action: promote a retro-card insight into a workspace
 * impediment. The agent reads a sticky's text from the canvas (or
 * gets it directly from the user) and lands it into the impediments
 * collection so it shows up in the standup/retro reporting views.
 *
 * Defaults: severity = "medium", source = "retro", raisedAt = now.
 * Returns the new impedimentId so the caller can navigate or link
 * the canvas object back via sourceRef.
 */

registry.register({
  id: "intent.log_impediment_from_retro_card",
  toolId: "intent",
  name: "log_impediment_from_retro_card",
  category: "intent",
  description:
    "Create a workspace impediment from a retro card's text. Defaults severity to 'medium' and source to 'retro'. Returns the new impedimentId.",
  paramsSchema: z.object({
    text: z.string().min(1),
    severity: z.enum(["low", "medium", "high", "critical"]).optional(),
    owner: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
  handler: async (params: {
    text: string;
    severity?: ImpedimentSeverity;
    owner?: string;
    tags?: string[];
  }) => {
    const impediment: Impediment = {
      id: `imp_${nanoid(8)}`,
      title: params.text,
      severity: params.severity ?? "medium",
      raisedAt: new Date().toISOString(),
      source: "retro",
      owner: params.owner,
      tags: params.tags,
    };
    useWorkspaceStore.getState().upsertImpediment(impediment);
    return { impedimentId: impediment.id };
  },
  mcpHandler: async (params, ctx) => {
    const impediment: Impediment = {
      id: `imp_${nanoid(8)}`,
      title: params.text,
      severity: params.severity ?? "medium",
      raisedAt: new Date().toISOString(),
      source: "retro",
      owner: params.owner,
      tags: params.tags,
    };
    await serverUpsertEntity<Impediment>(ctx.userId, "workspace:impediment", impediment);
    return { impedimentId: impediment.id };
  },
});
