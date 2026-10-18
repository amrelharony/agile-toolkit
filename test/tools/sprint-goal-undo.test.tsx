import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

/**
 * Sprint Goal: removing an acceptance criterion or a key result offers
 * Undo, and Undo puts it back at its old position.
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
// Steps swap synchronously instead of waiting on exit animations.
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

import { SprintGoalClient } from "@/app/(tools)/sprint-goal/sprint-goal-client";

// Radix tabs switch on mouse down, not click.
const openStep = (name: string) =>
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });

const goal = () =>
  (useWorkspaceStore.getState().sprintGoals ?? []).find((g) => g.id === "sprint-goal:current")!;

beforeEach(() => {
  undo.last = null;
  useWorkspaceStore.setState({
    sprintGoals: [
      {
        id: "sprint-goal:current",
        businessObjective: "Grow activation",
        goal: "Ship guided onboarding",
        criteria: [
          { id: "c1", text: "Tour covers 5 steps", relevantChecked: false },
          { id: "c2", text: "90% finish onboarding by sprint end", relevantChecked: true },
          { id: "c3", text: "", relevantChecked: false },
        ],
        keyResults: ["Activation 60%", "Time to value under 3 min", "NPS 40"],
      },
    ],
  });
});

describe("Sprint Goal deletes", () => {
  it("restores a removed acceptance criterion in place", () => {
    render(<SprintGoalClient />);
    openStep("Acceptance Criteria");
    fireEvent.click(screen.getByRole("button", { name: "Remove acceptance criterion 2" }));

    expect(goal().criteria.map((c) => c.id)).toEqual(["c1", "c3"]);
    expect(undo.last!.label).toBe("Deleted “90% finish onboarding by sprint end”");

    act(() => undo.last!.revert());
    expect(goal().criteria.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(goal().criteria[1].relevantChecked).toBe(true);
  });

  it("restores a removed key result at its index", () => {
    render(<SprintGoalClient />);
    openStep("Key Results");
    fireEvent.click(screen.getByRole("button", { name: "Remove key result 1" }));

    expect(goal().keyResults).toEqual(["Time to value under 3 min", "NPS 40"]);
    expect(undo.last!.label).toBe("Deleted “Activation 60%”");

    act(() => undo.last!.revert());
    expect(goal().keyResults).toEqual(["Activation 60%", "Time to value under 3 min", "NPS 40"]);
  });
});
