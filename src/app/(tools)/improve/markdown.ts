import type { Improvement, ImprovementCondition } from "@/lib/stores/workspace-types";
import {
  METHOD_LABEL,
  OBSTACLE_STATUS_LABEL,
  STATUS_LABEL,
  STEP_STATUS_LABEL,
  composeCondition,
  sortedReadings,
  valueText,
} from "@/lib/improve/model";

/** A table cell: one line, pipes escaped. */
const cell = (s: string | undefined) =>
  (s ?? "").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|") || "—";

/** Text kept as one paragraph per line. */
const para = (s: string | undefined) => (s ?? "").trim();

const condition = (c: ImprovementCondition, word: "by" | "on") =>
  composeCondition(c, word) || "Not set yet.";

function readingsTable(item: Improvement): string[] {
  const rows = sortedReadings(item);
  if (rows.length === 0) return ["No reading yet."];
  const unit = item.target.unit ?? item.current.unit;
  return [
    "| Date | Value | Note |",
    "| --- | --- | --- |",
    ...rows.map(
      (r) => `| ${r.date} | ${cell(valueText({ value: r.value, unit }))} | ${cell(r.note)} |`
    ),
  ];
}

function a3(item: Improvement, analysisTitle?: (id: string) => string | undefined): string[] {
  const linked = item.rootCauseId ? analysisTitle?.(item.rootCauseId) : undefined;
  const steps = item.steps;
  return [
    "### Why it matters",
    para(item.background) || "Not written yet.",
    "",
    "### Where we are",
    condition(item.current, "on"),
    "",
    "### Where we want to be",
    condition(item.target, "by"),
    "",
    "### Why it happens",
    para(item.analysis) || "Not written yet.",
    ...(linked ? ["", `Root Cause analysis: ${linked}`] : []),
    "",
    "### What we'll change",
    ...(steps.length === 0
      ? ["Nothing yet."]
      : [
          "| What | Owner | Due | Status |",
          "| --- | --- | --- | --- |",
          ...steps.map(
            (s) =>
              `| ${cell(s.text)} | ${cell(s.owner)} | ${cell(s.due)} | ${STEP_STATUS_LABEL[s.status]} |`
          ),
        ]),
    "",
    "### Did it work?",
    ...readingsTable(item),
    "",
    `What the check showed: ${para(item.check) || "Not written yet."}`,
    "",
    "### What's next",
    para(item.followUp) || "Not written yet.",
  ];
}

function kata(item: Improvement): string[] {
  const past = item.pastTargets ?? [];
  return [
    "### Challenge",
    para(item.background) || "Not written yet.",
    "",
    "### Next target",
    condition(item.target, "by"),
    ...(past.length > 0
      ? [
          "",
          "Past targets:",
          ...past.map((t) => `- ${condition(t, "by")} (reached ${t.reachedAt.slice(0, 10)})`),
        ]
      : []),
    "",
    "### Where we are",
    condition(item.current, "on"),
    ...(item.nextCoachingAt ? ["", `Next coaching talk: ${item.nextCoachingAt}`] : []),
    "",
    "### Obstacles",
    ...(item.obstacles.length === 0
      ? ["None yet."]
      : item.obstacles.map((o) =>
          o.status === "cleared"
            ? `- ~~${para(o.text)}~~ (cleared)`
            : `- ${para(o.text)}${o.status === "working" ? ` (${OBSTACLE_STATUS_LABEL.working.toLowerCase()})` : ""}`
        )),
    "",
    "### Experiments",
    ...(item.steps.length === 0
      ? ["None yet."]
      : [
          "| Try | Expect | Happened | Learned | Status |",
          "| --- | --- | --- | --- | --- |",
          ...item.steps.map(
            (s) =>
              `| ${cell(s.text)} | ${cell(s.expect)} | ${cell(s.result)} | ${cell(s.learned)} | ${STEP_STATUS_LABEL[s.status]} |`
          ),
        ]),
    "",
    "### Readings",
    ...readingsTable(item),
  ];
}

/**
 * Every improvement as Markdown: the verdict quoted, then each one with its
 * method and status, an A3's seven sections (countermeasures and readings
 * as tables) or a Kata's challenge, targets, obstacles (cleared ones struck
 * through), experiments and readings.
 */
export function improveToMarkdown(
  items: readonly Improvement[],
  {
    verdict,
    analysisTitle,
  }: { verdict?: string; analysisTitle?: (id: string) => string | undefined } = {}
): string {
  const out = ["# Improvements", ""];
  if (verdict) out.push(`> ${verdict}`, "");
  if (items.length === 0) {
    out.push("No improvement yet.");
    return out.join("\n");
  }
  for (const item of items) {
    out.push(`## ${item.title}`, "", `${METHOD_LABEL[item.method]} · ${STATUS_LABEL[item.status]}`);
    if (item.owner) out.push(`Owner: ${item.owner}${item.coach ? ` · Coach: ${item.coach}` : ""}`);
    out.push("", ...(item.method === "a3" ? a3(item, analysisTitle) : kata(item)), "");
  }
  return out.join("\n").trimEnd() + "\n";
}
