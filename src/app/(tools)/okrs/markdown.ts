import type { Okr } from "@/lib/stores/workspace-types";
import { krProgress, objectiveHealth } from "./progress";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** One line of text: newlines collapsed. */
function oneLine(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

/** A table cell: one line, pipes escaped. */
function cell(v: unknown): string {
  return oneLine(v).replace(/\|/g, "\\|");
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Objectives with each key result's progress, for a quarterly review page. */
export function toMarkdown(okrs: readonly Okr[], now: Date = new Date()): string {
  const title = `# OKRs — ${mdDate(now)}`;
  if (okrs.length === 0) return `${title}\n\nNo objectives yet.\n`;

  const krCount = okrs.reduce((n, o) => n + o.keyResults.length, 0);
  const overall = okrs.reduce((a, o) => a + objectiveHealth(o), 0) / okrs.length;
  const lines = [
    title,
    "",
    `**${pct(overall)} average progress** across ${okrs.length} objective${
      okrs.length === 1 ? "" : "s"
    } and ${krCount} key result${krCount === 1 ? "" : "s"}.`,
  ];

  for (const o of okrs) {
    const name = oneLine(o.objective) || "Untitled objective";
    const quarter = oneLine(o.quarter);
    lines.push("", `## ${name}${quarter ? ` (${quarter})` : ""} — ${pct(objectiveHealth(o))}`);
    const meta = [o.owner && `Owner: ${oneLine(o.owner)}`, o.description && oneLine(o.description)]
      .filter(Boolean)
      .join(". ");
    if (meta) lines.push("", meta);
    if (o.keyResults.length === 0) {
      lines.push("", "No key results yet.");
      continue;
    }
    lines.push(
      "",
      "| Key result | Current | Target | Progress | Confidence |",
      "|---|---:|---:|---:|---:|",
      ...o.keyResults.map((kr) => {
        const unit = kr.unit ? ` ${cell(kr.unit)}` : "";
        return `| ${cell(kr.title) || "Untitled key result"} | ${cell(kr.current)}${unit} | ${cell(
          kr.target
        )}${unit} | ${pct(krProgress(kr))} | ${
          kr.confidence === undefined ? "—" : `${cell(kr.confidence)}/10`
        } |`;
      })
    );
  }
  return `${lines.join("\n")}\n`;
}
