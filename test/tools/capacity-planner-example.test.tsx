import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CapacityConfig } from "@/lib/stores/workspace-types";

/**
 * Capacity Planner: "Load an example" replaces the blank starter row with a
 * five-person team, "Clear example" removes only those members, and the plan
 * exports as Markdown.
 */

vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: () => null,
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));

import { CapacityPlannerClient } from "@/app/(tools)/capacity-planner/capacity-planner-client";
import { buildExampleMembers } from "@/app/(tools)/capacity-planner/example";
import { toMarkdown } from "@/app/(tools)/capacity-planner/markdown";

const CP_ID = "capacity-planner:current";
const NOW = new Date(2026, 9, 18);
const CONFIG: CapacityConfig = {
  sprintDays: 10,
  ceremonyOverhead: 15,
  focusFactor: 0.8,
  hoursPerDay: 8,
  pointsCommitted: "",
};

const members = () =>
  useWorkspaceStore.getState().capacityPlans?.find((p) => p.id === CP_ID)?.members ?? [];
const names = () =>
  screen.getAllByRole("textbox", { name: "Name" }).map((i) => (i as HTMLInputElement).value);
const notice = () => screen.queryByText("Example data.");

beforeEach(() => {
  useWorkspaceStore.setState({ capacityPlans: [] });
});

describe("Capacity Planner Markdown", () => {
  it("reports the settings, total hours and each member's hours", () => {
    const md = toMarkdown(
      { members: buildExampleMembers(), config: { ...CONFIG, pointsCommitted: "30" } },
      NOW
    );
    expect(md).toMatch(/^# Sprint Capacity — 18 Oct 2026\n/);
    expect(md).toContain(
      "**Sprint:** 10 days · 8 h/day · focus factor 0.8 · ceremony overhead 15%"
    );
    expect(md).toContain("**Total capacity:** 191.5 hours across 5 members");
    expect(md).toContain("**Points committed:** 30");
    expect(md).toContain("| Member | Role | Availability | Days off | Effective hours | Notes |");
    expect(md).toContain("| Mei | Android Developer | 100% | 0 | 54.4 |  |");
    expect(md).toContain(
      "| Priya | Product Owner | 50% | 0 | 27.2 | Split with the loyalty team. |"
    );
    expect(md).toContain("| Amara | QA Engineer | 100% | 5 | 27.2 | Vacation in week two. |");
    expect(md).toContain("| **Total** | | | | **191.5** | |");
  });

  it("escapes pipes and collapses newlines in cells", () => {
    const md = toMarkdown(
      {
        members: [
          {
            id: "m1",
            name: "Lee | contractor",
            role: "Dev",
            availability: 100,
            daysOff: 0,
            description: "Mornings\nonly",
          },
        ],
        config: CONFIG,
      },
      NOW
    );
    expect(md).toContain("| Lee \\| contractor | Dev | 100% | 0 | 54.4 | Mornings only |");
  });

  it("says there is no team yet for the blank starter row", () => {
    const blank = { id: "m1", name: "", role: "", availability: 100, daysOff: 0 };
    expect(toMarkdown({ members: [blank], config: CONFIG }, NOW)).toBe(
      "# Sprint Capacity — 18 Oct 2026\n\nNo team members yet.\n"
    );
  });
});

describe("Capacity Planner example", () => {
  it("loads in place of the blank row and clears only the example members", () => {
    render(<CapacityPlannerClient />);
    expect(notice()).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    expect(names()).toEqual(["Priya", "Diego", "Mei", "Sam", "Amara"]);
    expect(members().every((m) => m.id.startsWith("example-"))).toBe(true);
    expect(notice()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();

    // The user adds a member of their own.
    fireEvent.click(screen.getByRole("button", { name: "Add Member" }));
    const inputs = screen.getAllByRole("textbox", { name: "Name" });
    fireEvent.change(inputs[inputs.length - 1], { target: { value: "Lee" } });

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    expect(names()).toEqual(["Lee"]);
    expect(notice()).toBeNull();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
  });

  it("leaves a blank row, and offers the example again, when only example members were there", () => {
    render(<CapacityPlannerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));

    expect(names()).toEqual([""]);
    expect(members()[0].id.startsWith("example-")).toBe(false);
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
  });
});
