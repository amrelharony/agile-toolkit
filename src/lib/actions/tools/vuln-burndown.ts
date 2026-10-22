/**
 * Vulnerability Burn-Down — tool-local actions.
 *
 * Category: Security & Compliance (squad S9)
 * Tool:     Track open vulnerabilities by severity with SLA aging.
 *
 * Agent surface: tool.vuln_burndown.*
 * Backing CRUD : workspace.vuln_burndown.* (auto-generated). Singleton: one
 *                VulnBurndown document (vulns[]) under a fixed id.
 *
 *   1. list_state  — totals + bySeverity + byStatus + open + overdue (past
 *                    SLA) counts.
 *   2. add_vuln    — log a vulnerability (openedAt → today, status → open).
 *   3. set_status  — move a vuln through its lifecycle; stamps resolvedAt
 *                    when it becomes "resolved".
 *
 * Entity kind "workspace:vulnBurndown" + the fixed VB_ID match
 * vuln-burndown-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import { todayLocalISO } from "@/lib/utils/formatters";
import type {
  VulnBurndown,
  Vulnerability,
  VulnSeverity,
  VulnStatus,
} from "@/lib/stores/workspace-types";

const KIND_VULN = "workspace:vulnBurndown";
// MUST match VB_ID in vuln-burndown-client.tsx.
const VB_ID = "vulnBurndown:current";

const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const SeveritySchema = z.enum(SEVERITIES);
const STATUSES = ["open", "in_progress", "resolved", "accepted"] as const;
const StatusSchema = z.enum(STATUSES);

const ws = () => useWorkspaceStore.getState();

// Local calendar date, the same stamp the client writes (todayLocalISO);
// a UTC date was a day off around midnight.
const today = () => todayLocalISO();

const DAY_MS = 86_400_000;

/** Whole local-calendar days from a YYYY-MM-DD date to `now`, or null when
 *  the date doesn't parse — the client's age rule, so "overdue" here means
 *  what its "SLA breaches" KPI means (age > slaTargetDays). */
function ageDays(openedAt: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(openedAt);
  if (!m) return null;
  const from = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.max(0, Math.round((to - from) / DAY_MS));
}

function emptyDoc(): VulnBurndown {
  return { id: VB_ID, vulns: [] };
}

function browserDoc(): VulnBurndown | null {
  return (ws().vulnBurndowns ?? []).find((d) => d.id === VB_ID) ?? null;
}

/** A vuln is "active" until resolved/accepted. */
function isActive(v: Vulnerability) {
  return v.status !== "resolved" && v.status !== "accepted";
}

function summarize(doc: VulnBurndown | null) {
  const vulns = doc?.vulns ?? [];
  const bySeverity: Record<VulnSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const byStatus: Record<VulnStatus, number> = {
    open: 0,
    in_progress: 0,
    resolved: 0,
    accepted: 0,
  };
  let openCount = 0;
  let overdueCount = 0;
  const now = new Date();
  for (const v of vulns) {
    if (v.severity in bySeverity) bySeverity[v.severity] += 1;
    if (v.status in byStatus) byStatus[v.status] += 1;
    if (isActive(v)) {
      openCount += 1;
      // Overdue = active AND its age in local days exceeds the SLA target.
      const age = ageDays(v.openedAt, now);
      if (age !== null && age > v.slaTargetDays) overdueCount += 1;
    }
  }
  return {
    exists: doc !== null,
    total: vulns.length,
    bySeverity,
    byStatus,
    openCount,
    overdueCount,
    vulns,
  };
}

// ──────── tool.vuln_burndown.list_state ────────
registry.register({
  id: "tool.vuln_burndown.list_state",
  toolId: "tool.vuln_burndown",
  name: "list_state",
  category: "read",
  description:
    "Summarise the vulnerability burndown. Returns {exists, total, bySeverity: {critical, high, medium, low}, byStatus: {open, in_progress, resolved, accepted}, openCount (not resolved/accepted), overdueCount (active + past SLA), vulns}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<VulnBurndown>(ctx.userId, KIND_VULN, VB_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.vuln_burndown.add_vuln ────────
registry.register({
  id: "tool.vuln_burndown.add_vuln",
  toolId: "tool.vuln_burndown",
  name: "add_vuln",
  category: "write",
  requiresConfirmation: false,
  description:
    "Log a vulnerability. severity is critical|high|medium|low; status defaults to 'open'; slaTargetDays is the remediation SLA window; openedAt defaults to today. Creates the doc if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    severity: SeveritySchema,
    slaTargetDays: z.number().int().min(0),
    status: StatusSchema.optional(),
    cve: z.string().max(50).optional(),
    owner: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    openedAt: z.string().optional().describe("YYYY-MM-DD; defaults to today."),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const vuln = newVuln(params);
    ws().upsertVulnBurndown({ ...base, id: VB_ID, vulns: [...base.vulns, vuln] });
    return { added: true, id: vuln.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<VulnBurndown>(ctx.userId, KIND_VULN, VB_ID)) ?? emptyDoc();
    const vuln = newVuln(params);
    await serverUpsertEntity<VulnBurndown>(ctx.userId, KIND_VULN, {
      ...base,
      id: VB_ID,
      vulns: [...base.vulns, vuln],
    });
    return { added: true, id: vuln.id };
  },
});

// ──────── tool.vuln_burndown.set_status ────────
registry.register({
  id: "tool.vuln_burndown.set_status",
  toolId: "tool.vuln_burndown",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set a vulnerability's status (open | in_progress | resolved | accepted). Stamps resolvedAt when it becomes 'resolved'. Returns {updated: false} when the doc or vuln id is unknown.",
  paramsSchema: z.object({
    vulnId: z.string(),
    status: StatusSchema,
  }),
  handler: async (params) => {
    const next = applyStatus(browserDoc(), params.vulnId, params.status);
    if (!next) return { updated: false };
    ws().upsertVulnBurndown(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<VulnBurndown>(ctx.userId, KIND_VULN, VB_ID);
    const next = applyStatus(base ?? null, params.vulnId, params.status);
    if (!next) return { updated: false };
    await serverUpsertEntity<VulnBurndown>(ctx.userId, KIND_VULN, next);
    return { updated: true };
  },
});

function newVuln(params: {
  severity: VulnSeverity;
  slaTargetDays: number;
  status?: VulnStatus;
  cve?: string;
  owner?: string;
  description?: string;
  openedAt?: string;
}): Vulnerability {
  return {
    id: crypto.randomUUID(),
    cve: params.cve,
    severity: params.severity,
    status: params.status ?? "open",
    slaTargetDays: params.slaTargetDays,
    owner: params.owner,
    description: params.description,
    openedAt: params.openedAt ?? today(),
  };
}

function applyStatus(
  doc: VulnBurndown | null,
  vulnId: string,
  status: VulnStatus
): VulnBurndown | null {
  if (!doc || !doc.vulns.some((v) => v.id === vulnId)) return null;
  return {
    ...doc,
    vulns: doc.vulns.map((v) => {
      if (v.id !== vulnId) return v;
      return {
        ...v,
        status,
        resolvedAt: status === "resolved" ? (v.resolvedAt ?? today()) : undefined,
      };
    }),
  };
}
