import type { NotebookEntry } from "@/lib/stores/workspace-types";
import {
  eventLabel,
  formatShortDay,
  groupByWeek,
  noteName,
  oneLine,
  tagCounts,
  weekLabel,
} from "@/lib/notebook/model";
import { linkedToolOf } from "@/lib/notebook/tools";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A heading's text: one line, with Markdown's heading and emphasis marks escaped. */
const inline = (s: string) => oneLine(s).replace(/([\\`*_[\]#<>|])/g, "\\$1");

/**
 * The notebook as Markdown: how many notes and the tags used most, then each
 * week (newest first) with its notes: day, title, event, tags, the tool it
 * is about, and the text as written. Private notes: this is what the person
 * chose to export or share.
 */
export function notebookToMarkdown(entries: readonly NotebookEntry[]): string {
  const lines = ["# Scrum Master Notebook", ""];
  if (entries.length === 0) {
    lines.push("No notes yet.");
    return `${lines.join("\n")}\n`;
  }
  lines.push(`${plural(entries.length, "note")}.`, "");
  const tags = tagCounts(entries).slice(0, 10);
  if (tags.length > 0) {
    lines.push(
      `Tags used most: ${tags.map((t) => `${inline(t.tag)} (${t.count})`).join(", ")}.`,
      ""
    );
  }
  for (const week of groupByWeek(entries)) {
    lines.push(`## ${weekLabel(week.weekStart)}`, "");
    for (const e of week.notes) {
      const title = e.title?.trim() ? ` · ${inline(noteName(e, 200))}` : "";
      lines.push(`### ${formatShortDay(e.date)}${title}`, "");
      const tool = linkedToolOf(e);
      const meta = [
        eventLabel(e.event) ? inline(eventLabel(e.event)) : "",
        e.tags.length > 0 ? `tags: ${e.tags.map(inline).join(", ")}` : "",
        tool ? `about: ${inline(tool.name)}` : "",
      ].filter(Boolean);
      if (meta.length > 0) lines.push(`_${meta.join(" · ")}_`, "");
      lines.push(e.body.trim(), "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
