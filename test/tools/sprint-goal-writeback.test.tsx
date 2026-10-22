import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";

/**
 * Sprint Goal Builder: the goal it drafts can be written onto the shared
 * sprint the sprint tools are looking at, so Sprint Planning, the cockpit
 * and the charts show it.
 */

vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
}));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({ ExportButton: () => null }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: () => {} }),
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const motionProps = new Set(["initial", "animate", "exit", "transition", "layout"]);
  const strip = (props: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(props).filter(([key]) => !motionProps.has(key)));
  const Div = React.forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) =>
    React.createElement("div", { ...strip(props), ref })
  );
  Div.displayName = "MotionDiv";
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: new Proxy({}, { get: () => Div }),
  };
});
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

import { SprintGoalClient } from "@/app/(tools)/sprint-goal/sprint-goal-client";

beforeEach(() => {
  resetSelectedSprint();
  window.localStorage.clear();
  useWorkspaceStore.setState({
    sprints: [
      {
        id: "s2",
        name: "Sprint 2",
        startDate: "2026-10-15",
        endDate: "2026-10-25",
        pointsPlanned: 30,
        status: "active",
      },
    ],
    sprintGoals: [],
  });
});

afterEach(() => {
  useWorkspaceStore.setState({ sprints: [], sprintGoals: [] });
});

describe("Sprint Goal Builder → shared sprint", () => {
  it("writes the drafted goal onto the selected sprint", () => {
    render(<SprintGoalClient />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Sprint Goal" }), { button: 0 });
    const field = screen.getByLabelText("Sprint goal");
    fireEvent.change(field, { target: { value: "Customers can pay with a saved card" } });
    fireEvent.blur(field);
    fireEvent.click(screen.getByRole("button", { name: "Use as the goal of Sprint 2" }));
    expect(useWorkspaceStore.getState().sprints[0].goal).toBe(
      "Customers can pay with a saved card"
    );
  });

  it("offers nothing to write to when there is no sprint", () => {
    useWorkspaceStore.setState({ sprints: [] });
    render(<SprintGoalClient />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Sprint Goal" }), { button: 0 });
    expect(screen.queryByRole("button", { name: /Use as the goal of/ })).toBeNull();
  });
});
