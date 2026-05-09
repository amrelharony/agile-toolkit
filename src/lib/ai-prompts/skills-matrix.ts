import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

const PROFICIENCY_LABELS = ["None", "Beginner", "Intermediate", "Advanced", "Expert"];

interface SkillsMatrixData {
  members: { id: string; name: string; description?: string }[];
  skills: { id: string; name: string; description?: string }[];
  grid: Record<string, Record<string, number>>; // skillId -> memberId -> 0-4
}

export function generateSkillsMatrixPrompts(data: SkillsMatrixData): PromptDefinition[] {
  if (data.members.length === 0 || data.skills.length === 0) return [];

  const table = formatTable(
    ["Skill", ...data.members.map((m) => m.name)],
    data.skills.map((s) => [s.name, ...data.members.map((m) => PROFICIENCY_LABELS[data.grid[s.id]?.[m.id] ?? 0])])
  );

  const membersList = data.members
    .map((m) => `- ${m.name}: ${(m.description ?? "—").slice(0, 80)}`)
    .join("\n");
  const skillsList = data.skills
    .map((s) => `- ${s.name}: ${(s.description ?? "—").slice(0, 80)}`)
    .join("\n");

  // Find single points of failure
  const spofs = data.skills.filter((s) => {
    const skilled = data.members.filter((m) => (data.grid[s.id]?.[m.id] ?? 0) >= 2).length;
    return skilled <= 1;
  });

  return [
    {
      id: "skills-gaps",
      title: "Skills Gap Analysis",
      description: "Identify knowledge concentration risks and cross-training priorities.",
      prompt: buildPreamble("Skills Matrix", "It maps team member proficiency (None/Beginner/Intermediate/Advanced/Expert) across skill areas.") +
        `## Members\n\n${membersList}\n\n## Skills\n\n${skillsList}\n\n## Skills Matrix\n\n${table}\n\n${spofs.length > 0 ? `## Single Points of Failure (≤1 person at Intermediate+)\n\n${spofs.map((s) => `- ⚠️ ${s.name}`).join("\n")}\n\n` : ""}## Questions\n\n1. Which skills have the highest knowledge concentration risk (single person dependency)?\n2. Prioritize which cross-training investments would reduce the most risk.\n3. Are there skill gaps that the team cannot fill through cross-training alone?\n4. What pairing or mentoring arrangements would you recommend based on this matrix?\n5. How should the team balance depth (mastery) vs. breadth (flexibility) in their skill development?`,
    },
    {
      id: "skills-development",
      title: "Team Development Plan",
      description: "Create individual and team-level skill development recommendations.",
      prompt: buildPreamble("Skills Matrix", "Design development plans based on current proficiency levels.") +
        `## Members\n\n${membersList}\n\n## Skills\n\n${skillsList}\n\n## Skills Matrix\n\n${table}\n\n## Questions\n\n1. For each team member, suggest their top 2 skill development priorities and why.\n2. Design a quarterly learning plan that balances individual growth with team resilience.\n3. What learning formats would be most effective — pair programming, courses, book clubs, workshops?\n4. How much time should the team allocate to skill development per sprint?\n5. If the team could hire one person, what skill profile would complement this matrix best?`,
    },
  ];
}
