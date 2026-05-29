/**
 * Working Agreement Builder — tool-local actions.
 *
 * Category: Workshops & Facilitation (squad S11)
 * Tool:     Team charter of norms (communication, meetings, decisions, …)
 *           with adoption check-ins.
 *
 * Agent surface: tool.working_agreement.*
 * Backing CRUD : workspace.working_agreement.* (auto-generated). Singleton:
 *                one WorkingAgreement document (rules[] + meta) under a fixed id.
 *
 *   1. list_state — rules + byCategory + adoption (stillWorking) tallies + meta.
 *   2. add_rule   — add a charter rule.
 *
 * Entity kind "workspace:workingAgreement" + the fixed WA_ID match
 * working-agreement-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type {
  WorkingAgreement,
  CharterRule,
  CharterRuleCategory,
} from "@/lib/stores/workspace-types";

const KIND_WA = "workspace:workingAgreement";
// MUST match WA_ID in working-agreement-client.tsx.
const WA_ID = "workingAgreement:current";

const CATEGORIES = ["communication", "meetings", "decisions", "work", "conflict", "other"] as const;
const CategorySchema = z.enum(CATEGORIES);

const ws = () => useWorkspaceStore.getState();

function emptyDoc(): WorkingAgreement {
  return { id: WA_ID, rules: [], meta: { version: 1 } };
}

function browserDoc(): WorkingAgreement | null {
  return (ws().workingAgreements ?? []).find((d) => d.id === WA_ID) ?? null;
}

function summarize(doc: WorkingAgreement | null) {
  const rules = doc?.rules ?? [];
  const byCategory: Record<CharterRuleCategory, number> = {
    communication: 0,
    meetings: 0,
    decisions: 0,
    work: 0,
    conflict: 0,
    other: 0,
  };
  let stillWorkingCount = 0;
  let notWorkingCount = 0;
  for (const r of rules) {
    if (r.category in byCategory) byCategory[r.category] += 1;
    if (r.stillWorking === true) stillWorkingCount += 1;
    else if (r.stillWorking === false) notWorkingCount += 1;
  }
  return {
    exists: doc !== null,
    total: rules.length,
    byCategory,
    // Adoption check-in: how many rules have been confirmed working vs flagged.
    stillWorkingCount,
    notWorkingCount,
    meta: doc?.meta ?? emptyDoc().meta,
    rules,
  };
}

// ──────── tool.working_agreement.list_state ────────
registry.register({
  id: "tool.working_agreement.list_state",
  toolId: "tool.working_agreement",
  name: "list_state",
  category: "read",
  description:
    "Summarise the working agreement. Returns {exists, total, byCategory: {communication, meetings, decisions, work, conflict, other}, stillWorkingCount, notWorkingCount, meta, rules}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<WorkingAgreement>(ctx.userId, KIND_WA, WA_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.working_agreement.add_rule ────────
registry.register({
  id: "tool.working_agreement.add_rule",
  toolId: "tool.working_agreement",
  name: "add_rule",
  category: "write",
  requiresConfirmation: false,
  description:
    "Add a charter rule. category is communication | meetings | decisions | work | conflict | other. agreedBy lists who agreed. Creates the agreement if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    category: CategorySchema,
    text: z.string().min(1).max(1000),
    agreedBy: z.array(z.string()).optional(),
    description: z.string().max(2000).optional(),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const rule = newRule(params);
    ws().upsertWorkingAgreement({ ...base, id: WA_ID, rules: [...base.rules, rule] });
    return { added: true, id: rule.id };
  },
  mcpHandler: async (params, ctx) => {
    const base =
      (await serverGetEntity<WorkingAgreement>(ctx.userId, KIND_WA, WA_ID)) ?? emptyDoc();
    const rule = newRule(params);
    await serverUpsertEntity<WorkingAgreement>(ctx.userId, KIND_WA, {
      ...base,
      id: WA_ID,
      rules: [...base.rules, rule],
    });
    return { added: true, id: rule.id };
  },
});

function newRule(params: {
  category: CharterRuleCategory;
  text: string;
  agreedBy?: string[];
  description?: string;
}): CharterRule {
  return {
    id: crypto.randomUUID(),
    category: params.category,
    text: params.text,
    agreedBy: params.agreedBy ?? [],
    description: params.description,
  };
}
