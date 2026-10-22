/**
 * Compliance Control Map — tool-local actions.
 *
 * Category: Security & Compliance (squad S9)
 * Tool:     Map team controls to SOC2 / ISO 27001 / HIPAA / GDPR categories
 *           with evidence links.
 *
 * Agent surface: tool.control_map.*
 * Backing CRUD : workspace.control_map.* (auto-generated). Singleton: one
 *                ControlMap document (controls[]) under a fixed id.
 *
 *   1. list_state    — totals + byFramework + byStatus + implemented count.
 *   2. add_control   — register a control (status → not_started).
 *   3. set_status    — move a control through its lifecycle.
 *   4. add_evidence  — append an evidence link to a control.
 *
 * Entity kind "workspace:controlMap" + the fixed CM_ID match
 * control-map-client.tsx, so MCP writes round-trip into the UI. Evidence
 * links go through the page's sanitizeEvidenceUrl: http(s) only (the page
 * renders them as <a href>), scheme-less links get https.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type {
  ControlMap,
  ComplianceControl,
  ControlFramework,
  ControlStatus,
} from "@/lib/stores/workspace-types";
import { sanitizeEvidenceUrl } from "@/app/(tools)/control-map/evidence-url";

const KIND_CONTROL_MAP = "workspace:controlMap";
// MUST match CM_ID in control-map-client.tsx.
const CM_ID = "controlMap:current";

const FRAMEWORKS = ["soc2", "iso27001", "hipaa", "gdpr", "custom"] as const;
const FrameworkSchema = z.enum(FRAMEWORKS);
const STATUSES = ["not_started", "in_progress", "implemented", "verified"] as const;
const StatusSchema = z.enum(STATUSES);

const ws = () => useWorkspaceStore.getState();

function emptyDoc(): ControlMap {
  return { id: CM_ID, controls: [] };
}

function browserDoc(): ControlMap | null {
  return (ws().controlMaps ?? []).find((d) => d.id === CM_ID) ?? null;
}

function summarize(doc: ControlMap | null) {
  const controls = doc?.controls ?? [];
  const byFramework: Record<ControlFramework, number> = {
    soc2: 0,
    iso27001: 0,
    hipaa: 0,
    gdpr: 0,
    custom: 0,
  };
  const byStatus: Record<ControlStatus, number> = {
    not_started: 0,
    in_progress: 0,
    implemented: 0,
    verified: 0,
  };
  let implementedCount = 0;
  for (const c of controls) {
    if (c.framework in byFramework) byFramework[c.framework] += 1;
    if (c.status in byStatus) byStatus[c.status] += 1;
    // "Implemented" coverage counts both implemented and verified controls.
    if (c.status === "implemented" || c.status === "verified") implementedCount += 1;
  }
  return {
    exists: doc !== null,
    total: controls.length,
    byFramework,
    byStatus,
    implementedCount,
    coverage: controls.length ? Math.round((implementedCount / controls.length) * 100) / 100 : 0,
    controls,
  };
}

// ──────── tool.control_map.list_state ────────
registry.register({
  id: "tool.control_map.list_state",
  toolId: "tool.control_map",
  name: "list_state",
  category: "read",
  description:
    "Summarise the control map. Returns {exists, total, byFramework: {soc2, iso27001, hipaa, gdpr, custom}, byStatus: {not_started, in_progress, implemented, verified}, implementedCount (implemented + verified), coverage (0..1), controls}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<ControlMap>(ctx.userId, KIND_CONTROL_MAP, CM_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.control_map.add_control ────────
registry.register({
  id: "tool.control_map.add_control",
  toolId: "tool.control_map",
  name: "add_control",
  category: "write",
  requiresConfirmation: false,
  description:
    "Register a control. controlId is the framework's control number (e.g. 'CC6.1'); framework is soc2|iso27001|hipaa|gdpr|custom; status defaults to 'not_started'. evidenceLinks must be http(s) URLs (a link without a scheme gets https; any other link is dropped). Creates the doc if absent. Returns {added: true, id} (id is the row id, distinct from controlId).",
  paramsSchema: z.object({
    controlId: z.string().min(1).max(100),
    framework: FrameworkSchema,
    title: z.string().min(1).max(300),
    status: StatusSchema.optional(),
    owner: z.string().max(200).optional(),
    evidenceLinks: z.array(z.string()).optional(),
    description: z.string().max(2000).optional(),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const control = newControl(params);
    ws().upsertControlMap({ ...base, id: CM_ID, controls: [...base.controls, control] });
    return { added: true, id: control.id };
  },
  mcpHandler: async (params, ctx) => {
    const base =
      (await serverGetEntity<ControlMap>(ctx.userId, KIND_CONTROL_MAP, CM_ID)) ?? emptyDoc();
    const control = newControl(params);
    await serverUpsertEntity<ControlMap>(ctx.userId, KIND_CONTROL_MAP, {
      ...base,
      id: CM_ID,
      controls: [...base.controls, control],
    });
    return { added: true, id: control.id };
  },
});

// ──────── tool.control_map.set_status ────────
registry.register({
  id: "tool.control_map.set_status",
  toolId: "tool.control_map",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set a control's status (not_started | in_progress | implemented | verified) by its row id. Returns {updated: false} when the doc or control id is unknown.",
  paramsSchema: z.object({
    id: z.string().describe("The control's row id (from list_state), not the framework controlId."),
    status: StatusSchema,
  }),
  handler: async (params) => {
    const next = mutateControl(browserDoc(), params.id, (c) => ({ ...c, status: params.status }));
    if (!next) return { updated: false };
    ws().upsertControlMap(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<ControlMap>(ctx.userId, KIND_CONTROL_MAP, CM_ID);
    const next = mutateControl(base ?? null, params.id, (c) => ({ ...c, status: params.status }));
    if (!next) return { updated: false };
    await serverUpsertEntity<ControlMap>(ctx.userId, KIND_CONTROL_MAP, next);
    return { updated: true };
  },
});

// ──────── tool.control_map.add_evidence ────────
registry.register({
  id: "tool.control_map.add_evidence",
  toolId: "tool.control_map",
  name: "add_evidence",
  category: "write",
  requiresConfirmation: false,
  description:
    "Append an evidence link to a control (by row id). The link must be an http(s) URL; one without a scheme gets https. Returns {updated: false, reason: 'invalid_link'} for any other link, {updated: false} when the doc or control id is unknown.",
  paramsSchema: z.object({
    id: z.string().describe("The control's row id (from list_state)."),
    link: z.string().min(1).max(2000),
  }),
  handler: async (params) => {
    const link = sanitizeEvidenceUrl(params.link);
    if (!link) return { updated: false, reason: "invalid_link" as const };
    const next = mutateControl(browserDoc(), params.id, (c) => ({
      ...c,
      evidenceLinks: [...c.evidenceLinks, link],
    }));
    if (!next) return { updated: false };
    ws().upsertControlMap(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const link = sanitizeEvidenceUrl(params.link);
    if (!link) return { updated: false, reason: "invalid_link" as const };
    const base = await serverGetEntity<ControlMap>(ctx.userId, KIND_CONTROL_MAP, CM_ID);
    const next = mutateControl(base ?? null, params.id, (c) => ({
      ...c,
      evidenceLinks: [...c.evidenceLinks, link],
    }));
    if (!next) return { updated: false };
    await serverUpsertEntity<ControlMap>(ctx.userId, KIND_CONTROL_MAP, next);
    return { updated: true };
  },
});

function newControl(params: {
  controlId: string;
  framework: ControlFramework;
  title: string;
  status?: ControlStatus;
  owner?: string;
  evidenceLinks?: string[];
  description?: string;
}): ComplianceControl {
  return {
    id: crypto.randomUUID(),
    controlId: params.controlId,
    framework: params.framework,
    title: params.title,
    status: params.status ?? "not_started",
    owner: params.owner,
    evidenceLinks: (params.evidenceLinks ?? [])
      .map(sanitizeEvidenceUrl)
      .filter((l): l is string => l !== null),
    description: params.description,
  };
}

/** Return a new doc with one control transformed, or null when the doc /
 *  control id is unknown. */
function mutateControl(
  doc: ControlMap | null,
  id: string,
  fn: (c: ComplianceControl) => ComplianceControl
): ControlMap | null {
  if (!doc || !doc.controls.some((c) => c.id === id)) return null;
  return { ...doc, controls: doc.controls.map((c) => (c.id === id ? fn(c) : c)) };
}
