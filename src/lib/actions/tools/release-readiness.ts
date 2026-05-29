/**
 * Release Readiness — tool-local actions.
 *
 * Category: Incidents & Reliability (squad S8)
 * Tool:     Launch-readiness gates with ship / rollback tracking.
 *
 * Agent surface: tool.release_readiness.*
 * Backing CRUD : workspace.release_readiness.* (auto-generated). Singleton: one
 *                ReleaseReadiness document (releases[]) under a fixed id.
 *
 *   1. list_state     — releases + counts by status + per-release gate tallies.
 *   2. add_release    — add a release (planning, all gates open).
 *   3. toggle_gate    — flip one readiness gate by id.
 *   4. ship_release   — mark shipped + snapshot gatesOpenAtShip.
 *   5. set_status     — reopen (planning) or roll back a release.
 *   6. remove_release — delete a release by id.
 *
 * Entity kind "workspace:releaseReadiness" + the fixed RR_ID match
 * release-readiness-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import {
  RELEASE_GATE_IDS,
  type ReleaseReadiness,
  type Release,
  type GateId,
} from "@/lib/stores/workspace-types";

const KIND_RR = "workspace:releaseReadiness";
// MUST match RR_ID in release-readiness-client.tsx.
const RR_ID = "releaseReadiness:current";

const ws = () => useWorkspaceStore.getState();

const todayISO = () => new Date().toISOString().slice(0, 10);

const isGateId = (g: string): g is GateId => (RELEASE_GATE_IDS as string[]).includes(g);

function emptyGates(): Record<GateId, boolean> {
  return RELEASE_GATE_IDS.reduce(
    (acc, id) => {
      acc[id] = false;
      return acc;
    },
    {} as Record<GateId, boolean>
  );
}

function gatesPassed(r: Release): number {
  return RELEASE_GATE_IDS.filter((id) => r.gates[id]).length;
}

function emptyDoc(): ReleaseReadiness {
  return { id: RR_ID, releases: [] };
}

function browserDoc(): ReleaseReadiness | null {
  return (ws().releaseReadinesses ?? []).find((d) => d.id === RR_ID) ?? null;
}

function summarize(doc: ReleaseReadiness | null) {
  const releases = doc?.releases ?? [];
  const byStatus = { planning: 0, shipped: 0, rolled_back: 0 };
  for (const r of releases) byStatus[r.status]++;
  return {
    exists: doc !== null,
    total: releases.length,
    byStatus,
    releases: releases.map((r) => {
      const passed = gatesPassed(r);
      return {
        id: r.id,
        name: r.name,
        status: r.status,
        plannedDate: r.plannedDate,
        shippedDate: r.shippedDate,
        gatesPassed: passed,
        gatesTotal: RELEASE_GATE_IDS.length,
        allGatesPassed: passed === RELEASE_GATE_IDS.length,
        gatesOpenAtShip: r.gatesOpenAtShip,
      };
    }),
  };
}

// ──────── tool.release_readiness.list_state ────────
registry.register({
  id: "tool.release_readiness.list_state",
  toolId: "tool.release_readiness",
  name: "list_state",
  category: "read",
  description:
    "Summarise release readiness. Returns {exists, total, byStatus:{planning,shipped,rolled_back}, releases:{id,name,status,plannedDate,shippedDate,gatesPassed,gatesTotal,allGatesPassed,gatesOpenAtShip}[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<ReleaseReadiness>(ctx.userId, KIND_RR, RR_ID);
    return summarize(doc ?? null);
  },
});

const addParams = z.object({
  name: z.string().min(1).max(200),
  plannedDate: z.string().max(40).optional(),
  description: z.string().max(2000).optional(),
});

// ──────── tool.release_readiness.add_release ────────
registry.register({
  id: "tool.release_readiness.add_release",
  toolId: "tool.release_readiness",
  name: "add_release",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a release. Starts in 'planning' with all readiness gates open. plannedDate defaults to today (YYYY-MM-DD). Returns {added: true, id}.",
  paramsSchema: addParams,
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const release = newRelease(params);
    ws().upsertReleaseReadiness({ ...base, id: RR_ID, releases: [release, ...base.releases] });
    return { added: true, id: release.id };
  },
  mcpHandler: async (params, ctx) => {
    const base =
      (await serverGetEntity<ReleaseReadiness>(ctx.userId, KIND_RR, RR_ID)) ?? emptyDoc();
    const release = newRelease(params);
    await serverUpsertEntity<ReleaseReadiness>(ctx.userId, KIND_RR, {
      ...base,
      id: RR_ID,
      releases: [release, ...base.releases],
    });
    return { added: true, id: release.id };
  },
});

const toggleParams = z.object({
  releaseId: z.string(),
  gate: z.string(),
  passed: z.boolean(),
});

// ──────── tool.release_readiness.toggle_gate ────────
registry.register({
  id: "tool.release_readiness.toggle_gate",
  toolId: "tool.release_readiness",
  name: "toggle_gate",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set one readiness gate's pass/fail by id. gate must be one of: " +
    RELEASE_GATE_IDS.join(", ") +
    ". Returns {updated: false} when the release or gate id is unknown.",
  paramsSchema: toggleParams,
  handler: async (params) => {
    const next = applyToggle(browserDoc(), params);
    if (!next) return { updated: false };
    ws().upsertReleaseReadiness(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<ReleaseReadiness>(ctx.userId, KIND_RR, RR_ID);
    const next = applyToggle(base ?? null, params);
    if (!next) return { updated: false };
    await serverUpsertEntity<ReleaseReadiness>(ctx.userId, KIND_RR, next);
    return { updated: true };
  },
});

// ──────── tool.release_readiness.ship_release ────────
registry.register({
  id: "tool.release_readiness.ship_release",
  toolId: "tool.release_readiness",
  name: "ship_release",
  category: "write",
  requiresConfirmation: false,
  description:
    "Mark a release shipped (sets shippedDate today) and snapshot the open-gate count. Open gates do NOT block shipping. Returns {shipped, gatesOpenAtShip} or {shipped:false} when the id is unknown.",
  paramsSchema: z.object({ releaseId: z.string() }),
  handler: async (params) => {
    const r = applyShip(browserDoc(), params.releaseId);
    if (!r) return { shipped: false };
    ws().upsertReleaseReadiness(r.doc);
    return { shipped: true, gatesOpenAtShip: r.gatesOpenAtShip };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<ReleaseReadiness>(ctx.userId, KIND_RR, RR_ID);
    const r = applyShip(base ?? null, params.releaseId);
    if (!r) return { shipped: false };
    await serverUpsertEntity<ReleaseReadiness>(ctx.userId, KIND_RR, r.doc);
    return { shipped: true, gatesOpenAtShip: r.gatesOpenAtShip };
  },
});

const statusParams = z.object({
  releaseId: z.string(),
  status: z.enum(["planning", "rolled_back"]),
});

// ──────── tool.release_readiness.set_status ────────
registry.register({
  id: "tool.release_readiness.set_status",
  toolId: "tool.release_readiness",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Reopen a release for 'planning' (clears shippedDate) or mark it 'rolled_back'. Use ship_release to ship. Returns {updated: false} when the id is unknown.",
  paramsSchema: statusParams,
  handler: async (params) => {
    const next = applyStatus(browserDoc(), params);
    if (!next) return { updated: false };
    ws().upsertReleaseReadiness(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<ReleaseReadiness>(ctx.userId, KIND_RR, RR_ID);
    const next = applyStatus(base ?? null, params);
    if (!next) return { updated: false };
    await serverUpsertEntity<ReleaseReadiness>(ctx.userId, KIND_RR, next);
    return { updated: true };
  },
});

// ──────── tool.release_readiness.remove_release ────────
registry.register({
  id: "tool.release_readiness.remove_release",
  toolId: "tool.release_readiness",
  name: "remove_release",
  category: "write",
  requiresConfirmation: false,
  description: "Delete a release by id. Returns {removed: false} when the id is unknown.",
  paramsSchema: z.object({ releaseId: z.string() }),
  handler: async (params) => {
    const next = applyRemove(browserDoc(), params.releaseId);
    if (!next) return { removed: false };
    ws().upsertReleaseReadiness(next);
    return { removed: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<ReleaseReadiness>(ctx.userId, KIND_RR, RR_ID);
    const next = applyRemove(base ?? null, params.releaseId);
    if (!next) return { removed: false };
    await serverUpsertEntity<ReleaseReadiness>(ctx.userId, KIND_RR, next);
    return { removed: true };
  },
});

function newRelease(params: z.infer<typeof addParams>): Release {
  return {
    id: crypto.randomUUID(),
    name: params.name,
    plannedDate: params.plannedDate || todayISO(),
    status: "planning",
    gates: emptyGates(),
    description: params.description,
  };
}

function applyToggle(
  doc: ReleaseReadiness | null,
  params: z.infer<typeof toggleParams>
): ReleaseReadiness | null {
  if (!doc || !isGateId(params.gate)) return null;
  if (!doc.releases.some((r) => r.id === params.releaseId)) return null;
  return {
    ...doc,
    releases: doc.releases.map((r) =>
      r.id === params.releaseId ? { ...r, gates: { ...r.gates, [params.gate]: params.passed } } : r
    ),
  };
}

function applyShip(
  doc: ReleaseReadiness | null,
  releaseId: string
): { doc: ReleaseReadiness; gatesOpenAtShip: number } | null {
  const release = doc?.releases.find((r) => r.id === releaseId);
  if (!doc || !release) return null;
  const gatesOpenAtShip = RELEASE_GATE_IDS.filter((id) => !release.gates[id]).length;
  return {
    doc: {
      ...doc,
      releases: doc.releases.map((r) =>
        r.id === releaseId
          ? { ...r, status: "shipped", shippedDate: todayISO(), gatesOpenAtShip }
          : r
      ),
    },
    gatesOpenAtShip,
  };
}

function applyStatus(
  doc: ReleaseReadiness | null,
  params: z.infer<typeof statusParams>
): ReleaseReadiness | null {
  if (!doc || !doc.releases.some((r) => r.id === params.releaseId)) return null;
  return {
    ...doc,
    releases: doc.releases.map((r) =>
      r.id === params.releaseId
        ? {
            ...r,
            status: params.status,
            ...(params.status === "planning" ? { shippedDate: undefined } : {}),
          }
        : r
    ),
  };
}

function applyRemove(doc: ReleaseReadiness | null, releaseId: string): ReleaseReadiness | null {
  if (!doc || !doc.releases.some((r) => r.id === releaseId)) return null;
  return { ...doc, releases: doc.releases.filter((r) => r.id !== releaseId) };
}
