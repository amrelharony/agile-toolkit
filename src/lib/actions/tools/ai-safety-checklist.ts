/**
 * AI Safety Review Checklist — tool-local actions.
 *
 * Category: AI / LLM Product Management (squad S12b)
 * Tool:     Pre-launch checklist across data privacy, security, content,
 *           operations, and NIST RMF alignment.
 *
 * Agent surface: tool.ai_safety_checklist.*
 * Backing CRUD : workspace.ai_safety_checklist.* (auto-generated). Singleton:
 *                one checklist document (a checks map) under a fixed id.
 *
 *   1. list_state — the fixed item catalog overlaid with checked state +
 *                   completeness.
 *   2. set_item   — toggle one item by id (validated against the catalog).
 *
 * The item CATALOG below MIRRORS the SECTIONS constant in
 * ai-safety-checklist-client.tsx — only the checked state is persisted, so
 * both sides must agree on the item ids. Entity kind
 * "workspace:aiSafetyChecklist" + the fixed CHECKLIST_ID match the client.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { AiSafetyChecklist } from "@/lib/stores/workspace-types";

const KIND_CHECKLIST = "workspace:aiSafetyChecklist";
// MUST match CHECKLIST_ID in ai-safety-checklist-client.tsx.
const CHECKLIST_ID = "aiSafetyChecklist:current";

/** Fixed item catalog — MIRRORS SECTIONS in the client. If an item is
 *  added/renamed there, update it here too (the ids are the contract). */
const CATALOG: { title: string; items: { id: string; text: string }[] }[] = [
  {
    title: "Data Privacy",
    items: [
      { id: "pii-scrub", text: "PII is scrubbed or never sent to the model" },
      { id: "data-retention", text: "Data-retention policy reviewed with the vendor" },
      {
        id: "logging-policy",
        text: "Logging excludes raw user input by default; opt-in for debugging",
      },
      { id: "consent", text: "User consent collected where required (GDPR/CCPA)" },
    ],
  },
  {
    title: "Security",
    items: [
      { id: "prompt-injection", text: "Prompt-injection tests passed (system prompt is robust)" },
      { id: "jailbreak", text: "Jailbreak attempts produce safe refusals" },
      { id: "rate-limit", text: "Rate limiting and abuse protection in place" },
      { id: "secrets", text: "No secrets, API keys, or tokens leak to the model" },
    ],
  },
  {
    title: "Content & Safety",
    items: [
      { id: "content-policy", text: "Content policy mapped to vendor's policy" },
      {
        id: "harmful-content",
        text: "Harmful-content categories filtered (CSAM, self-harm, etc.)",
      },
      { id: "bias-tested", text: "Bias-evaluation set run; results documented" },
      { id: "kid-safety", text: "If under-18 access possible, age-appropriate handling reviewed" },
    ],
  },
  {
    title: "Operational",
    items: [
      { id: "fallback", text: "Fallback path defined for model outage / refusal" },
      { id: "monitor", text: "Quality + cost monitoring dashboards live" },
      { id: "incident-runbook", text: "Incident-response runbook for AI-specific failures" },
      { id: "rollback", text: "Feature-flag rollback tested and documented" },
    ],
  },
  {
    title: "Governance / NIST RMF Alignment",
    items: [
      { id: "nist-govern", text: "GOVERN function mapped (responsible owner, policies)" },
      { id: "nist-map", text: "MAP function mapped (context, risks identified)" },
      { id: "nist-measure", text: "MEASURE function mapped (eval set, monitoring)" },
      { id: "nist-manage", text: "MANAGE function mapped (mitigation plan, comms)" },
    ],
  },
];

const VALID_IDS = new Set(CATALOG.flatMap((s) => s.items.map((i) => i.id)));
const TOTAL_ITEMS = VALID_IDS.size;

const ws = () => useWorkspaceStore.getState();

function browserChecklist(): AiSafetyChecklist | null {
  return (ws().aiSafetyChecklists ?? []).find((c) => c.id === CHECKLIST_ID) ?? null;
}

function summarize(checklist: AiSafetyChecklist | null) {
  const checks = checklist?.checks ?? {};
  // Count only checked items whose id is still in the catalog — a renamed/
  // removed item left in a hand-edited checks map must not inflate the count.
  let checkedCount = 0;
  const sections = CATALOG.map((sec) => ({
    title: sec.title,
    items: sec.items.map((it) => {
      const checked = checks[it.id] === true;
      if (checked) checkedCount += 1;
      return { id: it.id, text: it.text, checked };
    }),
  }));
  return {
    checkedCount,
    totalItems: TOTAL_ITEMS,
    completeness: TOTAL_ITEMS ? Math.round((checkedCount / TOTAL_ITEMS) * 100) / 100 : 0,
    sections,
  };
}

// ──────── tool.ai_safety_checklist.list_state ────────
registry.register({
  id: "tool.ai_safety_checklist.list_state",
  toolId: "tool.ai_safety_checklist",
  name: "list_state",
  category: "read",
  description:
    "Read the AI safety checklist. Returns {checkedCount, totalItems, completeness (0..1), sections: {title, items: {id, text, checked}[]}[]}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserChecklist()),
  mcpHandler: async (_params, ctx) => {
    const checklist = await serverGetEntity<AiSafetyChecklist>(
      ctx.userId,
      KIND_CHECKLIST,
      CHECKLIST_ID
    );
    return summarize(checklist ?? null);
  },
});

// ──────── tool.ai_safety_checklist.set_item ────────
registry.register({
  id: "tool.ai_safety_checklist.set_item",
  toolId: "tool.ai_safety_checklist",
  name: "set_item",
  category: "write",
  requiresConfirmation: false,
  description:
    "Check or uncheck one checklist item by id (see list_state for valid ids). Creates the checklist if absent. Returns {updated: false} when the itemId isn't in the catalog.",
  paramsSchema: z.object({
    itemId: z.string(),
    checked: z.boolean(),
  }),
  handler: async (params) => {
    if (!VALID_IDS.has(params.itemId)) return { updated: false };
    const base = browserChecklist() ?? { id: CHECKLIST_ID, checks: {} };
    ws().upsertAiSafetyChecklist({
      ...base,
      id: CHECKLIST_ID,
      checks: { ...base.checks, [params.itemId]: params.checked },
    });
    return { updated: true };
  },
  mcpHandler: async (params, ctx) => {
    if (!VALID_IDS.has(params.itemId)) return { updated: false };
    const base = (await serverGetEntity<AiSafetyChecklist>(
      ctx.userId,
      KIND_CHECKLIST,
      CHECKLIST_ID
    )) ?? {
      id: CHECKLIST_ID,
      checks: {},
    };
    await serverUpsertEntity<AiSafetyChecklist>(ctx.userId, KIND_CHECKLIST, {
      ...base,
      id: CHECKLIST_ID,
      checks: { ...base.checks, [params.itemId]: params.checked },
    });
    return { updated: true };
  },
});
