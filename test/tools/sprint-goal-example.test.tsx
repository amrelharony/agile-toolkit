import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { SprintGoal } from "@/lib/stores/workspace-types";

/**
 * Sprint Goal: "Load an example" fills an empty goal, "Clear example"
 * takes back only the example's parts, and the Markdown export carries
 * the goal, its criteria with SMART checks, and the key-result notes.
 */

const exported = vi.hoisted(() => ({ markdown: undefined as string | undefined }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({
  AiPromptGenerator: () => null,
}));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown }: { markdown?: string }) => {
    exported.markdown = markdown;
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
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
import { toMarkdown } from "@/app/(tools)/sprint-goal/markdown";
import { buildExample } from "@/app/(tools)/sprint-goal/example";

const NOW = new Date(2026, 9, 18);
const SG_ID = "sprint-goal:current";

const goal = () => (useWorkspaceStore.getState().sprintGoals ?? []).find((g) => g.id === SG_ID)!;

const renderGoal = () =>
  render(
    <TooltipProvider>
      <SprintGoalClient />
    </TooltipProvider>
  );

// Radix tabs switch on mouse down, not click.
const openStep = (name: string) =>
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });

beforeEach(() => {
  exported.markdown = undefined;
  history.log.mockClear();
  useWorkspaceStore.setState({ sprintGoals: [] });
});

describe("Sprint Goal toMarkdown", () => {
  it("puts the goal first, then the objective, the criteria with SMART checks, and notes", () => {
    const md = toMarkdown(
      {
        businessObjective: "Grow repeat orders",
        goal: "Shoppers can reorder in one tap by end of sprint",
        criteria: [
          {
            id: "c1",
            text: "Reorder button shows for 100% of past orders by end of sprint",
            relevantChecked: true,
          },
          { id: "c2", text: "Make it better", relevantChecked: false },
        ],
        keyResults: ["10% of orders are reorders", ""],
      },
      NOW
    );
    const lines = md.split("\n");
    expect(lines[0]).toBe("# Sprint Goal — 18 Oct 2026");
    expect(lines).toContain("> Shoppers can reorder in one tap by end of sprint");
    expect(lines.indexOf("## Sprint goal")).toBeLessThan(lines.indexOf("## Business objective"));
    expect(lines).toContain("| # | Criterion | SMART |");
    expect(lines).toContain(
      "| 1 | Reorder button shows for 100% of past orders by end of sprint | 5/5 |"
    );
    expect(lines).toContain(
      "| 2 | Make it better | 0/5, missing Specific, Measurable, Achievable, Relevant, Time-bound |"
    );
    expect(lines).toContain("## Key-result notes");
    expect(lines).toContain("- 10% of orders are reorders");
    expect(md).not.toContain("- \n");
  });

  it("escapes pipes and collapses newlines in criteria", () => {
    const md = toMarkdown(
      {
        businessObjective: "",
        goal: "",
        criteria: [{ id: "c1", text: "API | web\nparity", relevantChecked: false }],
        keyResults: [],
      },
      NOW
    );
    expect(md).toContain("| 1 | API \\| web parity |");
  });

  it("says there's nothing yet when empty", () => {
    expect(
      toMarkdown(
        {
          businessObjective: " ",
          goal: "",
          criteria: [{ id: "c1", text: "", relevantChecked: false }],
          keyResults: [""],
        },
        NOW
      )
    ).toBe("# Sprint Goal — 18 Oct 2026\n\nNo sprint goal yet.\n");
  });
});

describe("Sprint Goal example", () => {
  it("marks its criteria as example rows", () => {
    const ex = buildExample();
    expect(ex.criteria.length).toBeGreaterThanOrEqual(3);
    expect(ex.criteria.every((c) => c.id.startsWith("example-"))).toBe(true);
  });

  it("loads into an empty goal, then clears only the example's parts", () => {
    renderGoal();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));

    expect(screen.getByText(/Example data\./)).toBeInTheDocument();
    expect(goal().goal).toBe(buildExample().goal);
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(history.log).not.toHaveBeenCalled();
    expect(exported.markdown).toContain("## Acceptance criteria");

    // The user adds a criterion of their own and edits the goal.
    openStep("Acceptance Criteria");
    const field = screen.getByLabelText("Another acceptance criterion");
    fireEvent.change(field, { target: { value: "Beta group of 200 by Friday" } });
    fireEvent.click(screen.getByRole("button", { name: "Add criterion" }));
    useWorkspaceStore.getState().upsertSprintGoal({
      ...goal(),
      goal: "Ship saved cards to beta testers",
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));
    const left = goal();
    expect(left.criteria.map((c) => c.text)).toEqual(["Beta group of 200 by Friday"]);
    expect(left.goal).toBe("Ship saved cards to beta testers");
    expect(left.businessObjective).toBe("");
    expect(left.keyResults).toEqual([]);
    expect(left.okrIds).toEqual([]);
    expect(screen.queryByText(/Example data\./)).toBeNull();
  });

  it("clears an untouched example back to an empty goal", () => {
    renderGoal();
    fireEvent.click(screen.getByRole("button", { name: "Load an example" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear example" }));

    const left: SprintGoal = goal();
    expect(left.goal).toBe("");
    expect(left.criteria).toEqual([]);
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
  });

  it("isn't offered once the user has started a goal", () => {
    useWorkspaceStore.setState({
      sprintGoals: [
        {
          id: SG_ID,
          businessObjective: "",
          goal: "Ship search filters",
          criteria: [{ id: "c1", text: "", relevantChecked: false }],
          keyResults: [""],
        },
      ],
    });
    renderGoal();
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
    expect(screen.queryByText(/Example data\./)).toBeNull();
  });
});
