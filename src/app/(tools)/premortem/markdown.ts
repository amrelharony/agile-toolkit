/** A premortem cause, as the client stores it. */
export interface Cause {
  id: string;
  text: string;
  description?: string;
  likelihood: number;
  impact: number;
  preventiveAction?: string;
  owner?: string;
}

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** One line: newlines collapsed. */
function oneLine(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim();
}

/** A table cell: one line, pipes escaped. */
function cell(v: unknown): string {
  return oneLine(v).replace(/\|/g, "\\|");
}

/**
 * The premortem as Markdown, for the project page or a kickoff thread: the
 * imagined failure, the causes in the team's order (they rank them by hand,
 * so the order is kept, as in the CSV) with likelihood × impact, then the
 * preventive actions as a checklist with owners.
 */
export function toMarkdown(
  { scenario, causes }: { scenario: string; causes: readonly Cause[] },
  now: Date = new Date()
): string {
  const title = `# Premortem — ${mdDate(now)}`;
  if (causes.length === 0 && !scenario.trim()) return `${title}\n\nNo failure causes yet.\n`;

  const lines = [title, "", "## Imagined failure", "", oneLine(scenario) || "_Not described yet._"];
  lines.push("", "## Causes", "");
  if (causes.length === 0) {
    lines.push("_No causes yet._");
  } else {
    lines.push(
      "| # | Cause | Likelihood | Impact | Score | Preventive action | Owner |",
      "|---:|---|---:|---:|---:|---|---|",
      ...causes.map(
        (c, i) =>
          `| ${i + 1} | ${cell(c.text) || "(untitled)"}${
            c.description?.trim() ? ` — ${cell(c.description)}` : ""
          } | ${c.likelihood} | ${c.impact} | ${c.likelihood * c.impact} | ${cell(
            c.preventiveAction
          )} | ${cell(c.owner)} |`
      )
    );
  }

  const actions = causes.filter((c) => c.preventiveAction?.trim());
  if (actions.length > 0) {
    lines.push(
      "",
      "## Preventive actions",
      "",
      ...actions.map(
        (c) =>
          `- [ ] ${oneLine(c.preventiveAction)}${c.owner?.trim() ? ` — **${oneLine(c.owner)}**` : ""}`
      )
    );
  }
  return `${lines.join("\n")}\n`;
}
