import type { RaciMatrix, TeamMember } from "@/lib/stores/workspace-types";
import {
  RACI_LETTERS,
  RACI_LETTER_NAME,
  activityIssues,
  cellOf,
  cellText,
  countsByRole,
  loadWarnings,
  unassignedActivities,
} from "@/lib/raci/model";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
/** A table cell: one line, with pipes escaped so they don't split the cell. */
const cell = (v: string | number) => oneLine(String(v)).replace(/\|/g, "\\|");

/**
 * The matrix as Markdown: the roles (with who is on the team), the matrix
 * as a table (A/R where one role is both), the letters per role, and the
 * issues and load warnings.
 */
export function raciMarkdown(
  doc: RaciMatrix,
  roster: readonly Pick<TeamMember, "id" | "name">[],
  { verdict }: { verdict?: string } = {}
): string {
  const lines = ["# RACI matrix", ""];
  if (verdict) lines.push(`> ${oneLine(verdict)}`, "");
  if (doc.roles.length === 0 && doc.activities.length === 0) {
    lines.push("No activities or roles yet.");
    return `${lines.join("\n")}\n`;
  }
  lines.push(`Legend: ${RACI_LETTERS.map((l) => `${l} = ${RACI_LETTER_NAME[l]}`).join(", ")}.`, "");
  if (doc.roles.length > 0) {
    lines.push("## Roles", "");
    for (const r of doc.roles) {
      const person = r.memberId ? roster.find((m) => m.id === r.memberId) : undefined;
      const who = r.memberId ? (person ? "on the team" : "no longer on the team") : "group role";
      lines.push(
        `- ${oneLine(r.name)} (${who})${r.description ? `: ${oneLine(r.description)}` : ""}`
      );
    }
    lines.push("");
  }
  if (doc.roles.length > 0 && doc.activities.length > 0) {
    lines.push(
      "## Matrix",
      "",
      `| Activity | ${doc.roles.map((r) => cell(r.name)).join(" | ")} |`,
      `| --- | ${doc.roles.map(() => "---").join(" | ")} |`,
      ...doc.activities.map(
        (a) =>
          `| ${cell(a.name)} | ${doc.roles
            .map((r) => cellText(cellOf(doc, a.id, r.id)) || "—")
            .join(" | ")} |`
      ),
      "",
      "## Letters per role",
      "",
      "| Role | R | A | C | I |",
      "| --- | --- | --- | --- | --- |",
      ...countsByRole(doc).map((c) => `| ${cell(c.name)} | ${c.R} | ${c.A} | ${c.C} | ${c.I} |`),
      ""
    );
  }
  const issues = activityIssues(doc);
  const warnings = loadWarnings(doc);
  const unassigned = unassignedActivities(doc);
  if (issues.length + warnings.length + unassigned.length > 0) {
    lines.push("## Checks", "");
    for (const i of issues) lines.push(`- ${oneLine(i.message)}`);
    for (const w of warnings) lines.push(`- ${oneLine(w.message)}`);
    if (unassigned.length > 0) {
      lines.push(`- Not assigned yet: ${unassigned.map((a) => oneLine(a.name)).join(", ")}.`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
