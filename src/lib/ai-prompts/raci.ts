import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";

interface RACIData {
  roles: { id: string; name: string; description?: string }[];
  activities: { id: string; name: string; description?: string }[];
  matrix: Record<string, Record<string, string>>; // activityId -> roleId -> R|A|C|I|""
}

export function generateRACIPrompts(
  data: RACIData,
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.roles.length === 0 || data.activities.length === 0) return [];

  const context = workspace ? buildWorkspaceContext(workspace) : "";

  const table = formatTable(
    ["Activity", ...data.roles.map((r) => r.name)],
    data.activities.map((a) => [a.name, ...data.roles.map((r) => data.matrix[a.id]?.[r.id] || "-")])
  );

  const rolesList = data.roles
    .map((r) => `- ${r.name}: ${(r.description ?? "—").slice(0, 80)}`)
    .join("\n");
  const activitiesList = data.activities
    .map((a) => `- ${a.name}: ${(a.description ?? "—").slice(0, 80)}`)
    .join("\n");

  // Validation checks
  const warnings: string[] = [];
  data.activities.forEach((a) => {
    const aCount = data.roles.filter((r) => data.matrix[a.id]?.[r.id] === "A").length;
    if (aCount === 0) warnings.push(`"${a.name}" has no Accountable role`);
    if (aCount > 1) warnings.push(`"${a.name}" has ${aCount} Accountable roles (should be 1)`);
    // Same rule as the page: someone has to do the work.
    if (!data.roles.some((r) => data.matrix[a.id]?.[r.id] === "R")) {
      warnings.push(`"${a.name}" has no Responsible role`);
    }
  });
  const overloaded = data.roles.filter((r) => {
    const rCount = data.activities.filter(
      (a) => data.matrix[a.id]?.[r.id] === "R" || data.matrix[a.id]?.[r.id] === "A"
    ).length;
    return rCount > data.activities.length * 0.7;
  });

  return [
    {
      id: "raci-gaps",
      title: "RACI Gap Analysis",
      description: "Find missing accountabilities, overloaded roles, and unclear responsibilities.",
      prompt:
        buildPreamble(
          "RACI Matrix",
          "It defines who is Responsible, Accountable, Consulted, and Informed for each activity."
        ) +
        `## Roles\n\n${rolesList}\n\n## Activities\n\n${activitiesList}\n\n## RACI Matrix\n\n${table}\n\n${warnings.length > 0 ? `## Validation Warnings\n\n${warnings.map((w) => `- ⚠️ ${w}`).join("\n")}\n\n` : ""}${overloaded.length > 0 ? `## Potentially Overloaded Roles\n\n${overloaded.map((r) => `- ${r.name}`).join("\n")}\n\n` : ""}${context}\n## Questions\n\n1. Are there any activities with missing Accountable (A) assignments? Every activity needs exactly one.\n2. Are any roles overloaded with too many R/A assignments? What delegation would help?\n3. Are the Consulted (C) and Informed (I) assignments realistic — would this create too many meetings?\n4. Are there any single points of failure where one person is the only one who can do something?\n5. What activities might be missing from this matrix?`,
    },
    {
      id: "raci-clarity",
      title: "Organizational Clarity Improvement",
      description: "Improve role clarity and decision-making based on the RACI structure.",
      prompt:
        buildPreamble("RACI Matrix", "Help the team improve organizational clarity.") +
        `## Roles\n\n${rolesList}\n\n## Activities\n\n${activitiesList}\n\n## RACI Matrix\n\n${table}${context}\n\n## Questions\n\n1. Does this RACI reflect how decisions actually get made, or is it aspirational?\n2. Where might handoff delays occur based on this responsibility structure?\n3. How should the team handle conflicts when multiple people feel Responsible?\n4. Create a 1-paragraph role description for each role based on their RACI assignments.\n5. What escalation path should exist for activities where the Accountable person is unavailable?`,
    },
  ];
}
