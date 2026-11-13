/**
 * The Scrum Master Notebook's prompts (server half of ./sm-notebook.ts). The
 * runner adds the scope rule, the guardrail and the answer's shape, and wraps
 * `user()` in `<user_content>`, so the notes are read as data only.
 *
 * The weekly summary may only pick tools from the list below, taken from the
 * tool registry; the page still drops any id the registry doesn't know.
 */

import "server-only";
import { tools } from "@/lib/constants/tools";
import { isShelved, isVipOnly } from "@/lib/tools/catalog";
import { NOTEBOOK_TOOL_ID, eventLabel, oneLine } from "@/lib/notebook/model";
import { WEEKLY_PATTERNS_MAX, WEEKLY_TOOLS_MAX } from "@/lib/notebook/summary";
import { defineAiPrompt } from "../define-task";
import { TAG_SUGGEST_MAX, notebookTagTask, notebookWeeklySummaryTask } from "./sm-notebook";

/** "impediments (Impediment Tracker), kanban (Kanban Board), …": the tools a week may point to. */
export const NOTEBOOK_TOOL_CATALOG = tools
  .filter(
    (t) =>
      t.id !== NOTEBOOK_TOOL_ID &&
      !isShelved(t) &&
      !isVipOnly(t) &&
      !t.pendingApproval &&
      t.kind !== "reading"
  )
  .map((t) => `${t.id} (${t.name})`)
  .join(", ");

/**
 * A note started from a template holds its questions ("What I'll follow
 * up:"), answered or not: only the answers are the note.
 */
const TEMPLATE_PROMPT_RULE =
  "A note may hold a template's questions ending in a colon, such as \"What I'll follow up:\": they are headings, not what happened, so use only what was written after them.";

export const notebookWeeklySummaryPrompt = defineAiPrompt(notebookWeeklySummaryTask, {
  system: [
    "You help a Scrum Master read their own coaching notes from one week, all together.",
    "Write a summary of the week in two to four plain sentences: what happened and what stands out.",
    `Then up to ${WEEKLY_PATTERNS_MAX} patterns, each one sentence naming something that came up more than once or changed during the week, with its evidence (how many notes, which events).`,
    "Give fewer patterns, or none, when the notes don't show any.",
    `Then up to ${WEEKLY_TOOLS_MAX} toolkit tools that could help with those patterns, each with one sentence on why.`,
    `Use only these tool ids, exactly as written: ${NOTEBOOK_TOOL_CATALOG}.`,
    "Describe what was observed, never judge or label anyone, and leave people's names out.",
    "Use only what the notes say: don't invent events, numbers or people.",
    TEMPLATE_PROMPT_RULE,
  ].join(" "),
  user: ({ weekStart, notes }) =>
    [
      `Week starting (Monday): ${weekStart}`,
      `Notes: ${notes.length}`,
      "",
      ...notes.map((n) => {
        const meta = [
          n.date,
          n.event ? `event: ${eventLabel(n.event)}` : "",
          n.tags.length > 0 ? `tags: ${n.tags.join(", ")}` : "",
          n.linkedTool ? `about tool: ${n.linkedTool}` : "",
        ].filter(Boolean);
        const title = n.title ? `${oneLine(n.title)}: ` : "";
        return `- ${meta.join(" · ")}\n  ${title}${oneLine(n.body)}`;
      }),
    ].join("\n"),
});

export const notebookTagPrompt = defineAiPrompt(notebookTagTask, {
  system: [
    "You suggest tags for one note in a Scrum Master's own notebook.",
    `Suggest up to ${TAG_SUGGEST_MAX} short tags, one to three words each, in lower case, that name what the note is about, such as blockers, participation or estimation.`,
    "Reuse the notebook's existing tags when one fits, spelled the same way.",
    "Never repeat a tag the note already has, and never use a person's name as a tag.",
    TEMPLATE_PROMPT_RULE,
  ].join(" "),
  user: ({ title, body, known, current }) =>
    [
      title ? `Note title: ${title}` : "",
      `Note: ${body}`,
      `Tags the note has: ${current.length > 0 ? current.join(", ") : "none"}`,
      `Tags used in the notebook: ${known.length > 0 ? known.join(", ") : "none yet"}`,
    ]
      .filter(Boolean)
      .join("\n"),
});
