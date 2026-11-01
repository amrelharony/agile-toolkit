// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateSkillsMatrixPrompts } from "@/lib/ai-prompts/skills-matrix";
import {
  coverageCounts,
  skillCoverage,
  skillsVerdict,
  type SkillColumn,
} from "@/lib/skills/coverage";
import type {
  SkillsMatrix,
  SkillsMatrixGrid,
  SkillsMatrixSkill,
} from "@/lib/stores/workspace-types";

/**
 * The Skills Matrix prompt counts with lib/skills/coverage: a single point
 * of failure is exactly one person at Intermediate or above (a skill with
 * nobody is a gap, not a SPOF), and a cell nobody rated is Not rated, never
 * None. It used to call every skill with one or no capable person a SPOF
 * and read a missing cell as None.
 */

const MEMBERS = [
  { id: "a", name: "Ann" },
  { id: "b", name: "Bo" },
  { id: "c", name: "Cy" },
];
const SKILLS: SkillsMatrixSkill[] = [
  { id: "ts", name: "TypeScript" },
  { id: "k8s", name: "Kubernetes" },
  { id: "ux", name: "UX research" },
  { id: "sql", name: "SQL", targetPeople: 3, targetLevel: 2 },
];
// Rated cells only, as the page passes them; 0 is a rated None.
const GRID: SkillsMatrixGrid = {
  ts: { a: 3, b: 1 },
  k8s: { a: 0, b: 1, c: 1 },
  ux: {},
  sql: { a: 2, b: 2, c: 1 },
};

const [gaps, development] = generateSkillsMatrixPrompts({
  members: MEMBERS,
  skills: SKILLS,
  grid: GRID,
});

// The page's own numbers over the same ratings.
const doc: SkillsMatrix = { id: "m", members: [], skills: SKILLS, grid: GRID, version: 2 };
const columns: SkillColumn[] = MEMBERS.map((m) => ({ ...m, onRoster: true, legacyIds: [] }));
const coverage = skillCoverage(doc, columns);
const counts = coverageCounts(coverage);

describe("generateSkillsMatrixPrompts", () => {
  it("states the page's verdict and counts", () => {
    expect(counts).toMatchObject({ spofs: 1, gaps: 1, atTarget: 0, belowTarget: 1, unrated: 4 });
    expect(gaps.prompt).toContain(`- ${skillsVerdict(coverage, columns)}`);
    expect(gaps.prompt).toContain("- Skills at target: 0/1");
    expect(gaps.prompt).toContain("- Single points of failure: 1");
    expect(gaps.prompt).toContain("- Gaps: 1");
    expect(gaps.prompt).toContain("- Ratings missing: 4");
  });

  it("names a single point of failure apart from a gap", () => {
    expect(gaps.prompt).toContain(
      "## Single Points of Failure (exactly one person at Intermediate or above)\n\n- ⚠️ TypeScript: Ann\n\n"
    );
    expect(gaps.prompt).toContain(
      "## Gaps (nobody rated at Intermediate or above)\n\n- Kubernetes\n\n"
    );
    expect(gaps.prompt).not.toContain("⚠️ Kubernetes");
    // Nobody rated in UX research yet: neither a gap nor a SPOF.
    expect(gaps.prompt).toContain("## Not rated for anyone yet\n\n- UX research\n\n");
    expect(gaps.prompt).not.toContain("⚠️ UX research");
  });

  it("reads a missing cell as Not rated and a 0 as None", () => {
    expect(gaps.prompt).toContain("| TypeScript | Advanced | Beginner | Not rated | 1 | — |");
    expect(gaps.prompt).toContain("| Kubernetes | None | Beginner | Beginner | 0 | — |");
    expect(development.prompt).toContain(
      "| SQL | Intermediate | Intermediate | Beginner | 2 | 3 at Intermediate or above |"
    );
  });

  it("has no prompts without people or skills", () => {
    expect(generateSkillsMatrixPrompts({ members: [], skills: SKILLS, grid: GRID })).toEqual([]);
    expect(generateSkillsMatrixPrompts({ members: MEMBERS, skills: [], grid: {} })).toEqual([]);
  });
});
