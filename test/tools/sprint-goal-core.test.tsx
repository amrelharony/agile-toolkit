import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { SprintGoal } from "@/lib/stores/workspace-types";

/**
 * Sprint Goal Builder gap-filling: the SMART heuristics, the Markdown's
 * edges and the example's own claims, then the wizard's navigation and the
 * once-per-change "goal saved" milestone, the criterion and key-result
 * edits, the SMART badges, the preview and the recent-sprints callout.
 */

const exported = vi.hoisted(() => ({ markdown: "", clipboard: "" }));
const history = vi.hoisted(() => ({ log: vi.fn() }));
const signals = vi.hoisted(() => ({ sprintAdds: [] as unknown[] }));
vi.mock("@/components/layout/tool-page-wrapper", () => ({
  ToolPageWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ai-prompt-generator", () => ({ AiPromptGenerator: () => null }));
vi.mock("@/components/shared/export-button", () => ({
  ExportButton: ({ markdown, clipboardText }: { markdown?: string; clipboardText?: string }) => {
    exported.markdown = markdown ?? "";
    exported.clipboard = clipboardText ?? "";
    return null;
  },
}));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: history.log }),
}));
vi.mock("@/lib/history/selectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/history/selectors")>()),
  selectEvents: (q: { toolId?: string; action?: string }) =>
    q.toolId === "velocity" && q.action === "sprint_added" ? signals.sprintAdds : [],
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { apply: () => void }) => a.apply(),
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
import { validateSmart, type SmartResult } from "@/app/(tools)/sprint-goal/smart";
import { toMarkdown } from "@/app/(tools)/sprint-goal/markdown";
import { buildExample } from "@/app/(tools)/sprint-goal/example";

const SG_ID = "sprint-goal:current";
const NOW = new Date(2026, 9, 18);
const smart = (text: string, relevantChecked = false): SmartResult =>
  validateSmart({ id: "c", text, relevantChecked });

/* ── SMART checks ──────────────────────────────────────────────────────── */

describe("validateSmart", () => {
  it("passes a concrete, numbered, dated, relevant criterion on every check", () => {
    expect(
      smart("90% of new users finish onboarding within 3 minutes by end of sprint", true)
    ).toEqual({
      specific: true,
      measurable: true,
      achievable: true,
      relevant: true,
      timeBound: true,
    });
  });

  it("flags vague words", () => {
    expect(smart("Improve the checkout flow for 10% more orders").specific).toBe(false);
    expect(smart("Fix various things in the checkout page").specific).toBe(false);
    expect(smart("Checkout works BETTER on Android phones").specific).toBe(false);
    expect(smart("Checkout improvement for Android phones").specific).toBe(false);
    expect(smart("Checkout shows saved cards on Android phones").specific).toBe(true);
  });

  it("flags the -ing, -ed and -ation forms of vague verbs ending in e", () => {
    // Bug: "improving" stems to "improv", which neither equals nor starts with "improve", so
    // the very examples the stemming comment names ("improving", "optimization",
    // "enhanced") passed as specific.
    expect(smart("Improving checkout conversion for shoppers").specific).toBe(false);
    expect(smart("Optimization of the checkout page for mobile").specific).toBe(false);
    expect(smart("Enhanced checkout page for mobile shoppers").specific).toBe(false);
    expect(smart("Checkout improved, for mobile shoppers").specific).toBe(false);
    // Words that only share a short stem stay specific.
    expect(smart("Finish the refund flow for Android").specific).toBe(true);
    expect(smart("Final payment screen ships on Android").specific).toBe(true);
  });

  it("needs more than ten characters to be specific, and 20 to 300 to be achievable", () => {
    expect(smart("Ship cards").specific).toBe(false); // 10 characters
    expect(smart("Ship cards!").specific).toBe(true);
    expect(smart("x".repeat(19)).achievable).toBe(false);
    expect(smart("x".repeat(20)).achievable).toBe(true);
    expect(smart("x".repeat(300)).achievable).toBe(true);
    expect(smart("x".repeat(301)).achievable).toBe(false);
    // Surrounding whitespace doesn't count.
    expect(smart(`   ${"x".repeat(19)}   `).achievable).toBe(false);
  });

  it("finds numbers and measuring words, and deadlines", () => {
    expect(smart("Reduce by half the payment errors").measurable).toBe(true);
    expect(smart("At least one card can be saved").measurable).toBe(true);
    expect(smart("Shoppers can save a card").measurable).toBe(false);
    expect(smart("Cards are saved by end of sprint").timeBound).toBe(true);
    expect(smart("Cards are saved within 2 weeks").timeBound).toBe(true);
    expect(smart("Cards are saved by EOD").timeBound).toBe(true);
    expect(smart("Cards are saved forever").timeBound).toBe(false);
  });

  it("is relevant only when the user ticks it, and an empty criterion passes nothing else", () => {
    expect(smart("", true)).toEqual({
      specific: false,
      measurable: false,
      achievable: false,
      relevant: true,
      timeBound: false,
    });
  });
});

describe("the example's SMART story", () => {
  it("has two criteria that pass everything, one without a number or deadline, one not ticked", () => {
    const results = buildExample().criteria.map((c) => validateSmart(c));
    const all = (r: SmartResult) => Object.values(r).every(Boolean);
    expect(results.map(all)).toEqual([true, true, false, false]);
    expect(results[2]).toMatchObject({ measurable: false, timeBound: false, relevant: true });
    expect(results[3]).toMatchObject({ relevant: false, measurable: true, timeBound: true });
  });
});

describe("toMarkdown edges", () => {
  it("writes 5/5 for a criterion that meets every check, and trims key results", () => {
    const md = toMarkdown(
      {
        businessObjective: "",
        goal: "",
        criteria: [
          {
            id: "c1",
            text: "90% of shoppers pay in one tap by end of sprint",
            relevantChecked: true,
          },
          { id: "c2", text: "   ", relevantChecked: true },
        ],
        keyResults: ["  Drop-off\nfalls to 15%  ", "   "],
      },
      NOW
    );
    expect(md.startsWith("# Sprint Goal — 18 Oct 2026\n")).toBe(true);
    expect(md).not.toContain("## Sprint goal");
    expect(md).not.toContain("## Business objective");
    expect(md).toContain("| 1 | 90% of shoppers pay in one tap by end of sprint | 5/5 |");
    expect(md).not.toContain("| 2 |");
    expect(md).toContain("## Key results\n\n- Drop-off falls to 15%\n");
  });

  it("counts whitespace-only parts as empty", () => {
    expect(
      toMarkdown(
        {
          businessObjective: "  ",
          goal: "\n",
          criteria: [{ id: "c", text: " ", relevantChecked: true }],
          keyResults: [" "],
        },
        NOW
      )
    ).toBe("# Sprint Goal — 18 Oct 2026\n\nNo sprint goal yet.\n");
  });
});

/* ── The wizard ────────────────────────────────────────────────────────── */

const goal = () => (useWorkspaceStore.getState().sprintGoals ?? []).find((g) => g.id === SG_ID)!;
const openStep = (name: string) =>
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
const commit = (el: HTMLElement, value: string) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};
const seedGoal = (patch: Partial<SprintGoal> = {}) =>
  useWorkspaceStore.setState({
    sprintGoals: [
      {
        id: SG_ID,
        businessObjective: "Grow repeat orders",
        goal: "Shoppers can reorder in one tap",
        criteria: [{ id: "c1", text: "", relevantChecked: false }],
        keyResults: [""],
        ...patch,
      },
    ],
  });
const actions = () => history.log.mock.calls.map((c) => c[0]);

beforeEach(() => {
  exported.markdown = "";
  exported.clipboard = "";
  history.log.mockClear();
  signals.sprintAdds = [];
  useWorkspaceStore.setState({ sprintGoals: [], sprints: [] });
});

describe("navigation", () => {
  it("steps through the four steps with Next and Previous, disabled at each end", () => {
    render(<SprintGoalClient />);
    const prev = screen.getByRole("button", { name: "Previous" });
    const next = screen.getByRole("button", { name: "Next" });
    expect(prev).toBeDisabled();
    expect(screen.getByRole("heading", { name: "Business Objective" })).toBeInTheDocument();

    fireEvent.click(next);
    expect(screen.getByRole("heading", { name: "Sprint Goal" })).toBeInTheDocument();
    fireEvent.click(next);
    expect(screen.getByRole("heading", { name: "Acceptance Criteria" })).toBeInTheDocument();
    fireEvent.click(next);
    expect(screen.getByRole("heading", { name: "Key Results" })).toBeInTheDocument();
    expect(next).toBeDisabled();

    fireEvent.click(prev);
    expect(screen.getByRole("heading", { name: "Acceptance Criteria" })).toBeInTheDocument();
  });

  it("logs the goal as saved once on reaching the last step, and again only after a change", () => {
    seedGoal();
    render(<SprintGoalClient />);
    const next = screen.getByRole("button", { name: "Next" });
    const prev = screen.getByRole("button", { name: "Previous" });
    fireEvent.click(next);
    fireEvent.click(next);
    expect(actions()).not.toContain("goal_saved");
    fireEvent.click(next);
    expect(actions().filter((a) => a === "goal_saved")).toHaveLength(1);
    expect(history.log).toHaveBeenCalledWith("goal_saved", {
      objective: "Grow repeat orders",
      goal: "Shoppers can reorder in one tap",
      criteriaCount: 1,
    });

    // Back and forth without a change: no second milestone.
    fireEvent.click(prev);
    fireEvent.click(next);
    expect(actions().filter((a) => a === "goal_saved")).toHaveLength(1);

    // Change the goal, come back: a fresh milestone.
    openStep("Sprint Goal");
    commit(screen.getByLabelText("Sprint goal"), "Shoppers can reorder in two taps");
    fireEvent.click(next);
    fireEvent.click(next);
    expect(actions().filter((a) => a === "goal_saved")).toHaveLength(2);
  });

  it("doesn't log the example as the user's goal", () => {
    useWorkspaceStore.setState({ sprintGoals: [{ id: SG_ID, ...buildExample() }] });
    render(<SprintGoalClient />);
    const next = screen.getByRole("button", { name: "Next" });
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.click(next);
    expect(actions()).not.toContain("goal_saved");
  });
});

describe("goal and objective", () => {
  it("saves the objective on blur and counts the goal's characters", () => {
    render(<SprintGoalClient />);
    commit(screen.getByLabelText("Business objective"), "Win back mobile shoppers");
    expect(goal().businessObjective).toBe("Win back mobile shoppers");

    openStep("Sprint Goal");
    commit(screen.getByLabelText("Sprint goal"), "Pay in one tap");
    expect(goal().goal).toBe("Pay in one tap");
    expect(screen.getByText("14/300")).toBeInTheDocument();
  });

  it("cuts a pasted goal at 300 characters", () => {
    render(<SprintGoalClient />);
    openStep("Sprint Goal");
    commit(screen.getByLabelText("Sprint goal"), "g".repeat(350));
    expect(goal().goal).toHaveLength(300);
    expect(screen.getByText("300/300")).toBeInTheDocument();
  });
});

describe("acceptance criteria", () => {
  it("adds, edits and ticks criteria, with SMART badges once there is text", () => {
    render(<SprintGoalClient />);
    openStep("Acceptance Criteria");
    expect(screen.queryByText("SMART:")).toBeNull();
    expect(screen.getByRole("button", { name: "Remove acceptance criterion 1" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Add Criterion" }));
    expect(goal().criteria).toHaveLength(2);
    expect(actions()).toContain("criterion_added");
    expect(screen.getByRole("button", { name: "Remove acceptance criterion 1" })).toBeEnabled();

    commit(
      screen.getByLabelText("Acceptance criterion 2"),
      "Saved cards show for 100% of shoppers by end of sprint"
    );
    expect(goal().criteria[1].text).toBe("Saved cards show for 100% of shoppers by end of sprint");
    expect(screen.getAllByText("SMART:")).toHaveLength(1);
    expect(screen.getByText("Relevant").textContent).toBe("Relevant (not met)");
    expect(screen.getByText("Measurable").textContent).toBe("Measurable (met)");

    fireEvent.click(screen.getByRole("checkbox"));
    expect(goal().criteria[1].relevantChecked).toBe(true);
    expect(screen.getByText("Relevant").textContent).toBe("Relevant (met)");
  });

  it("starts from an agent-made goal with no criteria or key results", () => {
    seedGoal({ businessObjective: "", goal: "", criteria: [], keyResults: [] });
    render(<SprintGoalClient />);
    // Nothing typed: the example is offered.
    expect(screen.getByRole("button", { name: "Load an example" })).toBeInTheDocument();
    openStep("Acceptance Criteria");
    fireEvent.click(screen.getByRole("button", { name: "Add Criterion" }));
    expect(goal().criteria).toHaveLength(1);
    openStep("Key Results");
    fireEvent.click(screen.getByRole("button", { name: "Add Key Result" }));
    expect(goal().keyResults).toEqual([""]);
  });
});

describe("key results", () => {
  it("adds and edits key results; the last one can't be removed", () => {
    render(<SprintGoalClient />);
    openStep("Key Results");
    expect(screen.getByRole("button", { name: "Remove key result 1" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add Key Result" }));
    commit(screen.getByLabelText("Key result 2"), "Drop-off falls to 15%");
    expect(goal().keyResults).toEqual(["", "Drop-off falls to 15%"]);
  });
});

describe("preview and exports", () => {
  it("shows placeholders when empty and only the filled parts otherwise", () => {
    const { rerender } = render(<SprintGoalClient />);
    expect(screen.getAllByText("Not yet defined")).toHaveLength(2);
    expect(screen.getByText("No criteria added")).toBeInTheDocument();
    expect(screen.getByText("No key results added")).toBeInTheDocument();

    seedGoal({
      criteria: [
        { id: "c1", text: "Reorder works for 100% of orders", relevantChecked: true },
        { id: "c2", text: "  ", relevantChecked: false },
      ],
      keyResults: ["10% of orders are reorders", ""],
    });
    rerender(<SprintGoalClient />);
    expect(screen.queryByText("Not yet defined")).toBeNull();
    expect(screen.getAllByText("Shoppers can reorder in one tap").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      expect.arrayContaining(["Reorder works for 100% of orders", "10% of orders are reorders"])
    );
    expect(screen.queryByRole("button", { name: "Load an example" })).toBeNull();
  });

  it("copies every part as plain text", () => {
    seedGoal({
      criteria: [{ id: "c1", text: "Reorder in one tap", relevantChecked: true }],
      keyResults: ["10% reorders"],
    });
    render(<SprintGoalClient />);
    expect(exported.clipboard).toBe(
      [
        "BUSINESS OBJECTIVE: Grow repeat orders",
        "SPRINT GOAL: Shoppers can reorder in one tap",
        "ACCEPTANCE CRITERIA:",
        "1. Reorder in one tap",
        "KEY RESULTS:",
        "- 10% reorders",
      ].join("\n")
    );
    expect(exported.markdown).toContain("> Shoppers can reorder in one tap");
  });
});

describe("recent sprints callout", () => {
  it("counts the sprints Velocity logged in the last two weeks", () => {
    signals.sprintAdds = [{ id: "e1" }, { id: "e2" }];
    const { unmount } = render(<SprintGoalClient />);
    expect(screen.getByText(/2 sprints were logged in the last 14 days/)).toBeInTheDocument();
    unmount();
    signals.sprintAdds = [{ id: "e1" }];
    render(<SprintGoalClient />);
    expect(screen.getByText(/1 sprint was logged in the last 14 days/)).toBeInTheDocument();
  });

  it("stays away when no sprint was logged", () => {
    render(<SprintGoalClient />);
    expect(screen.queryByText(/logged in the last 14 days/)).toBeNull();
  });
});
