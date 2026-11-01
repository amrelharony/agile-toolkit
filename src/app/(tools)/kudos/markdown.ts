import type { Kudos } from "@/lib/stores/workspace-types";
import type { RecognitionSummary } from "@/lib/kudos/recognition";
import { isExampleId } from "@/lib/utils/example-id";
import { localDay } from "@/lib/sprints/series";
import { getKudosTheme } from "./types";
import { recognitionChartText, recognitionVerdict } from "./verdict";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
/** A table cell: one line, with pipes escaped so they don't split the cell. */
const cell = (v: string | number) => oneLine(String(v)).replace(/\|/g, "\\|");

const byTime = (a: Kudos, b: Kudos) => Date.parse(a.sentAt) - Date.parse(b.sentAt);

function line(k: Kudos, reply: boolean): string {
  const day = localDay(k.sentAt) ?? "";
  const team = k.teamName ? ` (${oneLine(k.teamName)})` : "";
  if (reply) return `  - Reply from ${oneLine(k.fromName)} · ${day} — ${oneLine(k.message)}`;
  const theme = getKudosTheme(k.theme).title;
  return `- **${theme}** to ${oneLine(k.toName)}${team} from ${oneLine(k.fromName)} · ${day} — ${oneLine(k.message)}`;
}

export interface KudosMarkdownOptions {
  /** "in Sprint 12", "in the last 30 days", "so far": the Recognition window. */
  windowLabel: string;
  rosterSize: number;
}

/**
 * The wall as Markdown: the recognition verdict and table for the window,
 * then every kudos newest first with its replies under it. Example kudos
 * are left out: the export is the team's own wall.
 */
export function kudosToMarkdown(
  kudos: readonly Kudos[],
  summary: RecognitionSummary,
  { windowLabel, rosterSize }: KudosMarkdownOptions
): string {
  const own = kudos.filter((k) => !isExampleId(k.id));
  const lines = ["# Kudos wall", ""];
  const { table } = recognitionChartText(summary, rosterSize, windowLabel);
  lines.push(`> ${oneLine(recognitionVerdict(summary, rosterSize, windowLabel))}`, "");
  if (table.rows.length > 0) {
    lines.push(
      `## Recognition received ${windowLabel}`,
      "",
      `| ${table.columns.join(" | ")} |`,
      `| ${table.columns.map(() => "---").join(" | ")} |`,
      ...table.rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
      ""
    );
  }
  lines.push("## Wall", "");
  if (own.length === 0) {
    lines.push("No kudos yet.");
    return `${lines.join("\n")}\n`;
  }
  const ids = new Set(own.map((k) => k.id));
  const replies = new Map<string, Kudos[]>();
  const tops: Kudos[] = [];
  for (const k of own) {
    // A reply whose kudos is gone stands on its own, as on the wall.
    if (k.replyTo && ids.has(k.replyTo)) {
      replies.set(k.replyTo, [...(replies.get(k.replyTo) ?? []), k]);
    } else {
      tops.push(k);
    }
  }
  for (const k of [...tops].sort(byTime).reverse()) {
    lines.push(line(k, false));
    for (const r of (replies.get(k.id) ?? []).sort(byTime)) lines.push(line(r, true));
  }
  return `${lines.join("\n")}\n`;
}

/** The wall as CSV rows, oldest first, examples left out. */
export function kudosCsv(kudos: readonly Kudos[]): {
  headers: string[];
  rows: (string | number)[][];
} {
  return {
    headers: ["Sent at", "To", "From", "Theme", "Team", "Message", "Reply to"],
    rows: kudos
      .filter((k) => !isExampleId(k.id))
      .slice()
      .sort(byTime)
      .map((k) => [
        k.sentAt,
        k.toName,
        k.fromName,
        getKudosTheme(k.theme).title,
        k.teamName ?? "",
        k.message,
        k.replyTo ?? "",
      ]),
  };
}
