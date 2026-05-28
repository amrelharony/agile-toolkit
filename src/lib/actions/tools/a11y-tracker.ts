/**
 * Accessibility Audit Tracker — tool-local actions.
 *
 * Category: Security & Compliance (squad S9)
 * Tool:     WCAG issues by severity with fix burn-down and per-component
 *           coverage.
 *
 * Agent surface: tool.a11y_tracker.*
 * Backing CRUD : workspace.a11y_tracker.* (auto-generated). Singleton: one
 *                A11yTracker document (issues[]) under a fixed id.
 *
 *   1. list_state  — totals + bySeverity + byStatus + open count +
 *                    byComponent breakdown.
 *   2. add_issue   — log a WCAG issue (openedAt → today, status → open).
 *   3. set_status  — move an issue through its lifecycle; stamps resolvedAt
 *                    when it becomes "resolved".
 *
 * Entity kind "workspace:a11yTracker" + the fixed AT_ID match
 * a11y-tracker-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type {
  A11yTracker,
  A11yIssue,
  A11ySeverity,
  A11yStatus,
} from "@/lib/stores/workspace-types";

const KIND_A11Y = "workspace:a11yTracker";
// MUST match AT_ID in a11y-tracker-client.tsx.
const AT_ID = "a11yTracker:current";

const SEVERITIES = ["critical", "serious", "moderate", "minor"] as const;
const SeveritySchema = z.enum(SEVERITIES);
const STATUSES = ["open", "in_progress", "resolved"] as const;
const StatusSchema = z.enum(STATUSES);

const ws = () => useWorkspaceStore.getState();

const today = () => new Date().toISOString().slice(0, 10);

function emptyDoc(): A11yTracker {
  return { id: AT_ID, issues: [] };
}

function browserDoc(): A11yTracker | null {
  return (ws().a11yTrackers ?? []).find((d) => d.id === AT_ID) ?? null;
}

function summarize(doc: A11yTracker | null) {
  const issues = doc?.issues ?? [];
  const bySeverity: Record<A11ySeverity, number> = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
  };
  const byStatus: Record<A11yStatus, number> = { open: 0, in_progress: 0, resolved: 0 };
  const byComponent: Record<string, number> = {};
  let openCount = 0;
  for (const i of issues) {
    if (i.severity in bySeverity) bySeverity[i.severity] += 1;
    if (i.status in byStatus) byStatus[i.status] += 1;
    if (i.component) byComponent[i.component] = (byComponent[i.component] ?? 0) + 1;
    if (i.status !== "resolved") openCount += 1;
  }
  return {
    exists: doc !== null,
    total: issues.length,
    bySeverity,
    byStatus,
    byComponent,
    openCount,
    issues,
  };
}

// ──────── tool.a11y_tracker.list_state ────────
registry.register({
  id: "tool.a11y_tracker.list_state",
  toolId: "tool.a11y_tracker",
  name: "list_state",
  category: "read",
  description:
    "Summarise the accessibility audit. Returns {exists, total, bySeverity: {critical, serious, moderate, minor}, byStatus: {open, in_progress, resolved}, byComponent: Record<component, count>, openCount (not resolved), issues}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<A11yTracker>(ctx.userId, KIND_A11Y, AT_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.a11y_tracker.add_issue ────────
registry.register({
  id: "tool.a11y_tracker.add_issue",
  toolId: "tool.a11y_tracker",
  name: "add_issue",
  category: "write",
  requiresConfirmation: false,
  description:
    "Log a WCAG issue against a component. wcagCriterion is the success-criterion id (e.g. '1.4.3'); severity is critical|serious|moderate|minor; status defaults to 'open'; openedAt defaults to today. Creates the doc if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    component: z.string().min(1).max(200),
    wcagCriterion: z.string().min(1).max(50),
    severity: SeveritySchema,
    status: StatusSchema.optional(),
    description: z.string().max(2000).optional(),
    openedAt: z.string().optional().describe("YYYY-MM-DD; defaults to today."),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const issue = newIssue(params);
    ws().upsertA11yTracker({ ...base, id: AT_ID, issues: [...base.issues, issue] });
    return { added: true, id: issue.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = (await serverGetEntity<A11yTracker>(ctx.userId, KIND_A11Y, AT_ID)) ?? emptyDoc();
    const issue = newIssue(params);
    await serverUpsertEntity<A11yTracker>(ctx.userId, KIND_A11Y, {
      ...base,
      id: AT_ID,
      issues: [...base.issues, issue],
    });
    return { added: true, id: issue.id };
  },
});

// ──────── tool.a11y_tracker.set_status ────────
registry.register({
  id: "tool.a11y_tracker.set_status",
  toolId: "tool.a11y_tracker",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Set an issue's status (open | in_progress | resolved). Stamps resolvedAt when it becomes 'resolved'. Returns {updated: false} when the doc or issue id is unknown.",
  paramsSchema: z.object({
    issueId: z.string(),
    status: StatusSchema,
  }),
  handler: async (params) => {
    const next = applyStatus(browserDoc(), params.issueId, params.status);
    if (!next) return { updated: false };
    ws().upsertA11yTracker(next);
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<A11yTracker>(ctx.userId, KIND_A11Y, AT_ID);
    const next = applyStatus(base ?? null, params.issueId, params.status);
    if (!next) return { updated: false };
    await serverUpsertEntity<A11yTracker>(ctx.userId, KIND_A11Y, next);
    return { updated: true };
  },
});

function newIssue(params: {
  component: string;
  wcagCriterion: string;
  severity: A11ySeverity;
  status?: A11yStatus;
  description?: string;
  openedAt?: string;
}): A11yIssue {
  return {
    id: crypto.randomUUID(),
    component: params.component,
    wcagCriterion: params.wcagCriterion,
    severity: params.severity,
    status: params.status ?? "open",
    description: params.description,
    openedAt: params.openedAt ?? today(),
  };
}

function applyStatus(
  doc: A11yTracker | null,
  issueId: string,
  status: A11yStatus
): A11yTracker | null {
  if (!doc || !doc.issues.some((i) => i.id === issueId)) return null;
  return {
    ...doc,
    issues: doc.issues.map((i) => {
      if (i.id !== issueId) return i;
      return {
        ...i,
        status,
        resolvedAt: status === "resolved" ? (i.resolvedAt ?? today()) : undefined,
      };
    }),
  };
}
