import { isExampleId } from "@/components/tool-frame/example-data";
import type { Story } from "@/lib/stores/workspace-types";
import { metCriteria, readinessState, type RefinementSession } from "./session";
import type { Criterion, StorySave } from "./store";
import { refinementVerdict } from "./verdict";

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

const points = (s: Story) =>
  typeof s.points === "number" && s.points > 0 ? String(s.points) : "Unsized";

/** The readiness badge's words, shared by the CSV and the Markdown. */
export const STATE_LABEL = {
  ready: "Ready",
  "needs-points": "Ready once sized",
  partial: "Partial",
  "not-ready": "Not ready",
  unchecked: "Not checked",
} as const;

function met(s: Story, criteria: readonly Criterion[]): string {
  if (!s.readiness || criteria.length === 0) return "—";
  return `${metCriteria(s.readiness.checked, criteria).length}/${criteria.length}`;
}

function storyTable(stories: readonly Story[], criteria: readonly Criterion[]): string[] {
  return [
    "| Story | Points | Criteria met | Status |",
    "|---|---:|---:|---|",
    ...stories.map(
      (s) =>
        `| ${md(s.title)}${isExampleId(s.id) ? " (example)" : ""} | ${points(s)} | ${met(s, criteria)} | ${
          STATE_LABEL[readinessState(s, criteria)]
        } |`
    ),
  ];
}

/**
 * The session as Markdown, for the refinement notes or the planning thread:
 * the verdict, the Definition of Ready, what's left to refine, what's
 * ready, and the checks saved by name.
 */
export function toMarkdown(
  session: RefinementSession,
  criteria: readonly Criterion[],
  history: readonly StorySave[],
  now: Date = new Date()
): string {
  const lines = [`# Backlog refinement — ${mdDate(now)}`, "", `**${refinementVerdict(session)}**`];
  // An example left loaded beside the team's own stories mustn't read as their notes.
  if ([...session.toRefine, ...session.ready].some((s) => isExampleId(s.id))) {
    lines.push("", "_Includes example stories, marked (example)._");
  }

  lines.push("", "## Definition of Ready", "");
  if (criteria.length === 0) lines.push("No criteria yet.");
  else
    for (const c of criteria) {
      lines.push(`- ${md(c.label)}${c.description ? ` — ${md(c.description)}` : ""}`);
    }

  if (session.toRefine.length > 0) {
    lines.push(
      "",
      `## To refine (${session.toRefine.length})`,
      "",
      ...storyTable(session.toRefine, criteria)
    );
  }
  if (session.ready.length > 0) {
    lines.push(
      "",
      `## Ready (${session.ready.length})`,
      "",
      ...storyTable(session.ready, criteria)
    );
  }
  if (history.length > 0) {
    lines.push(
      "",
      `## Earlier checks (${history.length})`,
      "",
      "| Story | Date | Criteria met | % ready |",
      "|---|---|---:|---:|",
      ...history.map(
        (h) =>
          `| ${md(h.storyName)} | ${md(h.date)} | ${h.metCount}/${h.totalCriteria} | ${h.passRate}% |`
      )
    );
  }
  return `${lines.join("\n")}\n`;
}
