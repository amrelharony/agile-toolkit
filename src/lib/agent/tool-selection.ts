/**
 * Pure helpers for choosing which tools to offer the model on a given turn.
 *
 * Tool trimming (see client.ts buildTurnTools) ranks the user's request against
 * the KB and ships only the top matches. Two correctness constraints the naive
 * "rank the latest message" approach got wrong:
 *
 *  1. Stateless follow-ups ("rename it", "add 3 more") carry almost no KB signal
 *     on their own, so ranking must consider the recent user context, not just
 *     the last line. → recentUserText.
 *  2. The request body replays the whole transcript, including prior assistant
 *     tool_calls. An OpenAI-compatible endpoint rejects a tool_call whose
 *     function name is absent from `tools`, so the offered set MUST stay a
 *     superset of everything the history already references. → toolNamesInHistory.
 */

import type { ChatMessage } from "./types";

/**
 * Concatenate the text of the last `n` user messages (most recent last). Used to
 * rank tools with enough context that a pronoun-y follow-up inherits the nouns
 * from the turn before it. Returns "" when there are no user-text messages.
 */
export function recentUserText(messages: ChatMessage[], n = 2): string {
  const texts: string[] = [];
  for (let i = messages.length - 1; i >= 0 && texts.length < n; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const t = m.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (t) texts.push(t);
  }
  return texts.reverse().join(" ").trim();
}

/**
 * The tool names referenced by every assistant `tool_use` block in the history.
 * These must remain available in the trimmed tool list or the wire is invalid.
 * Names are returned verbatim (as the model emitted them — typically the
 * underscore "claude" form); the caller normalises via the registry.
 */
export function toolNamesInHistory(messages: ChatMessage[]): string[] {
  const names = new Set<string>();
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const c of m.content) {
      if (c.type === "tool_use") names.add(c.name);
    }
  }
  return Array.from(names);
}
