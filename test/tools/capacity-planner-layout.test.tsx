import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CapacityConfig } from "@/lib/stores/workspace-types";

/**
 * Capacity Planner on a phone: a plan that opens with no team shows Team
 * Members first (adding someone is the first thing to do; the form used to
 * sit about four screens down), a plan with a team keeps the usual order,
 * and the summary tiles sit two to a row.
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

const CP_ID = "capacity-planner:current";
const CONFIG: CapacityConfig = {
  sprintDays: 10,
  ceremonyOverhead: 15,
  focusFactor: 0.8,
  hoursPerDay: 8,
  pointsCommitted: "",
};

const heading = (name: string) => screen.getByRole("heading", { name });
/** True when `a` comes before `b` in the document (and so in reading and tab order). */
const before = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const team = () => heading("Team Members");
const totals = () => screen.getByText("Total Capacity");

beforeEach(() => {
  useWorkspaceStore.setState({ capacityPlans: [] });
});

describe("Capacity Planner order", () => {
  it("puts Team Members first while the plan has no team", () => {
    render(<CapacityPlannerClient />);
    expect(before(team(), totals())).toBe(true);
    expect(before(team(), heading("Where the hours go"))).toBe(true);
    expect(before(team(), heading("Points forecast"))).toBe(true);
    expect(before(team(), heading("Sprint Configuration"))).toBe(true);
  });

  it("treats an older plan's blank starter row as no team", () => {
    useWorkspaceStore.setState({
      capacityPlans: [
        {
          id: CP_ID,
          members: [{ id: "default:member-1", name: "", role: "", availability: 100, daysOff: 0 }],
          config: CONFIG,
        },
      ],
    });
    render(<CapacityPlannerClient />);
    expect(before(team(), heading("Points forecast"))).toBe(true);
  });

  it("keeps Team Members where it is when the first member is added", () => {
    render(<CapacityPlannerClient />);
    fireEvent.change(screen.getByRole("combobox", { name: /New member/ }), {
      target: { value: "Lee" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));

    // Lee landed; the card doesn't jump away from under the person typing.
    expect(screen.getAllByRole("combobox", { name: "Name" })).toHaveLength(1);
    expect(before(team(), heading("Points forecast"))).toBe(true);
    // The per-person breakdown follows its team.
    expect(before(heading("Per-Person Breakdown"), heading("Points forecast"))).toBe(true);
  });

  it("keeps the usual order for a plan with a team", () => {
    useWorkspaceStore.setState({
      capacityPlans: [
        {
          id: CP_ID,
          members: [{ id: "m1", name: "Lee", role: "Dev", availability: 100, daysOff: 0 }],
          config: CONFIG,
        },
      ],
    });
    render(<CapacityPlannerClient />);
    expect(before(totals(), team())).toBe(true);
    expect(before(heading("Points forecast"), team())).toBe(true);
    expect(before(heading("Sprint Configuration"), team())).toBe(true);
    expect(before(team(), heading("Per-Person Breakdown"))).toBe(true);
  });
});

describe("Capacity Planner summary tiles", () => {
  it("sit two to a row on a phone and four from lg", () => {
    render(<CapacityPlannerClient />);
    const grid = totals().closest(".grid")!;
    expect(grid).toHaveClass("grid-cols-2", "lg:grid-cols-4");
    expect(grid).not.toHaveClass("grid-cols-1");
    expect(grid.children).toHaveLength(4);
  });

  it("let a label wrap and a unit drop under a long value in a narrow tile", () => {
    render(<CapacityPlannerClient />);
    const label = screen.getByText("Avg Availability");
    expect(label).toHaveClass("min-w-0", "break-words");
    expect(label).not.toHaveClass("truncate");
    // The value row wraps; the tile keeps its desktop size from sm up.
    const valueRow = label.parentElement!.nextElementSibling!;
    expect(valueRow).toHaveClass("flex-wrap");
    expect(valueRow.firstElementChild).toHaveClass("text-2xl", "sm:text-3xl");
  });
});
