import { layerCoverage, layerInfo, layerNames, skeletonVerdict } from "./skeleton";
import type { SkeletonData } from "./store";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A table cell: one line, pipes escaped. */
function md(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/**
 * The walking skeleton as Markdown, for an architecture review or the
 * team's channel: the goal, the verdict, the path in order with each
 * step's layer, and the layers it doesn't touch yet.
 */
export function toMarkdown(data: SkeletonData, now: Date = new Date()): string {
  const title = `# Walking Skeleton — ${mdDate(now)}`;
  const goal = md(data.goal);
  const head = [title, "", `**Goal:** ${goal || "_not set_"}`, ""];
  if (data.steps.length === 0) return `${[...head, "No steps yet."].join("\n")}\n`;

  const { missing } = layerCoverage(data.steps);
  const lines = [
    ...head,
    `**${skeletonVerdict(data.steps)}**`,
    "",
    "| # | Step | Layer | Done |",
    "|---:|---|---|---|",
    ...data.steps.map(
      (s, i) =>
        `| ${i + 1} | ${md(s.text)} | ${md(layerInfo(s.layer).label)} | ${s.done ? "✓" : "—"} |`
    ),
    "",
    missing.length === 0
      ? "**Layers:** every layer has a step."
      : `**Not touched yet:** ${layerNames(missing)}.`,
  ];
  return `${lines.join("\n")}\n`;
}
