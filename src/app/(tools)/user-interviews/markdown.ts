import type { Interview } from "@/lib/stores/workspace-types";
import { normTags, participantCount, themeCounts } from "@/lib/interviews/model";
import { forExport, interviewsVerdict } from "./view";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
/** A table cell: one line, with pipes escaped so they don't split the cell. */
const cell = (v: string | number) => oneLine(String(v)).replace(/\|/g, "\\|");

/**
 * The interview log as Markdown: the verdict, the themes with how many
 * participants raised each, then every interview (day, who, context) with
 * its quotes and tags. Anonymised (participants as "Participant N",
 * context and quotes redacted) while the page's toggle is on, as the CSV
 * and JSON exports are.
 */
export function interviewsToMarkdown(
  interviews: readonly Interview[],
  { anonymise }: { anonymise: boolean }
): string {
  const lines = ["# User interviews", ""];
  if (interviews.length === 0) {
    lines.push("No interviews yet.");
    return `${lines.join("\n")}\n`;
  }
  const rows = forExport(interviews, anonymise);
  lines.push(`> ${interviewsVerdict(interviews)}`, "");
  if (anonymise)
    lines.push(
      "_Anonymised: participants are numbered; emails, phone numbers and their names are removed._",
      ""
    );
  const themes = themeCounts(interviews);
  if (themes.length > 0) {
    const people = participantCount(interviews);
    lines.push(
      "## Themes",
      "",
      "| Theme | Participants | Quotes |",
      "| --- | --- | --- |",
      ...themes.map((t) => `| ${cell(t.tag)} | ${t.participants} of ${people} | ${t.quotes} |`),
      ""
    );
  }
  lines.push("## Interviews", "");
  for (const i of rows) {
    const day = (i.date ?? "").slice(0, 10) || "undated";
    lines.push(`### ${day} · ${oneLine(i.participant || "Unnamed")}`, "");
    if (i.context?.trim()) lines.push(oneLine(i.context), "");
    const quotes = (i.quotes ?? []).filter((q) => q.text?.trim());
    if (quotes.length === 0) lines.push("No quotes.", "");
    else {
      for (const q of quotes) {
        const list = normTags(q.tags ?? []);
        const tags = list.length > 0 ? ` _(${list.join(", ")})_` : "";
        lines.push(`- “${oneLine(q.text)}”${tags}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
