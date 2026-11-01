/**
 * User Interview Log — tool-local actions.
 *
 * Category: Product Discovery (squad S5)
 * Tool:     Research synthesis — interviews with tagged quotes, and the
 *           themes they add up to, counted per participant.
 *
 * Agent surface: tool.user_interviews.*
 * Backing CRUD : workspace.user_interview_log.* (auto-generated). Singleton:
 *                one UserInterviewLog document (interviews[]) under a fixed id.
 *
 *   1. list_state                 — interview/quote/participant counts and
 *                                   the themes (participants, then quotes).
 *   2. add_interview              — log an interview (a day, backdated; first
 *                                   in the list, as on the page).
 *   3. add_quote                  — attach a tagged quote to an interview.
 *   4. send_quote_to_opportunity  — raise a quote as an opportunity on the
 *                                   Opportunity Tree (redacted, no name).
 *
 * Themes, tags and the quote's hand-off come from lib/interviews and
 * lib/opportunity-tree, which the pages use too. Entity kinds
 * "workspace:userInterviewLog" and "workspace:opportunityTree" (the fixed
 * UI_ID and OPPORTUNITY_TREE_ID) match the browser sync and the generic CRUD.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registry } from "../registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { serverGetEntity, serverUpsertEntity } from "../server-store";
import type {
  HandoffLink,
  Interview,
  OpportunityTree,
  UserInterviewLog,
} from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { todayLocalISO } from "@/lib/utils/formatters";
import { addDays } from "@/lib/impediments/model";
import { isDay } from "@/lib/hypotheses/model";
import {
  CONTEXT_MAX,
  PARTICIPANT_MAX,
  QUOTE_TEXT_MAX,
  UI_ID,
  normTags,
  participantCount,
  quoteOpportunitySource,
  sentOpportunity,
  themeCounts,
} from "@/lib/interviews/model";
import {
  OPPORTUNITY_TREE_ID,
  canParent,
  opportunityFromSource,
} from "@/lib/opportunity-tree/model";

/** MUST match registerCollection("userInterviewLog", …) in workspace-store.ts. */
const KIND_UI = "workspace:userInterviewLog";
/** MUST match registerCollection("opportunityTree", …) in workspace-store.ts. */
const KIND_OT = "workspace:opportunityTree";

const IsoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

const ws = () => useWorkspaceStore.getState();

/* ── The store adapter ───────────────────────────────────────────────── */

interface LogStore {
  log(): Promise<UserInterviewLog | null>;
  put(doc: UserInterviewLog): Promise<void>;
  tree(): Promise<OpportunityTree | null>;
  putTree(doc: OpportunityTree): Promise<void>;
  /** Over MCP the server's day may be behind the user's (see latestDay). */
  onServer: boolean;
}

const browserStore: LogStore = {
  log: async () => (ws().userInterviewLogs ?? []).find((d) => d.id === UI_ID) ?? null,
  put: async (doc) => ws().upsertUserInterviewLog(doc),
  tree: async () => (ws().opportunityTrees ?? []).find((d) => d.id === OPPORTUNITY_TREE_ID) ?? null,
  putTree: async (doc) => ws().upsertOpportunityTree(doc),
  onServer: false,
};

function serverStore(userId: string): LogStore {
  return {
    log: async () => (await serverGetEntity<UserInterviewLog>(userId, KIND_UI, UI_ID)) ?? null,
    put: async (doc) => {
      await serverUpsertEntity<UserInterviewLog>(userId, KIND_UI, doc);
    },
    tree: async () =>
      (await serverGetEntity<OpportunityTree>(userId, KIND_OT, OPPORTUNITY_TREE_ID)) ?? null,
    putTree: async (doc) => {
      await serverUpsertEntity<OpportunityTree>(userId, KIND_OT, doc);
    },
    onServer: true,
  };
}

/**
 * The latest day a verb takes: today in the browser; on the server, whose
 * day (UTC on a typical deploy) can be behind the user's, the day after,
 * as the Decision Log's verbs allow.
 */
const latestDay = (today: string, onServer: boolean) => (onServer ? addDays(today, 1) : today);

/* ── list_state ──────────────────────────────────────────────────────── */

function summarize(doc: UserInterviewLog | null) {
  const interviews = doc?.interviews ?? [];
  const themes = themeCounts(interviews);
  return {
    exists: doc !== null,
    totalInterviews: interviews.length,
    totalQuotes: interviews.reduce((n, i) => n + (i.quotes?.length ?? 0), 0),
    participants: participantCount(interviews),
    // `count` stays the quote count, as before themes were per participant.
    topTags: themes
      .slice(0, 5)
      .map((t) => ({ tag: t.tag, count: t.quotes, participants: t.participants })),
    themes,
    interviews,
  };
}

registry.register({
  id: "tool.user_interviews.list_state",
  toolId: "tool.user_interviews",
  name: "list_state",
  category: "read",
  description:
    "Summarise the interview log. Returns {exists, totalInterviews, totalQuotes, participants (distinct, matched by name ignoring case), themes: [{tag, participants, quotes}] (every tag, most participants first: one person tagging it on five quotes is one voice), topTags: [{tag, count (quotes), participants}] (the first 5 themes), interviews (as stored; a quote's sentTo names the opportunity it was raised as)}.",
  paramsSchema: z.object({}),
  handler: async () => summarize(await browserStore.log()),
  mcpHandler: async (_params, ctx) => summarize(await serverStore(ctx.userId).log()),
});

/* ── add_interview ───────────────────────────────────────────────────── */

const AddInterviewSchema = z.object({
  participant: z.string().min(1).max(PARTICIPANT_MAX),
  date: IsoDay.optional().describe(
    "YYYY-MM-DD, the user's local day of the interview (backdated; default today; not in the future)."
  ),
  context: z.string().max(CONTEXT_MAX).optional(),
});

async function addInterview(store: LogStore, p: z.infer<typeof AddInterviewSchema>) {
  const today = todayLocalISO();
  const date = p.date ?? today;
  if (!isDay(date)) return { added: false, reason: "not_a_day" };
  if (date > latestDay(today, store.onServer)) return { added: false, reason: "future_day" };
  const base = (await store.log()) ?? { id: UI_ID, interviews: [] };
  const iv: Interview = {
    id: crypto.randomUUID(),
    participant: p.participant.trim(),
    date,
    ...(p.context ? { context: p.context } : {}),
    quotes: [],
  };
  // First in the list, as the page adds them.
  await store.put({ ...base, id: UI_ID, interviews: [iv, ...base.interviews] });
  return { added: true, id: iv.id };
}

registry.register({
  id: "tool.user_interviews.add_interview",
  toolId: "tool.user_interviews",
  name: "add_interview",
  category: "write",
  requiresConfirmation: false,
  description:
    "Log an interview (no quotes yet — add them with add_quote), first in the list as on the page. date is YYYY-MM-DD, the user's local day (default today; backdating is fine, the future isn't: over MCP the day after the server's is taken, as the server's day may be behind the user's). Creates the log if absent. Returns {added: true, id} or {added: false, reason: 'not_a_day' | 'future_day'}.",
  paramsSchema: AddInterviewSchema,
  handler: async (params) => addInterview(browserStore, params),
  mcpHandler: async (params, ctx) => addInterview(serverStore(ctx.userId), params),
});

/* ── add_quote ───────────────────────────────────────────────────────── */

const AddQuoteSchema = z.object({
  interviewId: z.string(),
  text: z.string().min(1).max(QUOTE_TEXT_MAX),
  tags: z.array(z.string()).optional(),
});

async function addQuote(store: LogStore, p: z.infer<typeof AddQuoteSchema>) {
  const doc = await store.log();
  if (!doc || !doc.interviews.some((iv) => iv.id === p.interviewId)) return { added: false };
  // The page's "Clear example" removes an example interview whole, with
  // any quote added to it: the page offers no Add quote there either.
  if (isExampleId(p.interviewId)) return { added: false, reason: "example" };
  const id = crypto.randomUUID();
  await store.put({
    ...doc,
    id: UI_ID,
    interviews: doc.interviews.map((iv) =>
      iv.id === p.interviewId
        ? { ...iv, quotes: [...iv.quotes, { id, text: p.text, tags: normTags(p.tags ?? []) }] }
        : iv
    ),
  });
  return { added: true, id };
}

registry.register({
  id: "tool.user_interviews.add_quote",
  toolId: "tool.user_interviews",
  name: "add_quote",
  category: "write",
  requiresConfirmation: false,
  description:
    "Attach a quote (with optional tags) to an existing interview. tags are normalised (trimmed, lower-case, each once). Returns {added: false} when the interview id is unknown, {added: false, reason: 'example'} for an example interview (id starting 'example-': the page's 'Clear example' would take the quote with it), else {added: true, id} (the quote id).",
  paramsSchema: AddQuoteSchema,
  handler: async (params) => addQuote(browserStore, params),
  mcpHandler: async (params, ctx) => addQuote(serverStore(ctx.userId), params),
});

/* ── send_quote_to_opportunity ───────────────────────────────────────── */

const SendSchema = z.object({
  interviewId: z.string(),
  quoteId: z.string(),
  parentId: z
    .string()
    .optional()
    .describe(
      "The outcome or opportunity it goes under (tool.opportunity_tree.list_state); omit for the root."
    ),
});

async function sendQuote(store: LogStore, p: z.infer<typeof SendSchema>) {
  const [doc, tree] = await Promise.all([store.log(), store.tree()]);
  const interview = doc?.interviews.find((i) => i.id === p.interviewId);
  const quote = interview?.quotes.find((q) => q.id === p.quoteId);
  if (!doc || !interview || !quote) return { sent: false, reason: "not_found" };
  if (isExampleId(quote.id) || isExampleId(interview.id)) return { sent: false, reason: "example" };
  const nodes = tree?.nodes ?? [];
  const live = sentOpportunity(quote, nodes);
  if (live) return { sent: false, reason: "already_sent", nodeId: live.id };
  if (p.parentId !== undefined) {
    const parent = nodes.find((n) => n.id === p.parentId);
    if (!parent) return { sent: false, reason: "parent_not_found" };
    // As the page's picker: "Clear example" would leave it without its parent.
    if (isExampleId(parent.id)) return { sent: false, reason: "example" };
    if (!canParent(parent, "opportunity")) return { sent: false, reason: "kind" };
  }
  const src = quoteOpportunitySource(quote, interview, p.parentId);
  if (!src.title) return { sent: false, reason: "blank" };
  const node = opportunityFromSource(src, nodes, nanoid(8));
  // Appended, as the tree adds its own nodes.
  await store.putTree({ ...(tree ?? {}), id: OPPORTUNITY_TREE_ID, nodes: [...nodes, node] });
  const link: HandoffLink = {
    route: "opportunity",
    targetId: node.id,
    at: new Date().toISOString(),
  };
  await store.put({
    ...doc,
    id: UI_ID,
    interviews: doc.interviews.map((i) =>
      i.id !== interview.id
        ? i
        : {
            ...i,
            quotes: i.quotes.map((q) =>
              q.id === quote.id
                ? {
                    ...q,
                    sentTo: [...(q.sentTo ?? []).filter((l) => l.route !== "opportunity"), link],
                  }
                : q
            ),
          }
    ),
  });
  return { sent: true, nodeId: node.id, parentId: node.parentId, text: node.text };
}

registry.register({
  id: "tool.user_interviews.send_quote_to_opportunity",
  toolId: "tool.user_interviews",
  name: "send_quote_to_opportunity",
  category: "write",
  requiresConfirmation: false,
  description:
    "Raise an interview quote as an opportunity on the Opportunity Tree, as the page does: the quote's text with emails, phone numbers and keys redacted, and the participant's own name in it read as 'the participant' (their name is never sent), as the opportunity, 'From an interview on <day>' as its evidence, linked both ways. It goes under parentId (an outcome or an opportunity) or at the root. Once per quote while that opportunity exists. Params: interviewId, quoteId, parentId?. Returns {sent: true, nodeId, parentId, text} or {sent: false, reason: 'not_found' | 'example' (an example quote, interview or parent node) | 'already_sent' (with nodeId) | 'parent_not_found' | 'kind' (the parent can't hold an opportunity) | 'blank'}.",
  paramsSchema: SendSchema,
  handler: async (params) => sendQuote(browserStore, params),
  mcpHandler: async (params, ctx) => sendQuote(serverStore(ctx.userId), params),
});
