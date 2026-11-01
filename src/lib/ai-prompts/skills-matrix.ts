import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type {
  SkillProficiency,
  SkillsMatrix,
  SkillsMatrixGrid,
  SkillsMatrixSkill,
  Workspace,
} from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
// The matrix's own coverage rules (pure, server-safe): the prompt counts as the page does.
import {
  SKILLS_MATRIX_ID,
  TARGET_LEVEL_LABEL,
  coverageCounts,
  proficiencyName,
  ratingOf,
  skillCoverage,
  skillsVerdict,
  type SkillColumn,
  type SkillCoverage,
} from "../skills/coverage";

interface SkillsMatrixData {
  members: { id: string; name: string; description?: string }[];
  /** The skills, with their targets (people needed at a level) when set. */
  skills: SkillsMatrixSkill[];
  /** skillId -> memberId -> 0-4 (0 = None). A missing cell is Not rated. */
  grid: Record<string, Record<string, number>>;
}

/** "2 at Advanced or above", or "—" without a target. */
const targetText = (c: SkillCoverage) =>
  c.target === null ? "—" : `${c.target} at ${TARGET_LEVEL_LABEL[c.targetLevel]}`;

/**
 * Prompts for the Skills Matrix. Coverage is lib/skills/coverage's: someone
 * is capable from Intermediate; a skill nobody is capable at is a gap and
 * one exactly one person is capable at is a single point of failure; a cell
 * nobody rated is Not rated, never None, and doesn't count.
 */
export function generateSkillsMatrixPrompts(
  data: SkillsMatrixData,
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.members.length === 0 || data.skills.length === 0) return [];

  const context = workspace ? buildWorkspaceContext(workspace) : "";

  // The page's ratings as a version-2 matrix (a 0 is a rated None), read
  // through the same coverage the page shows.
  const grid: SkillsMatrixGrid = {};
  for (const [skillId, row] of Object.entries(data.grid)) {
    grid[skillId] = {};
    for (const [memberId, level] of Object.entries(row)) {
      if (typeof level === "number" && Number.isFinite(level)) {
        grid[skillId][memberId] = Math.min(4, Math.max(0, Math.round(level))) as SkillProficiency;
      }
    }
  }
  const doc: SkillsMatrix = {
    id: SKILLS_MATRIX_ID,
    members: [],
    skills: data.skills,
    grid,
    version: 2,
  };
  const columns: SkillColumn[] = data.members.map((m) => ({
    id: m.id,
    name: m.name,
    onRoster: true,
    legacyIds: [],
  }));
  const coverage = skillCoverage(doc, columns);
  const counts = coverageCounts(coverage);
  const anyRated = counts.skills * columns.length - counts.unrated > 0;
  const judged = counts.atTarget + counts.belowTarget;

  const table = formatTable(
    ["Skill", ...columns.map((m) => m.name), "Intermediate+", "Target"],
    coverage.map((c) => [
      c.name,
      ...columns.map((m) => proficiencyName(ratingOf(doc, c.skillId, m))),
      c.capable,
      targetText(c),
    ])
  );

  const membersList = data.members
    .map((m) => `- ${m.name}: ${(m.description ?? "—").slice(0, 80)}`)
    .join("\n");
  const skillsList = data.skills
    .map((s) => `- ${s.name}: ${(s.description ?? "—").slice(0, 80)}`)
    .join("\n");

  const standing = [
    `- ${skillsVerdict(coverage, columns)}`,
    `- Skills at target: ${judged > 0 ? `${counts.atTarget}/${judged}` : counts.withTarget === 0 ? "— (no targets set)" : "— (not rated yet)"}`,
    `- Single points of failure: ${anyRated ? counts.spofs : "—"}`,
    `- Gaps: ${anyRated ? counts.gaps : "—"}`,
    `- Ratings missing: ${counts.unrated}`,
  ].join("\n");

  const spofs = coverage.filter((c) => c.spof);
  const gaps = coverage.filter((c) => c.gap);
  const unrated = coverage.filter((c) => c.notRatedYet);
  const risks =
    (spofs.length > 0
      ? `## Single Points of Failure (exactly one person at Intermediate or above)\n\n${spofs.map((c) => `- ⚠️ ${c.name}: ${c.holders[0]}`).join("\n")}\n\n`
      : "") +
    (gaps.length > 0
      ? `## Gaps (nobody rated at Intermediate or above)\n\n${gaps.map((c) => `- ${c.name}`).join("\n")}\n\n`
      : "") +
    (unrated.length > 0
      ? `## Not rated for anyone yet\n\n${unrated.map((c) => `- ${c.name}`).join("\n")}\n\n`
      : "");

  return [
    {
      id: "skills-gaps",
      title: "Skills Gap Analysis",
      description: "Identify knowledge concentration risks and cross-training priorities.",
      prompt:
        buildPreamble(
          "Skills Matrix",
          "It maps team member proficiency (None/Beginner/Intermediate/Advanced/Expert, or Not rated) across skill areas; someone at Intermediate or above handles routine work in a skill alone."
        ) +
        `## Members\n\n${membersList}\n\n## Skills\n\n${skillsList}\n\n## Skills Matrix\n\n${table}\n\n## Where things stand\n\n${standing}\n\n${risks}${context}\n## Questions\n\n1. Which skills have the highest knowledge concentration risk (single person dependency)?\n2. Prioritize which cross-training investments would reduce the most risk.\n3. Are there skill gaps that the team cannot fill through cross-training alone?\n4. What pairing or mentoring arrangements would you recommend based on this matrix?\n5. How should the team balance depth (mastery) vs. breadth (flexibility) in their skill development?`,
    },
    {
      id: "skills-development",
      title: "Team Development Plan",
      description: "Create individual and team-level skill development recommendations.",
      prompt:
        buildPreamble(
          "Skills Matrix",
          "Design development plans based on current proficiency levels."
        ) +
        `## Members\n\n${membersList}\n\n## Skills\n\n${skillsList}\n\n## Skills Matrix\n\n${table}${context}\n\n## Questions\n\n1. For each team member, suggest their top 2 skill development priorities and why.\n2. Design a quarterly learning plan that balances individual growth with team resilience.\n3. What learning formats would be most effective — pair programming, courses, book clubs, workshops?\n4. How much time should the team allocate to skill development per sprint?\n5. If the team could hire one person, what skill profile would complement this matrix best?`,
    },
  ];
}
