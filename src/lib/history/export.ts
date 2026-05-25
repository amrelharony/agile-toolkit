import { saveAs } from "file-saver";
import { exportToCSV, exportToJSON } from "@/lib/utils/export";
import { formatActionLabel } from "./event-actions";
import type { HistoryEvent } from "./types";

export function exportEventsAsJSON(events: HistoryEvent[], filename = "agile-history") {
  // Strip identity fields before serialising — `userId` is the owner's
  // auth.uid() repeated on every row, and `squadProfileId` is the raw
  // guest UUID. The CSV/Markdown exporters omit these (they only emit
  // occurredAt/toolId/action/milestone/payload); JSON used to leak them
  // by default-stringifying the whole HistoryEvent.
  const redacted = events.map((e) => {
    const clone = { ...e } as Partial<HistoryEvent>;
    delete clone.userId;
    delete clone.squadProfileId;
    delete clone.clientId;
    delete clone.toolRunId;
    return clone;
  });
  exportToJSON(redacted, filename);
}

export function exportEventsAsCSV(events: HistoryEvent[], filename = "agile-history") {
  exportToCSV(
    ["Occurred at", "Tool", "Action", "Milestone", "Payload"],
    events.map((e) => [
      e.occurredAt,
      e.toolId,
      e.action,
      e.isMilestone ? "yes" : "no",
      JSON.stringify(e.payload),
    ]),
    filename
  );
}

export function exportEventsAsMarkdown(events: HistoryEvent[], filename = "agile-history") {
  const grouped = new Map<string, HistoryEvent[]>();
  for (const e of events) {
    const day = e.occurredAt.slice(0, 10);
    const list = grouped.get(day) ?? [];
    list.push(e);
    grouped.set(day, list);
  }

  const lines: string[] = [
    `# Agile Toolkit — history digest`,
    "",
    `Exported ${new Date().toISOString()}`,
    "",
    `**Total events:** ${events.length}`,
    "",
  ];

  const toolCounts = new Map<string, number>();
  for (const e of events) toolCounts.set(e.toolId, (toolCounts.get(e.toolId) ?? 0) + 1);
  lines.push("## Activity by tool", "");
  for (const [tool, count] of Array.from(toolCounts.entries()).sort((a, b) => b[1] - a[1])) {
    lines.push(`- **${tool}** — ${count}`);
  }
  lines.push("");

  lines.push("## Timeline", "");
  for (const [day, dayEvents] of Array.from(grouped.entries()).sort((a, b) =>
    b[0].localeCompare(a[0])
  )) {
    lines.push(`### ${day}`, "");
    for (const e of dayEvents) {
      const time = e.occurredAt.slice(11, 16);
      const milestone = e.isMilestone ? " ⭐" : "";
      const summary = summarisePayload(e.payload);
      lines.push(
        `- \`${time}\` **${e.toolId}** · ${formatActionLabel(e.action)}${milestone}${
          summary ? ` — ${summary}` : ""
        }`
      );
    }
    lines.push("");
  }

  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  saveAs(blob, `${filename}.md`);
}

function summarisePayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  return Object.entries(payload as Record<string, unknown>)
    .slice(0, 3)
    .map(([k, v]) => {
      const s =
        typeof v === "string"
          ? v
          : typeof v === "number" || typeof v === "boolean"
            ? String(v)
            : JSON.stringify(v);
      return `${k}: ${s.length > 40 ? `${s.slice(0, 40)}…` : s}`;
    })
    .join(" · ");
}
