import type { StandupEntry } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A list item's text: one line. */
function oneLine(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

/**
 * Today's standup (the entries dated `now`'s local day), blockers first so
 * they're the first thing read when pasted into a team channel.
 */
export function toMarkdown(entries: readonly StandupEntry[], now: Date = new Date()): string {
  const title = `# Standup — ${mdDate(now)}`;
  const day = todayLocalISO(now);
  const todays = entries.filter((e) => e.date === day).sort((a, b) => a.timestamp - b.timestamp);
  if (todays.length === 0) return `${title}\n\nNo standup updates for today yet.\n`;

  const withBlocker = todays.filter((e) => e.blockers.trim());
  const open = withBlocker.filter((e) => !e.blockerResolved);
  const resolved = withBlocker.filter((e) => e.blockerResolved);

  const lines = [
    title,
    "",
    `${todays.length} ${todays.length === 1 ? "update" : "updates"}, ${open.length} open ${
      open.length === 1 ? "blocker" : "blockers"
    }.`,
    "",
    "## Blockers",
    "",
  ];
  if (withBlocker.length === 0) lines.push("No blockers.");
  for (const e of open) lines.push(`- **${oneLine(e.member)}:** ${oneLine(e.blockers)}`);
  for (const e of resolved) {
    lines.push(`- **${oneLine(e.member)}:** ~~${oneLine(e.blockers)}~~ (resolved)`);
  }

  lines.push("", "## Updates");
  for (const e of todays) {
    lines.push(
      "",
      `### ${oneLine(e.member)}`,
      "",
      `- **Yesterday:** ${oneLine(e.yesterday) || "—"}`,
      `- **Today:** ${oneLine(e.today) || "—"}`
    );
  }

  return `${lines.join("\n")}\n`;
}
