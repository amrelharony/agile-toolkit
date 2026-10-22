/**
 * Threat Model Registry — tool-local actions.
 *
 * Category: Security & Compliance (squad S9)
 * Tool:     STRIDE-based threat catalog per service with mitigation status.
 *
 * Agent surface: tool.threat_model.*
 * Backing CRUD : workspace.threat_model.* (auto-generated). Singleton: one
 *                ThreatModel document (threats[]) under a fixed id.
 *
 *   1. list_state  — totals + byCategory (STRIDE) + byStatus + open count +
 *                    average severity.
 *   2. add_threat  — log a threat (raisedAt → today, status → open).
 *   3. set_status  — move a threat through its lifecycle; stamps mitigatedAt
 *                    when it becomes "mitigated".
 *
 * Entity kind "workspace:threatModel" (kindFromToolId of
 * "workspace.threat_model") + the fixed TM_ID match threat-model-client.tsx,
 * so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import { todayLocalISO } from "@/lib/utils/formatters";
import type { ThreatModel, Threat, ThreatStride, ThreatStatus } from "@/lib/stores/workspace-types";

const KIND_THREAT_MODEL = "workspace:threatModel";
// MUST match TM_ID in threat-model-client.tsx.
const TM_ID = "threatModel:current";

const STRIDE = [
  "spoofing",
  "tampering",
  "repudiation",
  "information_disclosure",
  "denial_of_service",
  "elevation_of_privilege",
] as const;
const StrideSchema = z.enum(STRIDE);

const STATUSES = ["open", "mitigating", "mitigated", "accepted"] as const;
const StatusSchema = z.enum(STATUSES);

const ws = () => useWorkspaceStore.getState();

// Local calendar date, the same stamp the client writes (todayLocalISO);
// a UTC date was a day off around midnight.
const today = () => todayLocalISO();

function emptyModel(): ThreatModel {
  return { id: TM_ID, threats: [] };
}

function browserModel(): ThreatModel | null {
  return (ws().threatModels ?? []).find((m) => m.id === TM_ID) ?? null;
}

function summarize(model: ThreatModel | null) {
  const threats = model?.threats ?? [];
  const byCategory: Record<ThreatStride, number> = {
    spoofing: 0,
    tampering: 0,
    repudiation: 0,
    information_disclosure: 0,
    denial_of_service: 0,
    elevation_of_privilege: 0,
  };
  const byStatus: Record<ThreatStatus, number> = {
    open: 0,
    mitigating: 0,
    mitigated: 0,
    accepted: 0,
  };
  let severitySum = 0;
  let openCount = 0;
  for (const t of threats) {
    if (t.category in byCategory) byCategory[t.category] += 1;
    if (t.status in byStatus) byStatus[t.status] += 1;
    severitySum += t.severity;
    // "Open" = not yet resolved: anything other than mitigated/accepted.
    if (t.status !== "mitigated" && t.status !== "accepted") openCount += 1;
  }
  return {
    exists: model !== null,
    total: threats.length,
    byCategory,
    byStatus,
    openCount,
    avgSeverity: threats.length ? Math.round((severitySum / threats.length) * 100) / 100 : 0,
    threats,
  };
}

// ──────── tool.threat_model.list_state ────────
registry.register({
  id: "tool.threat_model.list_state",
  toolId: "tool.threat_model",
  name: "list_state",
  category: "read",
  description:
    "Summarise the threat model. Returns {exists, total, byCategory (STRIDE counts), byStatus: {open, mitigating, mitigated, accepted}, openCount (not mitigated/accepted), avgSeverity (1..5), threats}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserModel()),
  mcpHandler: async (_params, ctx) => {
    const model = await serverGetEntity<ThreatModel>(ctx.userId, KIND_THREAT_MODEL, TM_ID);
    return summarize(model ?? null);
  },
});

// ──────── tool.threat_model.add_threat ────────
registry.register({
  id: "tool.threat_model.add_threat",
  toolId: "tool.threat_model",
  name: "add_threat",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a threat to a service. category is a STRIDE class; severity 1 (low) … 5 (critical); status defaults to 'open'. raisedAt defaults to today. Creates the model if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    service: z.string().min(1).max(200),
    category: StrideSchema,
    severity: z.number().int().min(1).max(5),
    status: StatusSchema.optional(),
    mitigation: z.string().max(2000).optional(),
    description: z.string().max(2000).optional(),
  }),
  handler: async (params) => {
    const base = browserModel() ?? emptyModel();
    const threat = newThreat(params);
    ws().upsertThreatModel({ ...base, id: TM_ID, threats: [...base.threats, threat] });
    return { added: true, id: threat.id };
  },
  mcpHandler: async (params, ctx) => {
    const base =
      (await serverGetEntity<ThreatModel>(ctx.userId, KIND_THREAT_MODEL, TM_ID)) ?? emptyModel();
    const threat = newThreat(params);
    await serverUpsertEntity<ThreatModel>(ctx.userId, KIND_THREAT_MODEL, {
      ...base,
      id: TM_ID,
      threats: [...base.threats, threat],
    });
    return { added: true, id: threat.id };
  },
});

// ──────── tool.threat_model.set_status ────────
// Stamps mitigatedAt when the threat first becomes "mitigated" (cleared if it
// moves back out). Additive in spirit → no confirmation.
registry.register({
  id: "tool.threat_model.set_status",
  toolId: "tool.threat_model",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set a threat's status (open | mitigating | mitigated | accepted). Stamps mitigatedAt when it becomes 'mitigated'. Returns {updated: false} when the model or threat id is unknown.",
  paramsSchema: z.object({
    threatId: z.string(),
    status: StatusSchema,
  }),
  handler: async (params) => {
    const base = browserModel();
    const next = applyStatus(base, params.threatId, params.status);
    if (!next) return { updated: false };
    ws().upsertThreatModel(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<ThreatModel>(ctx.userId, KIND_THREAT_MODEL, TM_ID);
    const next = applyStatus(base ?? null, params.threatId, params.status);
    if (!next) return { updated: false };
    await serverUpsertEntity<ThreatModel>(ctx.userId, KIND_THREAT_MODEL, next);
    return { updated: true };
  },
});

function newThreat(params: {
  service: string;
  category: ThreatStride;
  severity: number;
  status?: ThreatStatus;
  mitigation?: string;
  description?: string;
}): Threat {
  return {
    id: crypto.randomUUID(),
    service: params.service,
    category: params.category,
    severity: params.severity,
    status: params.status ?? "open",
    mitigation: params.mitigation,
    description: params.description,
    raisedAt: today(),
  };
}

/** Return a new model with the threat's status applied (mitigatedAt stamped/
 *  cleared), or null when the model / threat id is unknown. */
function applyStatus(
  model: ThreatModel | null,
  threatId: string,
  status: ThreatStatus
): ThreatModel | null {
  if (!model || !model.threats.some((t) => t.id === threatId)) return null;
  return {
    ...model,
    threats: model.threats.map((t) => {
      if (t.id !== threatId) return t;
      return {
        ...t,
        status,
        mitigatedAt: status === "mitigated" ? (t.mitigatedAt ?? today()) : undefined,
      };
    }),
  };
}
