/**
 * The interrupt buffer as Markdown and CSV: the sprint's buffer and what it
 * used, its interrupts, and the history of earlier sprints.
 */

import type { InterruptItem, Sprint } from "@/lib/stores/workspace-types";
import {
  INTERRUPT_KIND_LABEL,
  bufferLabel,
  interruptSize,
  type BufferHistoryRow,
  type InterruptBufferStatus,
} from "@/lib/sprints/interrupts";

const cell = (v: unknown) =>
  String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();

const STATE_TEXT: Record<InterruptBufferStatus["state"], string> = {
  none: "no buffer to weigh against",
  ok: "within the buffer",
  watch: "nearly used up",
  over: "over the buffer",
};

export function toMarkdown({
  sprint,
  status,
  items,
  history,
}: {
  sprint: Sprint;
  status: InterruptBufferStatus;
  items: readonly InterruptItem[];
  history: readonly BufferHistoryRow[];
}): string {
  const lines = [`# ${cell(sprint.name)} — interrupt buffer`, ""];
  lines.push(`**Buffer:** ${bufferLabel(sprint)}  `);
  lines.push(`**Used:** ${status.summary} (${STATE_TEXT[status.state]})  `);
  lines.push(
    `**Interrupts:** ${status.total} (${status.open} open, ${status.emergencies} ${status.emergencies === 1 ? "emergency" : "emergencies"})`
  );
  lines.push("", "## Interrupts", "");
  if (items.length === 0) {
    lines.push("None logged.");
  } else {
    lines.push(
      "| Logged | Interrupt | Kind | Points | Emergency | Resolved |",
      "|---|---|---|---:|---|---|"
    );
    for (const i of items) {
      lines.push(
        `| ${i.loggedAt.slice(0, 10)} | ${cell(i.title)} | ${INTERRUPT_KIND_LABEL[i.kind] ?? cell(i.kind)} | ${
          interruptSize(i) > 0 || i.size === 0 ? interruptSize(i) : "—"
        } | ${i.emergency ? "Yes" : ""} | ${i.resolvedAt ? i.resolvedAt.slice(0, 10) : "Open"} |`
      );
    }
  }
  if (history.length > 0) {
    lines.push(
      "",
      "## Sprint history",
      "",
      "| Sprint | Buffer | Used | Interrupts |",
      "|---|---:|---:|---:|"
    );
    for (const r of history) {
      lines.push(
        `| ${cell(r.sprint.name)} | ${r.status.bufferPoints ?? "—"} | ${r.status.usedPoints} | ${r.status.total} |`
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Every interrupt of the sprint, one row each. */
export function interruptsCsv(items: readonly InterruptItem[]): {
  headers: string[];
  rows: (string | number)[][];
} {
  return {
    headers: ["Logged", "Interrupt", "Kind", "Points", "Emergency", "Resolved"],
    rows: items.map((i) => [
      i.loggedAt,
      i.title,
      INTERRUPT_KIND_LABEL[i.kind] ?? i.kind,
      typeof i.size === "number" ? i.size : "",
      i.emergency ? "yes" : "",
      i.resolvedAt ?? "",
    ]),
  };
}
