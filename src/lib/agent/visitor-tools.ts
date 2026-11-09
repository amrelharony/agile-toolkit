/**
 * Which tools a visitor's chat offers the model on one request (visitor AI).
 *
 * Never the whole registry, and never more than VISITOR_LIMITS.maxTools (the
 * visitor route refuses a longer list). In order:
 *
 *  1. The KB's best matches for the visitor's recent words (the first
 *     RANKED_FIRST of them), so "add a risk" finds the risk actions on any page.
 *     A weak match ("ok go") ranks nothing: it would only be noise.
 *  2. The open page's own actions (pageActionGroups, reads first), or the core
 *     workspace reads on a page with none, so "add a card" on /retro works even
 *     when the words rank something else higher.
 *  3. The rest of the ranked matches, while there is room.
 *  4. Every tool the history being sent already called: the request replays
 *     those calls, and an OpenAI-compatible endpoint rejects a tool_call whose
 *     function isn't in `tools`. Their slots are kept back first, so they are
 *     never cut. The history only ever holds calls that ran, each offered
 *     when it was made: the client takes a call it won't run out of the chat
 *     (runVisitorLoop), so naming an action is never a way to be offered it.
 *
 * A plain question ("what is WSJF?", "how do I run a retro?") gets no tools at
 * all (only the history's, when it has any), so Amr just answers.
 *
 * Actions marked `visitor: false` (the canvas ones, which broadcast to live
 * room peers) are never offered, not even from history.
 */

import { registry, claudeNameFromId, zodToJsonSchema } from "@/lib/actions/registry";
import type { AnyToolAction } from "@/lib/actions/types";
import { VISITOR_LIMITS, type VisitorWireTool } from "@/lib/visitor-ai/contract";
import { getRegistryKbIndex, matchKb } from "./mascot/kb";
import { CORE_WORKSPACE_GROUPS, pageActionGroups, toolNamesInHistory } from "./tool-selection";
import { resolvePageTool } from "./page-tool";
import type { ChatMessage } from "./types";

/** Ranked matches taken before the page's actions; the rest come after them. */
export const RANKED_FIRST = 12;

/** Whether an action may be offered to a visitor (anything not marked `visitor: false`). */
export function isVisitorAction(a: Pick<AnyToolAction, "visitor">): boolean {
  return a.visitor !== false;
}

/** Words that open a question about the method rather than a request to act. */
const QUESTION_LEAD =
  /^(how|what|what's|whats|why|when|where|who|which|is|are|does|do|should|could|would|can you explain|explain|tell me|describe|define|difference|meaning)\b/i;
/**
 * Words that point at the visitor's own data or ask for a change: any of these
 * and the question gets tools after all ("what's in my backlog?", "how do I add
 * a card here?").
 */
const ACTS_ON_DATA =
  /\b(my|mine|our|ours|us|here|this|these|current|add|create|make|rename|delete|remove|move|update|edit|change|set|mark|vote|list|show|log|record|save|fill|assign|archive|clear|start|plan|draft|generate|import|summari[sz]e)\b/i;

/**
 * True for a plain question about agile or the toolkit: it reads as a question
 * and names nothing of the visitor's to read or change. Such a message is
 * answered without tools.
 */
export function isPlainQuestion(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  const asks = QUESTION_LEAD.test(t) || t.endsWith("?");
  return asks && !ACTS_ON_DATA.test(t);
}

/** The text of the last user message, or "". */
function latestUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    return m.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join(" ")
      .trim();
  }
  return "";
}

/** An action's group: its `toolId`, or its id up to the last dot. */
function actionGroup(a: { id: string; toolId?: string }): string {
  return a.toolId ?? a.id.slice(0, Math.max(0, a.id.lastIndexOf(".")));
}

type SelectableAction = { id: string; category: string; toolId?: string; visitor?: boolean };

/**
 * The action ids to offer, in the order above (pure; the registry is passed
 * in). Ids the registry doesn't know, and actions not open to visitors, are
 * skipped everywhere.
 */
export function selectVisitorToolIds(opts: {
  /** The registry's actions, in registry order. */
  actions: ReadonlyArray<SelectableAction>;
  /** KB-ranked action ids, best first. */
  rankedIds?: readonly string[];
  /** The open page's tool id (e.g. "retro"), or null. */
  toolId?: string | null;
  /** Dotted ids of the actions the history being sent already called. */
  historyIds?: readonly string[];
  /** Offer nothing new (a plain question). */
  plainQuestion?: boolean;
  max?: number;
}): string[] {
  const max = Math.min(opts.max ?? VISITOR_LIMITS.maxTools, VISITOR_LIMITS.maxTools);
  const byId = new Map(opts.actions.map((a) => [a.id, a]));
  const offerable = (id: string) => {
    const a = byId.get(id);
    return a !== undefined && isVisitorAction(a);
  };

  // History first in priority (slots kept back), last in the list.
  const history = Array.from(new Set(opts.historyIds ?? []))
    .filter(offerable)
    .slice(0, max);
  if (opts.plainQuestion) return history;

  const room = max - history.length;
  const seen = new Set(history);
  const picked: string[] = [];
  const add = (id: string) => {
    if (picked.length >= room || seen.has(id) || !offerable(id)) return;
    seen.add(id);
    picked.push(id);
  };

  const ranked = opts.rankedIds ?? [];
  for (const id of ranked.slice(0, RANKED_FIRST)) add(id);

  if (opts.toolId) {
    const inGroups = (groups: readonly string[]) =>
      groups.flatMap((g) => opts.actions.filter((a) => actionGroup(a) === g));
    let own = inGroups(pageActionGroups(opts.toolId)).filter((a) => isVisitorAction(a));
    if (own.length === 0) {
      own = inGroups(CORE_WORKSPACE_GROUPS).filter((a) => a.category === "read");
    }
    for (const a of own) if (a.category === "read") add(a.id);
    for (const a of own) if (a.category !== "read") add(a.id);
  }

  for (const id of ranked.slice(RANKED_FIRST)) add(id);

  return [...picked, ...history];
}

/**
 * The KB's matches for the visitor's words, best first, or none when the best
 * of them is weak (a "low" or "none" confidence), so stray words never fill
 * the list with unrelated actions.
 */
function rankedActionIds(text: string): string[] {
  const res = matchKb(text, getRegistryKbIndex(), { limit: VISITOR_LIMITS.maxTools * 2 });
  if (res.confidence === "none" || res.confidence === "low") return [];
  return res.matches.map((m) => m.entry.id);
}

/** One action as an OpenAI function tool. */
function wireTool(a: AnyToolAction): VisitorWireTool {
  return {
    type: "function",
    function: {
      name: claudeNameFromId(a.id),
      description: a.description,
      parameters: zodToJsonSchema(a.paramsSchema),
    },
  };
}

/**
 * The tools for one visitor request (see the file header). `rankText` is the
 * recent user text (recentUserText); `messages` is the history being sent,
 * whose last user message decides whether this is a plain question; `toolId`
 * is the open page's tool (an id, a path or a slug). Only the chosen actions'
 * schemas are built.
 */
export function buildVisitorTurnTools(
  rankText: string,
  messages: ChatMessage[],
  toolId: string | null | undefined
): VisitorWireTool[] {
  const actions = registry.list();
  const plainQuestion = isPlainQuestion(latestUserText(messages));
  const historyIds = toolNamesInHistory(messages).map((name) => registry.resolve(name)?.id ?? name);
  const rankedIds = !plainQuestion && rankText ? rankedActionIds(rankText) : [];
  const ids = selectVisitorToolIds({
    actions,
    rankedIds,
    toolId: resolvePageTool(toolId)?.id ?? toolId ?? null,
    historyIds,
    plainQuestion,
  });
  return ids.flatMap((id) => {
    const a = registry.get(id);
    return a ? [wireTool(a)] : [];
  });
}
