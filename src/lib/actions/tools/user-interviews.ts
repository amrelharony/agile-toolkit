/**
 * User Interview Log — tool-local actions.
 *
 * Category: Product Discovery (squad S5)
 * Tool:     Research synthesis — interviews with tagged quotes + tag frequency.
 *
 * Agent surface: tool.user_interviews.*
 * Backing CRUD : workspace.user_interview_log.* (auto-generated). Singleton:
 *                one UserInterviewLog document (interviews[]) under a fixed id.
 *
 *   1. list_state     — interview/quote counts + top tags.
 *   2. add_interview  — log an interview (date → today).
 *   3. add_quote      — attach a tagged quote to an interview.
 *
 * Entity kind "workspace:userInterviewLog" + the fixed UI_ID match
 * user-interviews-client.tsx, so MCP writes round-trip into the UI.
 */

import { z } from "zod";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type { UserInterviewLog, Interview } from "@/lib/stores/workspace-types";

const KIND_UI = "workspace:userInterviewLog";
// MUST match UI_ID in user-interviews-client.tsx.
const UI_ID = "userInterviewLog:current";

const ws = () => useWorkspaceStore.getState();

const today = () => new Date().toISOString().slice(0, 10);

/** Normalise tags the way the client does — trimmed, lowercased, de-empty'd. */
function normTags(tags: string[]): string[] {
  return tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
}

function emptyDoc(): UserInterviewLog {
  return { id: UI_ID, interviews: [] };
}

function browserDoc(): UserInterviewLog | null {
  return (ws().userInterviewLogs ?? []).find((d) => d.id === UI_ID) ?? null;
}

function summarize(doc: UserInterviewLog | null) {
  const interviews = doc?.interviews ?? [];
  const tagFreq: Record<string, number> = {};
  let totalQuotes = 0;
  for (const iv of interviews) {
    for (const q of iv.quotes) {
      totalQuotes += 1;
      for (const t of q.tags) tagFreq[t] = (tagFreq[t] ?? 0) + 1;
    }
  }
  const topTags = Object.entries(tagFreq)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return {
    exists: doc !== null,
    totalInterviews: interviews.length,
    totalQuotes,
    topTags,
    interviews,
  };
}

// ──────── tool.user_interviews.list_state ────────
registry.register({
  id: "tool.user_interviews.list_state",
  toolId: "tool.user_interviews",
  name: "list_state",
  category: "read",
  description:
    "Summarise the interview log. Returns {exists, totalInterviews, totalQuotes, topTags: {tag, count}[] (top 5), interviews}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(browserDoc()),
  mcpHandler: async (_params, ctx) => {
    const doc = await serverGetEntity<UserInterviewLog>(ctx.userId, KIND_UI, UI_ID);
    return summarize(doc ?? null);
  },
});

// ──────── tool.user_interviews.add_interview ────────
registry.register({
  id: "tool.user_interviews.add_interview",
  toolId: "tool.user_interviews",
  name: "add_interview",
  category: "write",
  requiresConfirmation: false,
  description:
    "Log an interview (no quotes yet — add them with add_quote). date defaults to today. Creates the log if absent. Returns {added: true, id}.",
  paramsSchema: z.object({
    participant: z.string().min(1).max(200),
    date: z.string().optional().describe("YYYY-MM-DD; defaults to today."),
    context: z.string().max(2000).optional(),
  }),
  handler: async (params) => {
    const base = browserDoc() ?? emptyDoc();
    const iv = newInterview(params);
    ws().upsertUserInterviewLog({ ...base, id: UI_ID, interviews: [...base.interviews, iv] });
    return { added: true, id: iv.id };
  },
  mcpHandler: async (params, ctx) => {
    const base =
      (await serverGetEntity<UserInterviewLog>(ctx.userId, KIND_UI, UI_ID)) ?? emptyDoc();
    const iv = newInterview(params);
    await serverUpsertEntity<UserInterviewLog>(ctx.userId, KIND_UI, {
      ...base,
      id: UI_ID,
      interviews: [...base.interviews, iv],
    });
    return { added: true, id: iv.id };
  },
});

// ──────── tool.user_interviews.add_quote ────────
registry.register({
  id: "tool.user_interviews.add_quote",
  toolId: "tool.user_interviews",
  name: "add_quote",
  category: "write",
  requiresConfirmation: false,
  description:
    "Attach a quote (with optional tags) to an existing interview. tags are normalised (trim/lowercase). Returns {added: false} when the interview id is unknown, else {added: true, id} (the quote id).",
  paramsSchema: z.object({
    interviewId: z.string(),
    text: z.string().min(1).max(4000),
    tags: z.array(z.string()).optional(),
  }),
  handler: async (params) => {
    const r = addQuote(browserDoc(), params);
    if (!r) return { added: false };
    ws().upsertUserInterviewLog(r.next);
    return { added: true, id: r.id };
  },
  mcpHandler: async (params, ctx) => {
    const base = await serverGetEntity<UserInterviewLog>(ctx.userId, KIND_UI, UI_ID);
    const r = addQuote(base ?? null, params);
    if (!r) return { added: false };
    await serverUpsertEntity<UserInterviewLog>(ctx.userId, KIND_UI, r.next);
    return { added: true, id: r.id };
  },
});

function newInterview(params: { participant: string; date?: string; context?: string }): Interview {
  return {
    id: crypto.randomUUID(),
    participant: params.participant,
    date: params.date ?? today(),
    context: params.context,
    quotes: [],
  };
}

function addQuote(
  doc: UserInterviewLog | null,
  params: { interviewId: string; text: string; tags?: string[] }
): { next: UserInterviewLog; id: string } | null {
  if (!doc || !doc.interviews.some((iv) => iv.id === params.interviewId)) return null;
  const id = crypto.randomUUID();
  const next: UserInterviewLog = {
    ...doc,
    id: UI_ID,
    interviews: doc.interviews.map((iv) =>
      iv.id === params.interviewId
        ? {
            ...iv,
            quotes: [...iv.quotes, { id, text: params.text, tags: normTags(params.tags ?? []) }],
          }
        : iv
    ),
  };
  return { next, id };
}
