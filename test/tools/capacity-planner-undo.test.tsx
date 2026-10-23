import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Capacity Planner: removing a member offers Undo that puts them back in
 * order; Reset asks first, with the member count, and is undoable.
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
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

const CP_ID = "capacity-planner:current";
const member = (id: string, name: string) => ({
  id,
  name,
  role: "Developer",
  availability: 100,
  daysOff: 0,
});

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({
    capacityPlans: [
      {
        id: CP_ID,
        members: [member("m1", "Ana"), member("m2", "Ben"), member("m3", "Cal")],
        config: {
          sprintDays: 10,
          ceremonyOverhead: 15,
          focusFactor: 0.8,
          hoursPerDay: 8,
          pointsCommitted: "",
        },
      },
    ],
  });
});

const names = () =>
  useWorkspaceStore
    .getState()
    .capacityPlans?.find((p) => p.id === CP_ID)
    ?.members.map((m) => m.name);

describe("Capacity Planner undo", () => {
  it("puts a removed member back at their old position", () => {
    render(<CapacityPlannerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Remove member Ben" }));

    expect(names()).toEqual(["Ana", "Cal"]);
    expect(screen.queryByRole("button", { name: "Remove member Ben" })).toBeNull();
    expect(undo.last?.label).toBe("Removed “Ben”");

    act(() => undo.last!.revert());
    expect(names()).toEqual(["Ana", "Ben", "Cal"]);
    act(() => undo.last!.revert());
    expect(names()).toEqual(["Ana", "Ben", "Cal"]);
  });

  it("confirms Reset with the member count, and Undo restores the team", () => {
    render(<CapacityPlannerClient />);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Reset the capacity plan?");
    expect(dialog).toHaveTextContent("All 3 team members are removed");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset plan" }));
    // An empty team, not a blank row that would count a full person's hours.
    expect(names()).toEqual([]);

    act(() => undo.last!.revert());
    expect(names()).toEqual(["Ana", "Ben", "Cal"]);
  });
});
