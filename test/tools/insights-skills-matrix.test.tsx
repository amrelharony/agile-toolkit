import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightsEngine } from "@/components/shared/insights-engine";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { SkillsMatrix, TeamMember } from "@/lib/stores/workspace-types";
import { SKILLS_MATRIX_ID } from "@/lib/skills/coverage";

/**
 * The Insights card passes the Skills Matrix to its rules, so the
 * bus-factor insight counts the matrix's single points of failure (rated
 * proficiency), not the Team page's skill tags.
 */

const ROSTER: TeamMember[] = [
  { id: "member_ana", name: "Ana", skills: ["Go"] },
  { id: "member_bo", name: "Bo" },
];

const MATRIX: SkillsMatrix = {
  id: SKILLS_MATRIX_ID,
  version: 2,
  members: [],
  skills: [{ id: "pay", name: "Payments" }],
  grid: { pay: { member_ana: 3, member_bo: 0 } },
};

beforeEach(() => {
  useWorkspaceStore.getState().resetWorkspace();
});

describe("Insights and the Skills Matrix", () => {
  it("names the matrix's single point of failure, not the Team page tags", async () => {
    useWorkspaceStore.setState({ teamMembers: ROSTER, skillsMatrices: [MATRIX] });
    render(<InsightsEngine toolId="skills-matrix" limit={100} />);
    expect(await screen.findByText("Bus factor = 1 on 1 skill")).toBeInTheDocument();
    expect(
      screen.getByText(/at Intermediate or above in at least one skill \(Skills Matrix\)/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/lists these skills on the Team page/)).toBeNull();
  });

  it("falls back to the Team page tags without a rated matrix", async () => {
    useWorkspaceStore.setState({ teamMembers: ROSTER, skillsMatrices: [] });
    render(<InsightsEngine toolId="skills-matrix" limit={100} />);
    expect(await screen.findByText(/lists these skills on the Team page/)).toBeInTheDocument();
  });
});
