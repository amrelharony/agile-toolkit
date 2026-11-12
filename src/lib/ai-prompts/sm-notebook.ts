import type { PromptDefinition } from "./types";
import { buildPreamble, sanitizePromptCell, truncateData, wrapUserContent } from "./prompt-utils";
import type { NotebookEntry } from "../stores/workspace-types";
import {
  eventLabel,
  filterNotes,
  isSummaryNote,
  notesOfWeek,
  shiftDay,
  weekLabel,
} from "../notebook/model";
import { themeCounts } from "../notebook/themes";

/** The notes the copyable prompts take, at most. A cut list says so. */
const MAX_WEEK_NOTES = 40;
const MAX_RECENT_NOTES = 60;
const MAX_THEMES = 20;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One note as a prompt line: day, event, tags, then its words (sanitised, cut). */
function noteLine(e: NotebookEntry, max: number): string {
  const meta = [
    e.date,
    eventLabel(e.event),
    e.tags.length > 0 ? `tags: ${e.tags.map((t) => sanitizePromptCell(t, 30)).join(", ")}` : "",
  ].filter(Boolean);
  const title = e.title?.trim() ? `${sanitizePromptCell(e.title, 80)}: ` : "";
  return `- ${meta.join(" · ")}: ${title}${sanitizePromptCell(e.body, max)}`;
}

function lines(notes: readonly NotebookEntry[], max: number, cap: number): string {
  const { data, truncated, totalCount } = truncateData([...notes], cap);
  if (data.length === 0) return "No notes.";
  const more = truncated ? `\n(Showing ${cap} of ${totalCount} notes)` : "";
  return `${data.map((e) => noteLine(e, max)).join("\n")}${more}`;
}

/**
 * Prompts to copy into the person's own AI chat: the week's notes read
 * together, and the themes across the last four weeks. The notes are the
 * coach's own words, so each is sanitised, cut and wrapped as untrusted
 * content; kept weekly summaries are left out, as on the page.
 */
export function generateSmNotebookPrompts(data: {
  entries: readonly NotebookEntry[];
  weekStart: string;
  today: string;
}): PromptDefinition[] {
  const notes = data.entries.filter((e) => !isSummaryNote(e));
  if (notes.length === 0) return [];
  const week = notesOfWeek(notes, data.weekStart).notes;
  const from = shiftDay(data.today, -27);
  const recent = filterNotes(notes, { from, to: data.today });
  const themes = themeCounts(recent).slice(0, MAX_THEMES);
  const themeLines =
    themes.length === 0
      ? "No theme yet."
      : themes
          .map((t) => `- ${sanitizePromptCell(t.tag, 40)}: ${plural(t.notes, "note")}`)
          .join("\n");
  const privacy =
    "These are a Scrum Master's private notes. Describe what was observed; don't judge or label anyone, and leave people's names out of your answer.";

  const out: PromptDefinition[] = [];
  if (week.length > 0) {
    out.push({
      id: "notebook-week",
      title: "Weekly reflection",
      description: "Read the week's notes together: what stands out and what to try next.",
      prompt:
        buildPreamble(
          "Scrum Master Notebook",
          `${weekLabel(data.weekStart)}: ${plural(week.length, "note")}. ${privacy}`
        ) +
        `${wrapUserContent(`## Notes\n\n${lines(week, 600, MAX_WEEK_NOTES)}`)}\n\n## Questions\n\n1. What 2-3 patterns stand out this week, and which notes show them?\n2. What would you ask the team about at the next retro?\n3. Which one small experiment would you try next week, and how would you know it worked?`,
    });
  }
  out.push({
    id: "notebook-patterns",
    title: "Coaching patterns",
    description: "Themes across the last four weeks and where to coach next.",
    prompt:
      buildPreamble(
        "Scrum Master Notebook",
        `${plural(recent.length, "note")} in the last four weeks. Themes are counted per note, from its tags and its words. ${privacy}`
      ) +
      `${wrapUserContent(`## Themes\n\n${themeLines}\n\n## Notes\n\n${lines(recent, 300, MAX_RECENT_NOTES)}`)}\n\n## Questions\n\n1. Which themes keep coming back, and which have faded?\n2. Where is the team growing, and where is it stuck?\n3. Suggest a coaching focus for the next sprint, with one question to open it.`,
  });
  return out;
}
