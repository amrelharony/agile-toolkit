/**
 * Incident Commander — tool-local actions.
 *
 * Category: Incidents & Reliability (squad S8)
 * Tool:     Live incident board with severities, timelines, roles, MTTR.
 *
 * Agent surface: tool.incident_commander.*
 * Backing CRUD : workspace.incident_commander.* (auto-generated). Singleton:
 *                one IncidentCommander document (incidents[]) under a fixed id.
 *
 *   1. list_state          — incidents + status/severity tallies + avg MTTR.
 *   2. open_incident       — open an incident (status active, opens timeline).
 *   3. set_status          — active/mitigated/resolved (resolve stamps time).
 *   4. assign_role         — set/clear commander or scribe.
 *   5. add_timeline_entry  — append a timeline note.
 *   6. remove_incident     — delete an incident by id.
 *
 * Entity kind "workspace:incidentCommander" + the fixed IC_ID match
 * incident-commander-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type {
  IncidentCommander,
  Incident,
  IncidentTimelineEntry,
} from "@/lib/stores/workspace-types";

const KIND_IC = "workspace:incidentCommander";
// MUST match IC_ID in incident-commander-client.tsx.
const IC_ID = "incidentCommander:current";

const ws = () => useWorkspaceStore.getState();

const nowISO = () => new Date().toISOString();
const round2 = (n: number) => Math.round(n * 100) / 100;

function mttrHours(i: Incident): number | null {
  // resolvedAt survives a re-open; only a resolved incident has an MTTR.
  if (i.status !== "resolved" || !i.resolvedAt) return null;
  const ms = new Date(i.resolvedAt).getTime() - new Date(i.openedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / 3_600_000;
}

function emptyDoc(): IncidentCommander {
  return { id: IC_ID, incidents: [] };
}

function browserDoc(): IncidentCommander | null {
  return (ws().incidentCommanders ?? []).find((d) => d.id === IC_ID) ?? null;
}

function summarize(doc: IncidentCommander | null) {
  const incidents = doc?.incidents ?? [];
  const byStatus = { active: 0, mitigated: 0, resolved: 0 };
  const bySeverity = { sev1: 0, sev2: 0, sev3: 0, sev4: 0 };
  const mttrs: number[] = [];
  for (const i of incidents) {
    byStatus[i.status]++;
    bySeverity[i.severity]++;
    const m = mttrHours(i);
    if (m !== null) mttrs.push(m);
  }
  return {
    exists: doc !== null,
    total: incidents.length,
    activeCount: incidents.filter((i) => i.status !== "resolved").length,
    byStatus,
    bySeverity,
    avgMttrHours: mttrs.length ? round2(mttrs.reduce((a, b) => a + b, 0) / mttrs.length) : null,
    incidents: incidents.map((i) => ({
      id: i.id,
      title: i.title,
      severity: i.severity,
      status: i.status,
      openedAt: i.openedAt,
      resolvedAt: i.resolvedAt,
      commander: i.commander,
      scribe: i.scribe,
      timelineCount: i.timeline.length,
    })),
  };
}

// ──────── tool.incident_commander.list_state ────────
registry.register({
  id: "tool.incident_commander.list_state",
  toolId: "tool.incident_commander",
  name: "list_state",
  category: "read",
  description:
    "Summarise the incident board. Returns {exists, total, activeCount (status≠resolved), byStatus:{active,mitigated,resolved}, bySeverity:{sev1..sev4}, avgMttrHours (mean over resolved, null if none), incidents:{id,title,severity,status,openedAt,resolvedAt,commander,scribe,timelineCount}[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<IncidentCommander>(ctx.userId, KIND_IC, IC_ID);
    return summarize(doc ?? null);
  },
});

const openParams = z.object({
  title: z.string().min(1).max(240),
  severity: z.enum(["sev1", "sev2", "sev3", "sev4"]),
  commander: z.string().max(120).optional(),
  scribe: z.string().max(120).optional(),
  description: z.string().max(4000).optional(),
});

// ──────── tool.incident_commander.open_incident ────────
registry.register({
  id: "tool.incident_commander.open_incident",
  toolId: "tool.incident_commander",
  name: "open_incident",
  category: "write",
  requiresConfirmation: false,
  description:
    "Open an incident (status 'active', openedAt now, empty timeline). severity is sev1..sev4. Returns {opened: false} when the title is blank, else {opened: true, id}.",
  paramsSchema: openParams,
  handler: async (params) => {
    if (!params.title.trim()) return { opened: false };
    const base = browserDoc() ?? emptyDoc();
    const incident = newIncident(params);
    ws().upsertIncidentCommander({ ...base, id: IC_ID, incidents: [incident, ...base.incidents] });
    return { opened: true, id: incident.id };
  },
  mcpHandler: async (params, ctx) => {
    // Whitespace-only passes min(1); the UI trims and refuses a blank title.
    if (!params.title.trim()) return { opened: false };
    const base =
      (await serverGetEntity<IncidentCommander>(ctx.userId, KIND_IC, IC_ID)) ?? emptyDoc();
    const incident = newIncident(params);
    await serverUpsertEntity<IncidentCommander>(ctx.userId, KIND_IC, {
      ...base,
      id: IC_ID,
      incidents: [incident, ...base.incidents],
    });
    return { opened: true, id: incident.id };
  },
});

const statusParams = z.object({
  incidentId: z.string(),
  status: z.enum(["active", "mitigated", "resolved"]),
});

// ──────── tool.incident_commander.set_status ────────
registry.register({
  id: "tool.incident_commander.set_status",
  toolId: "tool.incident_commander",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set an incident's status. Moving to 'resolved' stamps resolvedAt (now) if unset. Returns {updated: false} when the id is unknown.",
  paramsSchema: statusParams,
  handler: async (params) => {
    const next = applyStatus(browserDoc(), params);
    if (!next) return { updated: false };
    ws().upsertIncidentCommander(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<IncidentCommander>(ctx.userId, KIND_IC, IC_ID);
    const next = applyStatus(base ?? null, params);
    if (!next) return { updated: false };
    await serverUpsertEntity<IncidentCommander>(ctx.userId, KIND_IC, next);
    return { updated: true };
  },
});

const roleParams = z.object({
  incidentId: z.string(),
  role: z.enum(["commander", "scribe"]),
  value: z.string().max(120),
});

// ──────── tool.incident_commander.assign_role ────────
registry.register({
  id: "tool.incident_commander.assign_role",
  toolId: "tool.incident_commander",
  name: "assign_role",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set the commander or scribe on an incident. An empty value clears the role. Returns {updated: false} when the id is unknown.",
  paramsSchema: roleParams,
  handler: async (params) => {
    const next = applyRole(browserDoc(), params);
    if (!next) return { updated: false };
    ws().upsertIncidentCommander(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<IncidentCommander>(ctx.userId, KIND_IC, IC_ID);
    const next = applyRole(base ?? null, params);
    if (!next) return { updated: false };
    await serverUpsertEntity<IncidentCommander>(ctx.userId, KIND_IC, next);
    return { updated: true };
  },
});

const timelineParams = z.object({
  incidentId: z.string(),
  text: z.string().min(1).max(2000),
  author: z.string().max(80).optional(),
});

// ──────── tool.incident_commander.add_timeline_entry ────────
registry.register({
  id: "tool.incident_commander.add_timeline_entry",
  toolId: "tool.incident_commander",
  name: "add_timeline_entry",
  category: "write",
  requiresConfirmation: false,
  description:
    "Append a timeline note to an incident (ts now; author defaults to 'agent'). Returns {added: false} when the id is unknown or the text is blank, else {added: true, id}.",
  paramsSchema: timelineParams,
  handler: async (params) => {
    const r = applyTimeline(browserDoc(), params);
    if (!r) return { added: false };
    ws().upsertIncidentCommander(r.doc);
    return { added: true, id: r.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<IncidentCommander>(ctx.userId, KIND_IC, IC_ID);
    const r = applyTimeline(base ?? null, params);
    if (!r) return { added: false };
    await serverUpsertEntity<IncidentCommander>(ctx.userId, KIND_IC, r.doc);
    return { added: true, id: r.id };
  },
});

// ──────── tool.incident_commander.remove_incident ────────
registry.register({
  id: "tool.incident_commander.remove_incident",
  toolId: "tool.incident_commander",
  name: "remove_incident",
  category: "write",
  requiresConfirmation: false,
  description: "Delete an incident by id. Returns {removed: false} when the id is unknown.",
  paramsSchema: z.object({ incidentId: z.string() }),
  handler: async (params) => {
    const next = applyRemove(browserDoc(), params.incidentId);
    if (!next) return { removed: false };
    ws().upsertIncidentCommander(next);
    return { removed: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<IncidentCommander>(ctx.userId, KIND_IC, IC_ID);
    const next = applyRemove(base ?? null, params.incidentId);
    if (!next) return { removed: false };
    await serverUpsertEntity<IncidentCommander>(ctx.userId, KIND_IC, next);
    return { removed: true };
  },
});

function newIncident(params: z.infer<typeof openParams>): Incident {
  return {
    id: crypto.randomUUID(),
    title: params.title.trim(),
    severity: params.severity,
    status: "active",
    openedAt: nowISO(),
    commander: params.commander,
    scribe: params.scribe,
    description: params.description,
    timeline: [],
  };
}

function applyStatus(
  doc: IncidentCommander | null,
  params: z.infer<typeof statusParams>
): IncidentCommander | null {
  if (!doc || !doc.incidents.some((i) => i.id === params.incidentId)) return null;
  return {
    ...doc,
    incidents: doc.incidents.map((i) => {
      if (i.id !== params.incidentId) return i;
      const patch: Partial<Incident> = { status: params.status };
      if (params.status === "resolved" && !i.resolvedAt) patch.resolvedAt = nowISO();
      return { ...i, ...patch };
    }),
  };
}

function applyRole(
  doc: IncidentCommander | null,
  params: z.infer<typeof roleParams>
): IncidentCommander | null {
  if (!doc || !doc.incidents.some((i) => i.id === params.incidentId)) return null;
  const trimmed = params.value.trim();
  return {
    ...doc,
    incidents: doc.incidents.map((i) =>
      i.id === params.incidentId ? { ...i, [params.role]: trimmed || undefined } : i
    ),
  };
}

function applyTimeline(
  doc: IncidentCommander | null,
  params: z.infer<typeof timelineParams>
): { doc: IncidentCommander; id: string } | null {
  if (!doc || !doc.incidents.some((i) => i.id === params.incidentId)) return null;
  // Whitespace-only text passes min(1); refuse it like the UI does.
  const text = params.text.trim();
  if (!text) return null;
  const entry: IncidentTimelineEntry = {
    id: crypto.randomUUID(),
    ts: nowISO(),
    author: params.author?.trim() || "agent",
    text,
  };
  return {
    doc: {
      ...doc,
      incidents: doc.incidents.map((i) =>
        i.id === params.incidentId ? { ...i, timeline: [...i.timeline, entry] } : i
      ),
    },
    id: entry.id,
  };
}

function applyRemove(doc: IncidentCommander | null, incidentId: string): IncidentCommander | null {
  if (!doc || !doc.incidents.some((i) => i.id === incidentId)) return null;
  return { ...doc, incidents: doc.incidents.filter((i) => i.id !== incidentId) };
}
