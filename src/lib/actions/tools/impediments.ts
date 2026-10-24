/**
 * Impediments — tool-local actions.
 *
 * Category: Ceremonies (squad S3 — run the sprint)
 *
 * Agent surface: tool.impediments.*
 * Backing CRUD : workspace.impediment.* (auto-generated), the one store the
 *                Impediments page, the cockpit and hand-offs use. Status is
 *                derived from `resolvedAt` / `escalatedAt`
 *                (lib/impediments/model), so changing it goes through
 *                set_status rather than a hand-written date.
 *
 *   1. list_state — counts by status, overdue and critical ones, average
 *                   days to resolve, and the list in the page's order with
 *                   each one's status, age and due date.
 *   2. set_status — open | escalated | resolved, on a day (default today):
 *                   escalate, resolve, or reopen.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverListEntities, serverUpsertEntity } from "../server-store";
import type { Impediment } from "@/lib/stores/workspace-types";
import {
  daysOverdue,
  impedimentAgeDays,
  impedimentDueDate,
  impedimentStatus,
  impedimentSummary,
  sortImpediments,
  withImpedimentStatus,
} from "@/lib/impediments/model";

const KIND_IMP = "workspace:impediment";

const ws = () => useWorkspaceStore.getState();

/** Server-side "today" (UTC): an MCP agent has no locale. */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function listState(list: Impediment[], today: string) {
  return {
    today,
    ...impedimentSummary(list, today),
    impediments: sortImpediments(list, today).map((i) => ({
      ...i,
      status: impedimentStatus(i),
      ageDays: impedimentAgeDays(i, today),
      due: impedimentDueDate(i),
      daysOverdue: daysOverdue(i, today),
    })),
  };
}

const DateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .describe("YYYY-MM-DD. Defaults to today (UTC).");

// ──────── tool.impediments.list_state ────────
registry.register({
  id: "tool.impediments.list_state",
  toolId: "tool.impediments",
  name: "list_state",
  category: "read",
  description:
    "Summarise the team's impediments as the Impediments page does. Returns {today, total, open, escalated, resolved, overdue (unresolved past due), critical (unresolved), avgResolutionDays | null, oldestOpenDays | null, impediments: (Impediment & {status: open|escalated|resolved, ageDays, due: YYYY-MM-DD | null, daysOverdue})[]} with escalated first, then open (overdue, most severe, oldest first), then resolved (latest first).",
  paramsSchema: z.object({ today: DateParam }),
  handler: async ({ today }) => listState(ws().impediments ?? [], today ?? todayUTC()),
  mcpHandler: async ({ today }, ctx) =>
    listState(await serverListEntities<Impediment>(ctx.userId, KIND_IMP), today ?? todayUTC()),
});

// ──────── tool.impediments.set_status ────────
registry.register({
  id: "tool.impediments.set_status",
  toolId: "tool.impediments",
  name: "set_status",
  category: "write",
  requiresConfirmation: false,
  description:
    "Escalate, resolve or reopen an impediment: status open | escalated | resolved, on `date` (default today, UTC). Resolving keeps the escalation date; reopening clears both. Returns {updated: true, status} or {updated: false} for an unknown id.",
  paramsSchema: z.object({
    id: z.string().min(1),
    status: z.enum(["open", "escalated", "resolved"]),
    date: DateParam,
  }),
  handler: async ({ id, status, date }) => {
    const current = (ws().impediments ?? []).find((i) => i.id === id);
    if (!current) return { updated: false };
    const next = withImpedimentStatus(current, status, date ?? todayUTC());
    if (next !== current) ws().upsertImpediment(next);
    return { updated: true, status: impedimentStatus(next) };
  },
  mcpHandler: async ({ id, status, date }, ctx) => {
    const current = await serverGetEntity<Impediment>(ctx.userId, KIND_IMP, id);
    if (!current) return { updated: false };
    const next = withImpedimentStatus(current, status, date ?? todayUTC());
    if (next !== current) await serverUpsertEntity<Impediment>(ctx.userId, KIND_IMP, next);
    return { updated: true, status: impedimentStatus(next) };
  },
});
