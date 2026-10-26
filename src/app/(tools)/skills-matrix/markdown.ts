import type { SkillsMatrix } from "@/lib/stores/workspace-types";
import {
  TARGET_LEVEL_LABEL,
  proficiencyName,
  ratingOf,
  type SkillColumn,
  type SkillCoverage,
  type TrainingSuggestion,
} from "@/lib/skills/coverage";

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ").trim();
/** A table cell: one line, with pipes escaped so they don't split the cell. */
const cell = (v: string | number) => oneLine(String(v)).replace(/\|/g, "\\|");
const row = (cells: (string | number)[]) => `| ${cells.map(cell).join(" | ")} |`;
const header = (cells: string[]) => [row(cells), `| ${cells.map(() => "---").join(" | ")} |`];

/** "Single point of failure", "Gap", "Below target 1/2"… or "OK". */
export function coverageStatus(c: SkillCoverage): string {
  const flags: string[] = [];
  if (c.gap) flags.push("Gap");
  if (c.spof) flags.push("Single point of failure");
  if (c.meetsTarget === false) flags.push(`Below target ${c.atTarget}/${c.target}`);
  if (flags.length === 0) flags.push(c.meetsTarget ? "At target" : "OK");
  return flags.join(", ");
}

export interface SkillsMarkdownInput {
  doc: SkillsMatrix;
  columns: readonly SkillColumn[];
  coverage: readonly SkillCoverage[];
  suggestions: readonly TrainingSuggestion[];
  verdict: string;
}

/**
 * The matrix as Markdown: the verdict, a coverage table per skill, the
 * ratings with level names ("Not rated" where nobody has rated), and the
 * cross-training plan with its suggestions.
 */
export function skillsToMarkdown({
  doc,
  columns,
  coverage,
  suggestions,
  verdict,
}: SkillsMarkdownInput): string {
  const lines = ["# Team skills matrix", "", `> ${oneLine(verdict)}`, ""];
  if (doc.skills.length === 0) {
    lines.push("No skills yet.");
    return `${lines.join("\n")}\n`;
  }
  const nameOf = (id: string | undefined) => columns.find((c) => c.id === id)?.name ?? "Someone";
  const skillOf = (id: string) => doc.skills.find((s) => s.id === id)?.name ?? "A skill";

  lines.push(
    "## Coverage",
    "",
    ...header(["Skill", "At Intermediate+", "Target", "Status", "Holders", "Not rated"]),
    ...coverage.map((c) =>
      row([
        c.name,
        c.capable,
        c.target === null ? "—" : `${c.target} at ${TARGET_LEVEL_LABEL[c.targetLevel]}`,
        coverageStatus(c),
        c.holders.join(", ") || "—",
        c.unrated,
      ])
    ),
    ""
  );

  if (columns.length > 0) {
    lines.push(
      "## Ratings",
      "",
      ...header([
        "Skill",
        ...columns.map((c) => (c.onRoster ? c.name : `${c.name} (not on the team)`)),
      ]),
      ...doc.skills.map((s) =>
        row([s.name, ...columns.map((c) => proficiencyName(ratingOf(doc, s.id, c)))])
      ),
      ""
    );
  }

  const pairs = doc.training ?? [];
  if (pairs.length > 0 || suggestions.length > 0) {
    lines.push("## Cross-training plan", "");
    for (const p of pairs) {
      const mentor = p.mentorId ? `with ${nameOf(p.mentorId)}` : "outside help";
      const due = p.due && !p.doneAt ? ` · due ${p.due}` : "";
      const done = p.doneAt ? ` · done ${p.doneAt}` : "";
      lines.push(
        `- [${p.doneAt ? "x" : " "}] ${nameOf(p.learnerId)} learns ${skillOf(p.skillId)} to ${proficiencyName(p.toLevel)} (${mentor})${due}${done}`
      );
    }
    if (suggestions.length > 0) {
      if (pairs.length > 0) lines.push("");
      lines.push("Suggested:", "");
      for (const s of suggestions) {
        const mentor = s.mentorId ? `with ${nameOf(s.mentorId)}` : "outside help";
        lines.push(
          `- ${nameOf(s.learnerId)} could learn ${skillOf(s.skillId)} to ${proficiencyName(s.toLevel)} (${mentor})`
        );
      }
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
