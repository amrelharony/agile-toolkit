import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { Workspace } from "../stores/workspace-types";
import { buildWorkspaceContext } from "./cross-tool-context";
// The matrix's own checks (pure, server-safe): the prompt says what the page says.
import {
  RACI_LOAD,
  activityIssues,
  cellOf,
  cellText,
  countsByRole,
  loadWarnings,
  normalizeRaci,
  raciVerdict,
  unassignedActivities,
} from "@/lib/raci/model";

interface RACIData {
  roles: { id: string; name: string; description?: string; memberId?: string }[];
  activities: { id: string; name: string; description?: string }[];
  /**
   * activityId -> roleId -> the cell's letters: an array (["A", "R"]), a
   * joined string ("A/R"), one letter ("A"), or "" / [] for none.
   */
  matrix: Record<string, Record<string, string | readonly string[]>>;
}

/**
 * Prompts for the RACI matrix. A cell holds letters, so A/R counts as an
 * Accountable and a Responsible; the checks are lib/raci/model's
 * (activityIssues and the RACI_LOAD rules of thumb in loadWarnings), and an
 * activity nobody is assigned to yet is listed as such, not flagged.
 */
export function generateRACIPrompts(
  data: RACIData,
  workspace?: Workspace | null
): PromptDefinition[] {
  if (data.roles.length === 0 || data.activities.length === 0) return [];

  const context = workspace ? buildWorkspaceContext(workspace) : "";
  // The same normal form the page reads its document in.
  const doc = normalizeRaci({
    roles: data.roles,
    activities: data.activities,
    matrix: data.matrix,
  });

  const table = formatTable(
    ["Activity", ...doc.roles.map((r) => r.name)],
    doc.activities.map((a) => [
      a.name,
      ...doc.roles.map((r) => cellText(cellOf(doc, a.id, r.id)) || "-"),
    ])
  );

  const rolesList = doc.roles
    .map((r) => `- ${r.name}: ${(r.description ?? "—").slice(0, 80)}`)
    .join("\n");
  const activitiesList = doc.activities
    .map((a) => `- ${a.name}: ${(a.description ?? "—").slice(0, 80)}`)
    .join("\n");

  const lettersTable = formatTable(
    ["Role", "R", "A", "C", "I"],
    countsByRole(doc).map((c) => [c.name, c.R, c.A, c.C, c.I])
  );

  const checks = [...activityIssues(doc), ...loadWarnings(doc)].map((c) => `- ${c.message}`);
  const unassigned = unassignedActivities(doc).map((a) => a.name);
  const checksSection =
    `## Checks\n\n${raciVerdict(doc)}\n\n` +
    (checks.length > 0 ? `${checks.join("\n")}\n\n` : "") +
    (unassigned.length > 0 ? `Not assigned yet: ${unassigned.join(", ")}.\n\n` : "") +
    `Rules of thumb: one Accountable per activity; nobody Accountable for more than ${Math.round(RACI_LOAD.maxAccountableShare * 100)}% of ${RACI_LOAD.minActivitiesForShare} or more activities; no more than ${RACI_LOAD.maxConsulted} roles consulted on one.\n\n`;

  return [
    {
      id: "raci-gaps",
      title: "RACI Gap Analysis",
      description: "Find missing accountabilities, overloaded roles, and unclear responsibilities.",
      prompt:
        buildPreamble(
          "RACI Matrix",
          "It defines who is Responsible, Accountable, Consulted, and Informed for each activity. A cell can hold A and R together (A/R)."
        ) +
        `## Roles\n\n${rolesList}\n\n## Activities\n\n${activitiesList}\n\n## RACI Matrix\n\n${table}\n\n## Letters per role\n\n${lettersTable}\n\n${checksSection}${context}\n## Questions\n\n1. Are there any activities with missing Accountable (A) assignments? Every activity needs exactly one.\n2. Are any roles overloaded with too many R/A assignments? What delegation would help?\n3. Are the Consulted (C) and Informed (I) assignments realistic — would this create too many meetings?\n4. Are there any single points of failure where one person is the only one who can do something?\n5. What activities might be missing from this matrix?`,
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
